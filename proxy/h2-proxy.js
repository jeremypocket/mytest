const fs = require('fs');
const path = require('path');
const net = require('net');
const http2 = require('http2');

const DEFAULT_HOST = process.env.H2_PROXY_HOST || '0.0.0.0';
const DEFAULT_PORT = Number(process.env.H2_PROXY_PORT || 8443);
const CONNECT_TIMEOUT_MS = Number(process.env.H2_CONNECT_TIMEOUT_MS || 30000);
const IDLE_TIMEOUT_MS = Number(process.env.H2_IDLE_TIMEOUT_MS || 120000);
const USE_TLS = process.env.H2_TLS !== 'false';

const KEY_PATH = process.env.H2_TLS_KEY_PATH || path.join(__dirname, 'certs', 'key.pem');
const CERT_PATH = process.env.H2_TLS_CERT_PATH || path.join(__dirname, 'certs', 'cert.pem');

function parseAuthority(authorityValue) {
  if (!authorityValue || typeof authorityValue !== 'string') return null;

  // IPv6: [::1]:443 or [::1]
  if (authorityValue.startsWith('[')) {
    const rightBracketIndex = authorityValue.indexOf(']');
    if (rightBracketIndex === -1) return null;

    const host = authorityValue.slice(1, rightBracketIndex);
    const rest = authorityValue.slice(rightBracketIndex + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : 443;

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }

  // IPv4/domain: example.com:443 or example.com
  const lastColon = authorityValue.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: authorityValue, port: 443 };
  }

  const host = authorityValue.slice(0, lastColon);
  const port = Number(authorityValue.slice(lastColon + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;

  return { host, port };
}

function safeEndStream(stream) {
  if (!stream.closed && !stream.destroyed) {
    stream.close();
  }
}

function safeDestroySocket(socket) {
  if (socket && !socket.destroyed) {
    socket.destroy();
  }
}

function createServer() {
  if (!USE_TLS) {
    return http2.createServer();
  }

  if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
    throw new Error(
      `TLS enabled but cert files not found. Expected key: ${KEY_PATH}, cert: ${CERT_PATH}`
    );
  }

  return http2.createSecureServer({
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
    allowHTTP1: false,
  });
}

const server = createServer();

server.on('session', (session) => {
  session.setTimeout(IDLE_TIMEOUT_MS, () => session.close());
});

server.on('stream', (stream, headers) => {
  const method = headers[':method'];
  const authority = headers[':authority'];

  if (method !== 'CONNECT') {
    stream.respond({ ':status': 405 });
    stream.end('Only CONNECT is supported.\n');
    return;
  }

  const parsed = parseAuthority(authority);
  if (!parsed) {
    stream.respond({ ':status': 400 });
    stream.end('Invalid :authority header.\n');
    return;
  }

  const { host, port } = parsed;
  const upstream = net.createConnection({ host, port });
  let responseSent = false;

  stream.setTimeout(IDLE_TIMEOUT_MS, () => {
    safeEndStream(stream);
    safeDestroySocket(upstream);
  });

  upstream.setTimeout(CONNECT_TIMEOUT_MS, () => {
    if (!responseSent && !stream.closed && !stream.destroyed) {
      stream.respond({ ':status': 504 });
      stream.end('Upstream connect timeout.\n');
      responseSent = true;
    }
    safeDestroySocket(upstream);
  });

  upstream.on('connect', () => {
    if (stream.closed || stream.destroyed) {
      safeDestroySocket(upstream);
      return;
    }

    stream.respond({ ':status': 200 });
    responseSent = true;

    stream.pipe(upstream);
    upstream.pipe(stream);
  });

  upstream.on('error', (error) => {
    if (!responseSent && !stream.closed && !stream.destroyed) {
      const status = error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' ? 502 : 503;
      stream.respond({ ':status': status });
      stream.end(`Upstream error: ${error.code || 'UNKNOWN'}\n`);
      responseSent = true;
    }
    safeDestroySocket(upstream);
    safeEndStream(stream);
  });

  stream.on('aborted', () => safeDestroySocket(upstream));
  stream.on('close', () => safeDestroySocket(upstream));
  stream.on('error', () => safeDestroySocket(upstream));
});

server.on('error', (error) => {
  console.error('[h2-proxy] server error:', error);
});

server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
  const mode = USE_TLS ? 'h2 (TLS)' : 'h2c (cleartext)';
  console.log('========================================');
  console.log('HTTP/2 CONNECT 代理已启动');
  console.log(`模式: ${mode}`);
  console.log(`监听地址: ${DEFAULT_HOST}:${DEFAULT_PORT}`);
  if (USE_TLS) {
    console.log(`证书: key=${KEY_PATH}, cert=${CERT_PATH}`);
  }
  console.log('========================================');
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭 HTTP/2 代理...`);
  server.close(() => {
    console.log('HTTP/2 代理已关闭');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
