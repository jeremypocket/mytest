const net = require('net');
const logUpdate = require('log-update');

// SOCKS5 常量
const SOCKS5_VERSION = 0x05;
const AUTH_METHOD_NO_AUTH = 0x00;
const AUTH_METHOD_USERNAME_PASSWORD = 0x02;
const AUTH_METHOD_NOT_ACCEPTABLE = 0xFF;

const CMD_CONNECT = 0x01;
const CMD_BIND = 0x02;
const CMD_UDP_ASSOCIATE = 0x03;

const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

const REP_SUCCESS = 0x00;
const REP_GENERAL_FAILURE = 0x01;
const REP_CONNECTION_NOT_ALLOWED = 0x02;
const REP_NETWORK_UNREACHABLE = 0x03;
const REP_HOST_UNREACHABLE = 0x04;
const REP_CONNECTION_REFUSED = 0x05;
const REP_TTL_EXPIRED = 0x06;
const REP_COMMAND_NOT_SUPPORTED = 0x07;
const REP_ADDRESS_TYPE_NOT_SUPPORTED = 0x08;

// 记录已连接过的 IP（key: IP地址, value: {firstConnectTime, lastUsedTime}）
const connectedIPs = new Map();

// 渲染客户端列表
function renderClientList() {
  if (connectedIPs.size === 0) return;
  
  const lines = [];
  for (const [ip, info] of connectedIPs.entries()) {
    lines.push(`[${info.firstConnectTime}] 客户端: ${ip} | 最后使用: ${info.lastUsedTime}`);
  }
  logUpdate(lines.join('\n'));
}

// 创建 SOCKS5 代理服务器
const server = net.createServer((clientSocket) => {
  const clientIP = clientSocket.remoteAddress;
  const now = new Date().toLocaleString();
  
  // 检查是否为新 IP
  if (!connectedIPs.has(clientIP)) {
    // 新 IP，记录信息
    connectedIPs.set(clientIP, {
      firstConnectTime: now,
      lastUsedTime: now
    });
  } else {
    // 已存在的 IP，更新最后使用时间
    connectedIPs.get(clientIP).lastUsedTime = now;
  }
  
  // 更新控制台显示
  renderClientList();

  let state = 'handshake'; // handshake -> request -> connected
  let targetSocket = null;
  let handshakeTimeout = null;
  let requestTimeout = null;

  // 清理函数
  const cleanup = () => {
    if (handshakeTimeout) {
      clearTimeout(handshakeTimeout);
      handshakeTimeout = null;
    }
    if (requestTimeout) {
      clearTimeout(requestTimeout);
      requestTimeout = null;
    }
    if (targetSocket && !targetSocket.destroyed) {
      targetSocket.destroy();
    }
  };

  // 设置握手超时（10秒）
  handshakeTimeout = setTimeout(() => {
    if (state === 'handshake') {
      clientSocket.destroy();
      cleanup();
    }
  }, 10000);

  // 处理客户端数据
  clientSocket.once('data', (data) => {
    if (handshakeTimeout) {
      clearTimeout(handshakeTimeout);
      handshakeTimeout = null;
    }
    if (state === 'handshake') {
      // 创建一个包装的 handleRequest 函数来保存 targetSocket
      const wrappedHandleRequest = (socket, requestData) => {
        if (requestTimeout) {
          clearTimeout(requestTimeout);
          requestTimeout = null;
        }
        handleRequest(socket, requestData, (ts) => {
          targetSocket = ts;
          state = 'connected';
        });
      };
      
      handleHandshake(clientSocket, data, wrappedHandleRequest, () => {
        state = 'request';
        // 设置请求超时（30秒）
        requestTimeout = setTimeout(() => {
          if (state === 'request') {
            clientSocket.destroy();
            cleanup();
          }
        }, 30000);
      });
    }
  });

  // 处理客户端错误
  clientSocket.on('error', (err) => {
    cleanup();
  });

  // 处理客户端断开
  clientSocket.on('close', () => {
    cleanup();
  });
});

