#!/usr/bin/env node
/**
 * 从源机 Node 文件服务下载 verdaccio 配置（不打包）。
 * 会拉取根目录全部文件/目录，但 storage 仅拉取：
 *   - storage/.verdaccio-db.json
 *   - storage/@best/**
 *   - storage/@test/**
 *
 * 用法:
 *   node download.js
 *   node download.js --dest ./verdaccio
 *   node download.js --base http://10.30.4.253:8765 --dest ./verdaccio
 *
 * 默认源地址: http://10.30.4.253:8765
 *
 * 下载后脚本权限不会保留，需要时手动:
 *   chmod +x ./verdaccio/*.sh
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const args = parseArgs(process.argv.slice(2));
const BASE = (args.base || "http://10.30.4.253:8765").replace(/\/+$/, "");
const DEST = path.resolve(args.dest || "./verdaccio");

const SKIP_STORAGE_OTHERS = true;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--dest") out.dest = argv[++i];
  }
  return out;
}

function request(urlPath) {
  const url = new URL(urlPath.startsWith("http") ? urlPath : `${BASE}${urlPath}`);
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(request(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
  });
}

async function listDir(relPath) {
  const q = encodeURIComponent(relPath || ".");
  const buf = await request(`/__list?path=${q}`);
  const data = JSON.parse(buf.toString("utf8"));
  if (!Array.isArray(data.entries)) throw new Error("invalid __list response");
  return data.entries;
}

function shouldEnterStorageChild(name) {
  return (
    name === ".verdaccio-db.json" ||
    name === "@best" ||
    name === "@test"
  );
}

async function downloadFile(relPosix, destFile) {
  const urlPath =
    "/" +
    relPosix
      .split("/")
      .map(encodeURIComponent)
      .join("/");
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const buf = await request(urlPath);
  fs.writeFileSync(destFile, buf);
  console.log(`file  ${relPosix}  (${buf.length} bytes)`);
}

async function walk(relPosix) {
  const entries = await listDir(relPosix === "." ? "." : relPosix);

  for (const ent of entries) {
    const childRel = relPosix === "." ? ent.name : `${relPosix}/${ent.name}`;

    if (SKIP_STORAGE_OTHERS && childRel === "storage" && ent.type === "dir") {
      fs.mkdirSync(path.join(DEST, "storage"), { recursive: true });
      console.log(`dir   storage/ (filtered)`);
      const storageEntries = await listDir("storage");
      for (const s of storageEntries) {
        if (!shouldEnterStorageChild(s.name)) {
          console.log(`skip  storage/${s.name}`);
          continue;
        }
        const sRel = `storage/${s.name}`;
        if (s.type === "dir") {
          await walk(sRel);
        } else {
          await downloadFile(sRel, path.join(DEST, ...sRel.split("/")));
        }
      }
      continue;
    }

    if (ent.type === "dir") {
      fs.mkdirSync(path.join(DEST, ...childRel.split("/")), {
        recursive: true,
      });
      console.log(`dir   ${childRel}/`);
      await walk(childRel);
    } else {
      await downloadFile(childRel, path.join(DEST, ...childRel.split("/")));
    }
  }
}

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  console.log(`From: ${BASE}`);
  console.log(`To:   ${DEST}`);
  await walk(".");
  console.log("done");
  console.log("如需可执行权限: chmod +x " + path.join(DEST, "*.sh"));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
