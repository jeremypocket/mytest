#!/usr/bin/env node

/**
 * 从 Figma 设计稿一键导出全部图片填充 (Image Fills)
 * 使用 Figma REST API: GET /v1/files/:key/images
 *
 * 用法:
 *   FIGMA_TOKEN=xxx node export-figma-fills.js <file-url|file-key> [--output dir]
 *   npx figma-export-fills "https://www.figma.com/design/1wQLulJIwcx2WLgGLsvbfd/Best-inc?node-id=0-1&p=f&t=KIVH3RnsFQ2dJqwM-0" --output ./out
 */

import fs from 'fs';
import path from 'path';

const FIGMA_API = 'https://api.figma.com';

// 若存在项目根目录的 .env 且 FIGMA_TOKEN 未设置，则尝试加载
function loadEnv() {
  if (process.env.FIGMA_TOKEN) return;
  try {
    const p = path.join(process.cwd(), '.env');
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const m = content.match(/FIGMA_TOKEN=(.+)/m);
      if (m) process.env.FIGMA_TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
}

function parseFileKey(input) {
  input = (input || '').trim();
  if (!input) return null;
  // 若是 URL：/design/:key/ 或 /file/:key/
  const m = input.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  if (m) return m[1];
  // 若为纯 file key（字母数字，长度约 20+）
  if (/^[a-zA-Z0-9]{20,}$/.test(input)) return input;
  return null;
}

function getExtensionFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.(png|jpg|jpeg|gif|webp)(?:\?|$)/i);
    return m ? `.${m[1].toLowerCase()}` : null;
  } catch {
    return null;
  }
}

function getExtensionFromContentType(ct) {
  if (!ct) return null;
  const m = ct.match(/image\/(png|jpeg|gif|webp)/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ext === 'jpeg' ? '.jpg' : `.${ext}`;
}

function safeFilename(s) {
  return String(s).trim().replace(/[/\\:*?"<>|]/g, '_').slice(0, 120) || 'image';
}

/** 从 document 树收集每个 imageRef 对应的首个节点名称 */
function buildRefToName(doc) {
  const refToName = {};
  function walk(n) {
    if (!n) return;
    for (const p of n.fills || []) {
      if (p.type === 'IMAGE' && p.imageRef && refToName[p.imageRef] === undefined)
        refToName[p.imageRef] = n.name;
    }
    for (const c of n.children || []) walk(c);
  }
  walk(doc);
  return refToName;
}

async function fetchFigma(path, token) {
  const url = `${FIGMA_API}${path}`;
  const res = await fetch(url, {
    headers: { 'X-FIGMA-TOKEN': token },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Figma API ${res.status}: ${t || res.statusText}`);
  }
  return res.json();
}

async function fetchImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  const buf = await res.arrayBuffer();
  const ext = getExtensionFromContentType(ct) || getExtensionFromUrl(url) || '.png';
  return { buffer: Buffer.from(buf), ext };
}

async function downloadOne(baseName, url, outputDir) {
  const { buffer, ext } = await fetchImage(url);
  const base = safeFilename(baseName);
  let filepath = path.join(outputDir, `${base}${ext}`);
  let n = 0;
  while (fs.existsSync(filepath)) {
    n++;
    filepath = path.join(outputDir, `${base}_${n}${ext}`);
  }
  fs.writeFileSync(filepath, buffer);
  return filepath;
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const outIdx = process.argv.indexOf('--output');
  const outputDir = outIdx >= 0 && process.argv[outIdx + 1]
    ? process.argv[outIdx + 1]
    : './figma-export-fills';
  const debug = process.argv.includes('--debug');

  const input = args[0];
  const token = process.env.FIGMA_TOKEN;

  if (!token) {
    console.error('请设置环境变量 FIGMA_TOKEN');
    console.error('  export FIGMA_TOKEN=你的Token');
    console.error('  或在项目根目录创建 .env 文件，写入: FIGMA_TOKEN=你的Token');
    process.exit(1);
  }

  const fileKey = parseFileKey(input);
  if (!fileKey) {
    console.error('请提供 Figma 文件 URL 或 file key');
    console.error('  示例: "https://www.figma.com/design/1wQLulJIwcx2WLgGLsvbfd/..." 或 "1wQLulJIwcx2WLgGLsvbfd"');
    process.exit(1);
  }

  console.log('[1/2] 正在获取文件结构与图片填充列表...');
  const [fileData, imagesResponse] = await Promise.all([
    fetchFigma(`/v1/files/${fileKey}`, token),
    fetchFigma(`/v1/files/${fileKey}/images`, token),
  ]);
  // Figma API 返回 { error, status, meta: { images: { [imageRef]: url } } }，需从 meta.images 读取
  const images = imagesResponse?.meta?.images ?? imagesResponse?.images ?? {};
  const entries = Object.entries(images).filter(([, url]) => url != null);

  if (entries.length === 0) {
    console.log('未发现任何图片填充，导出结束。');
    if (debug) {
      const total = Object.keys(images).length;
      const withUrl = Object.values(images).filter(Boolean).length;
      console.log('\n[--debug] /files/.../images 响应: 共 %s 个 imageRef，%s 个有下载链接', total, withUrl);
      if (total > 0) console.log('[--debug] 有 imageRef 但 URL 为空，可能需稍后重试或检查文件权限。');
      const refs = new Set();
      function walk(n) {
        if (!n) return;
        for (const p of n.fills || []) if (p.type === 'IMAGE' && p.imageRef) refs.add(p.imageRef);
        for (const c of n.children || []) walk(c);
      }
      walk(fileData?.document);
      console.log('[--debug] 遍历 document：发现 %s 个 IMAGE 型 fill（imageRef）', refs.size);
    } else {
      console.log('\n说明：本工具只导出「图片填充」(Image Fills)，即：拖入/粘贴的 .png、.jpg 等位图。');
      console.log('矢量、形状、组件、SVG 图标等不会计入。若需把 Frame/页面导出成图，需用节点渲染 API。');
      console.log('加 --debug 可查看接口返回细节。');
    }
    return;
  }

  const refToName = buildRefToName(fileData?.document);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const absOut = path.resolve(outputDir);
  const total = entries.length;
  console.log(`[2/2] 正在下载 ${total} 张图片到 ${absOut} ...\n`);

  const ok = [];
  const failed = [];

  for (let i = 0; i < entries.length; i++) {
    const [ref, url] = entries[i];
    const baseName = refToName[ref] ?? ref;
    try {
      const filepath = await downloadOne(baseName, url, absOut);
      ok.push({ ref, baseName, filepath });
      console.log(`[${i + 1}/${total}] ✓ ${baseName}`);
    } catch (e) {
      failed.push({ ref, baseName, error: e.message });
      console.log(`[${i + 1}/${total}] ✗ ${baseName}: ${e.message}`);
    }
  }

  console.log(`\n完成: 成功 ${ok.length}，失败 ${failed.length}`);
  console.log(`输出目录: ${absOut}`);
  if (failed.length > 0) {
    console.log('\n失败项:');
    failed.forEach(({ baseName, error }) => console.log(`  ${baseName}: ${error}`));
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