// 处理 SOCKS5 握手
function handleHandshake(socket, data, requestHandler, onRequestReady) {
  // 检查版本号
  if (data.length < 2 || data[0] !== SOCKS5_VERSION) {
    socket.destroy();
    return;
  }

  const nMethods = data[1];
  if (data.length < 2 + nMethods) {
    socket.destroy();
    return;
  }

  const methods = Array.from(data.slice(2, 2 + nMethods));
  
  // 选择认证方法（优先无认证）
  let selectedMethod = AUTH_METHOD_NOT_ACCEPTABLE;
  if (methods.includes(AUTH_METHOD_NO_AUTH)) {
    selectedMethod = AUTH_METHOD_NO_AUTH;
  }

  // 发送选择的认证方法
  const response = Buffer.from([SOCKS5_VERSION, selectedMethod]);
  if (!socket.write(response)) {
    socket.once('drain', () => {});
  }

  if (selectedMethod === AUTH_METHOD_NOT_ACCEPTABLE) {
    socket.destroy();
    return;
  }

  if (onRequestReady) {
    onRequestReady();
  }

  // 等待客户端请求
  socket.once('data', (requestData) => {
    if (requestHandler) {
      requestHandler(socket, requestData);
    } else {
      handleRequest(socket, requestData);
    }
  });
}

// 处理 SOCKS5 连接请求
function handleRequest(socket, data, onTargetCreated) {
  if (data.length < 4 || data[0] !== SOCKS5_VERSION) {
    sendReply(socket, REP_GENERAL_FAILURE, ATYP_IPV4, '0.0.0.0', 0);
    socket.destroy();
    return;
  }

  const cmd = data[1];
  const atyp = data[3];

  // 只支持 CONNECT 命令
  if (cmd !== CMD_CONNECT) {
    sendReply(socket, REP_COMMAND_NOT_SUPPORTED, ATYP_IPV4, '0.0.0.0', 0);
    socket.destroy();
    return;
  }

  let host;
  let port;
  let offset;

  // 解析目标地址
  if (atyp === ATYP_IPV4) {
    // IPv4 地址
    if (data.length < 10) {
      sendReply(socket, REP_GENERAL_FAILURE, ATYP_IPV4, '0.0.0.0', 0);
      socket.destroy();
      return;
    }
    host = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
    port = data.readUInt16BE(8);
    offset = 10;
  } else if (atyp === ATYP_DOMAIN) {
    // 域名
    if (data.length < 5) {
      sendReply(socket, REP_GENERAL_FAILURE, ATYP_IPV4, '0.0.0.0', 0);
      socket.destroy();
      return;
    }
    const domainLength = data[4];
    if (data.length < 5 + domainLength + 2) {
      sendReply(socket, REP_GENERAL_FAILURE, ATYP_IPV4, '0.0.0.0', 0);
      socket.destroy();
      return;
    }
    host = data.slice(5, 5 + domainLength).toString('utf8');
    port = data.readUInt16BE(5 + domainLength);
    offset = 5 + domainLength + 2;
  } else if (atyp === ATYP_IPV6) {
    // IPv6 地址
    if (data.length < 22) {
      sendReply(socket, REP_GENERAL_FAILURE, ATYP_IPV4, '0.0.0.0', 0);
      socket.destroy();
      return;
    }
    const ipv6Bytes = data.slice(4, 20);
    host = Array.from(ipv6Bytes)
      .map((b, i) => {
        if (i % 2 === 0) {
          return ipv6Bytes.readUInt16BE(i).toString(16).padStart(4, '0');
        }
        return null;
      })
      .filter(Boolean)
      .join(':');
    port = data.readUInt16BE(20);
    offset = 22;
  } else {
    sendReply(socket, REP_ADDRESS_TYPE_NOT_SUPPORTED, ATYP_IPV4, '0.0.0.0', 0);
    socket.destroy();
    return;
  }

  // 连接到目标服务器（设置连接超时30秒）
  const targetSocket = net.createConnection({
    host: host,
    port: port,
    timeout: 30000
  }, () => {
    // 连接成功
    
    // 获取本地绑定地址
    const localAddress = targetSocket.localAddress;
    const localPort = targetSocket.localPort;
    
    // 发送成功响应
    sendReply(socket, REP_SUCCESS, atyp, localAddress, localPort, data.slice(4, offset));

    // 设置 socket 为不自动关闭
    socket.setKeepAlive(true, 60000);
    targetSocket.setKeepAlive(true, 60000);

    // 处理背压：暂停/恢复数据流
    socket.on('drain', () => {
      targetSocket.resume();
    });

    targetSocket.on('drain', () => {
      socket.resume();
    });

    // 开始双向数据转发（使用 pauseOnDrain 处理背压）
    socket.pipe(targetSocket, { end: false });
    targetSocket.pipe(socket, { end: false });

    // 处理连接关闭
    const cleanup = () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
      if (!targetSocket.destroyed) {
        targetSocket.destroy();
      }
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
    targetSocket.on('close', cleanup);
    targetSocket.on('error', cleanup);
  });

  // 处理连接超时
  targetSocket.on('timeout', () => {
    sendReply(socket, REP_TTL_EXPIRED, ATYP_IPV4, '0.0.0.0', 0);
    socket.destroy();
    targetSocket.destroy();
  });

  // 处理连接错误
  targetSocket.on('error', (err) => {
    let rep = REP_GENERAL_FAILURE;
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      rep = REP_HOST_UNREACHABLE;
    } else if (err.code === 'ECONNREFUSED') {
      rep = REP_CONNECTION_REFUSED;
    } else if (err.code === 'ETIMEDOUT') {
      rep = REP_TTL_EXPIRED;
    } else if (err.code === 'ENETUNREACH') {
      rep = REP_NETWORK_UNREACHABLE;
    }

    if (!socket.destroyed) {
      sendReply(socket, rep, ATYP_IPV4, '0.0.0.0', 0);
      socket.destroy();
    }
    if (!targetSocket.destroyed) {
      targetSocket.destroy();
    }
  });

  if (onTargetCreated) {
    onTargetCreated(targetSocket);
  }
}

