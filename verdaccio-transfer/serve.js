#!/usr/bin/env node
/**
 * 在 verdaccio 目录启动文件服务。
 * storage 默认禁止访问，仅开放：
 *   - storage/.verdaccio-db.json
 *   - storage/@best/**
 *   - storage/@test/**
 *
 * 用法:
 *   cd /path/to/verdaccio
 *   node /path/to/serve.js
 *   # 或指定目录与端口:
 *   node serve.js --root /path/to/verdaccio --port 8765
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.root || process.cwd());
const PORT = Number(args.port || 8765);
const HOST = args.host || "0.0.0.0";

const ALLOWED_STORAGE_PREFIXES = ["@best/", "@test/"];
const ALLOWED_STORAGE_FILES = [".verdaccio-db.json"];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i];
    else if (a === "--port") out.port = argv[++i];
    else if (a === "--host") out.host = argv[++i];
  }
  return out;
}

function isAllowed(relPosix) {
  if (!relPosix || relPosix === ".") return true;
  if (relPosix === "storage" || relPosix === "storage/") return true; // 仅用于列目录时过滤
  if (!relPosix.startsWith("storage/") && relPosix !== "storage") return true;

  const rest = relPosix.slice("storage/".length);
  if (ALLOWED_STORAGE_FILES.includes(rest)) return true;
  return ALLOWED_STORAGE_PREFIXES.some(
    (p) => rest === p.slice(0, -1) || rest.startsWith(p)
  );
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".json": "application/json; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
    ".yml": "text/yml; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".sh": "text/x-shellscript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return { full, rel: path.relative(ROOT, full).split(path.sep).join("/") || "." };
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end("Method Not Allowed");
  }

  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // 机器可读目录列表：GET /__list?path=storage/@best
  if (u.pathname === "/__list") {
    const reqPath = u.searchParams.get("path") || ".";
    const resolved = safeResolve("/" + reqPath);
    if (!resolved) return sendJson(res, 400, { error: "invalid path" });
    if (!isAllowed(resolved.rel === "." ? "." : resolved.rel)) {
      return sendJson(res, 403, { error: "forbidden" });
    }
    let stat;
    try {
      stat = fs.statSync(resolved.full);
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
    if (!stat.isDirectory()) {
      return sendJson(res, 400, { error: "not a directory" });
    }

    let names;
    try {
      names = fs.readdirSync(resolved.full);
    } catch {
      return sendJson(res, 500, { error: "readdir failed" });
    }

    const entries = [];
    for (const name of names) {
      const childRel =
        resolved.rel === "." ? name : `${resolved.rel}/${name}`;
      if (!isAllowed(childRel)) continue;
      const childFull = path.join(resolved.full, name);
      let st;
      try {
        st = fs.statSync(childFull);
      } catch {
        continue;
      }
      entries.push({
        name,
        type: st.isDirectory() ? "dir" : "file",
        size: st.isFile() ? st.size : undefined,
      });
    }
    return sendJson(res, 200, { path: resolved.rel, entries });
  }

  const resolved = safeResolve(u.pathname);
  if (!resolved) {
    res.writeHead(400);
    return res.end("Bad Request");
  }
  if (!isAllowed(resolved.rel)) {
    res.writeHead(403);
    return res.end("Forbidden: storage path not allowed");
  }

  let stat;
  try {
    stat = fs.statSync(resolved.full);
  } catch {
    res.writeHead(404);
    return res.end("Not Found");
  }

  if (stat.isDirectory()) {
    // 浏览器看目录时给个简单提示；机器请用 /__list
    return sendJson(res, 200, {
      hint: "Use GET /__list?path=" + encodeURIComponent(resolved.rel),
      path: resolved.rel,
    });
  }

  res.writeHead(200, {
    "Content-Type": contentType(resolved.full),
    "Content-Length": stat.size,
    "Access-Control-Allow-Origin": "*",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(resolved.full).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`Listening http://${HOST}:${PORT}`);
  console.log("Allowed under storage:");
  console.log("  - .verdaccio-db.json");
  console.log("  - @best/");
  console.log("  - @test/");
});