// 发送 SOCKS5 响应
function sendReply(socket, rep, atyp, host, port, originalAddressData = null) {
  let response;
  
  if (atyp === ATYP_IPV4) {
    const ipParts = host.split('.').map(Number);
    response = Buffer.allocUnsafe(10);
    response[0] = SOCKS5_VERSION;
    response[1] = rep;
    response[2] = 0x00; // RSV
    response[3] = ATYP_IPV4;
    response[4] = ipParts[0];
    response[5] = ipParts[1];
    response[6] = ipParts[2];
    response[7] = ipParts[3];
    response.writeUInt16BE(port, 8);
  } else if (atyp === ATYP_DOMAIN && originalAddressData) {
    // 使用原始地址数据
    response = Buffer.allocUnsafe(4 + originalAddressData.length);
    response[0] = SOCKS5_VERSION;
    response[1] = rep;
    response[2] = 0x00; // RSV
    response[3] = ATYP_DOMAIN;
    originalAddressData.copy(response, 4);
  } else if (atyp === ATYP_IPV6) {
    // IPv6 响应（简化处理，使用 IPv4）
    const ipParts = host.split('.').map(Number);
    response = Buffer.allocUnsafe(10);
    response[0] = SOCKS5_VERSION;
    response[1] = rep;
    response[2] = 0x00; // RSV
    response[3] = ATYP_IPV4;
    response[4] = ipParts[0] || 0;
    response[5] = ipParts[1] || 0;
    response[6] = ipParts[2] || 0;
    response[7] = ipParts[3] || 0;
    response.writeUInt16BE(port, 8);
  } else {
    // 默认 IPv4 响应
    response = Buffer.allocUnsafe(10);
    response[0] = SOCKS5_VERSION;
    response[1] = rep;
    response[2] = 0x00; // RSV
    response[3] = ATYP_IPV4;
    response[4] = 0;
    response[5] = 0;
    response[6] = 0;
    response[7] = 0;
    response.writeUInt16BE(port, 8);
  }

  // 检查 socket 是否已销毁
  if (socket.destroyed) {
    return;
  }
  
  // 写入响应，如果缓冲区满则等待 drain 事件
  if (!socket.write(response)) {
    socket.once('drain', () => {});
  }
}

// 启动服务器
server.listen(7777, '0.0.0.0', () => {
  console.log('========================================');
  console.log('SOCKS5 代理服务器已启动');
  console.log('监听地址: 0.0.0.0:7777');
  console.log('========================================');
  console.log('按 Ctrl+C 停止服务器');
  console.log(''); // 空行，为客户端列表预留位置
});

// 处理服务器错误
server.on('error', (err) => {
  console.error('服务器错误:', err);
  if (err.code === 'EADDRINUSE') {
    console.error('端口 7777 已被占用，请更换端口或关闭占用该端口的程序');
  }
});

// 优雅关闭
process.on('SIGINT', () => {
  logUpdate.done(); // 保留当前输出
  console.log('\n正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logUpdate.done(); // 保留当前输出
  console.log('\n正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
