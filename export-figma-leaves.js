#!/usr/bin/env node

/**
 * 从 Figma 设计稿导出「最末端的 layer」——即叶子节点（无子节点的图层）——逐个渲染为图片
 * 使用 Figma REST API: GET /v1/files/:key 与 GET /v1/images/:key
 *
 * 用法:
 *   node export-figma-leaves.js <file-url|file-key> [--output dir] [--format png|jpg|svg] [--by-page]
 */

import fs from 'fs';
import path from 'path';

const FIGMA_API = 'https://api.figma.com';

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
  const m = input.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]{20,}$/.test(input)) return input;
  return null;
}

function safeName(s) {
  return String(s || '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'layer';
}

function safeDirName(s) {
  return String(s || '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'page';
}

function idToFile(id) {
  return String(id).replace(/:/g, '-');
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
  return Buffer.from(await res.arrayBuffer());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 遍历 document，收集所有叶子节点（无 children 或 children 为空）
 * 跳过 DOCUMENT、CANVAS(PAGE) 自身作为导出目标（它们有 children）
 */
function collectLeaves(node, out, pageName = '') {
  if (!node) return;
  const type = (node.type || '').toUpperCase();
  const children = node.children;

  if (type === 'CANVAS') {
    const nextPage = node.name || 'Page';
    for (const c of children || []) collectLeaves(c, out, nextPage);
    return;
  }
  if (type === 'DOCUMENT') {
    for (const c of children || []) collectLeaves(c, out, pageName);
    return;
  }

  const isLeaf = !children || children.length === 0;
  if (isLeaf) {
    out.push({
      id: node.id,
      name: node.name,
      type,
      pageName,
    });
  } else {
    for (const c of children) collectLeaves(c, out, pageName);
  }
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const outIdx = process.argv.indexOf('--output');
  const outputDir = outIdx >= 0 && process.argv[outIdx + 1]
    ? process.argv[outIdx + 1]
    : './figma-export-leaves';
  const byPage = process.argv.includes('--by-page');
  let format = 'png';
  const fmtIdx = process.argv.indexOf('--format') >= 0 ? process.argv.indexOf('--format') : process.argv.indexOf('-f');
  if (fmtIdx >= 0 && process.argv[fmtIdx + 1]) {
    const v = String(process.argv[fmtIdx + 1]).toLowerCase();
    if (['png', 'jpg', 'svg'].includes(v)) format = v;
  }
  const batchSize = Math.min(100, Math.max(1, parseInt(process.env.FIGMA_LEAVES_BATCH || '50', 10) || 50));

  const input = args[0];
  const token = process.env.FIGMA_TOKEN;

  if (!token) {
    console.error('请设置 FIGMA_TOKEN（环境变量或 .env）');
    process.exit(1);
  }

  const fileKey = parseFileKey(input);
  if (!fileKey) {
    console.error('请提供 Figma 文件 URL 或 file key');
    process.exit(1);
  }

  console.log('[1/3] 获取文件结构...');
  const fileData = await fetchFigma(`/v1/files/${fileKey}`, token);
  const leaves = [];
  collectLeaves(fileData?.document, leaves);

  if (leaves.length === 0) {
    console.log('未发现任何叶子节点（无子节点的 layer），导出结束。');
    return;
  }
  console.log(`[2/3] 共 %s 个叶子节点，按批渲染并下载（每批 %s，format=%s）...`, leaves.length, batchSize, format);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const absOut = path.resolve(outputDir);

  const ext = format === 'jpg' ? '.jpg' : format === 'svg' ? '.svg' : '.png';
  const ok = [];
  const failed = [];
  const batches = [];
  for (let i = 0; i < leaves.length; i += batchSize) {
    batches.push(leaves.slice(i, i + batchSize));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const ids = batch.map((l) => l.id).join(',');

    const q = new URLSearchParams({ ids, format });
    if (format === 'png' || format === 'jpg') q.set('scale', '1');
    const data = await fetchFigma(`/v1/images/${fileKey}?${q}`, token);
    const images = data?.images || {};

    for (const leaf of batch) {
      const url = images[leaf.id];
      if (!url) {
        failed.push({ id: leaf.id, name: leaf.name, reason: '渲染返回为空（可能不可见或不可渲染）' });
        continue;
      }

      const dir = byPage ? path.join(absOut, safeDirName(leaf.pageName)) : absOut;
      if (byPage && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const base = `${safeName(leaf.name || leaf.type)}_${idToFile(leaf.id)}`;
      let filepath = path.join(dir, `${base}${ext}`);
      let n = 0;
      while (fs.existsSync(filepath)) {
        n++;
        filepath = path.join(dir, `${base}_${n}${ext}`);
      }

      try {
        const buf = await fetchImage(url);
        fs.writeFileSync(filepath, buf);
        ok.push({ id: leaf.id, name: leaf.name, filepath });
      } catch (e) {
        failed.push({ id: leaf.id, name: leaf.name, reason: e.message });
      }
    }

    if (b < batches.length - 1) await sleep(300);
  }

  console.log('[3/3] 完成: 成功 %s，失败 %s', ok.length, failed.length);
  console.log('输出目录: %s', absOut);
  if (failed.length > 0 && failed.length <= 20) {
    console.log('\n失败节点:');
    failed.forEach(({ name, id, reason }) => console.log('  %s (%s): %s', name || id, id, reason));
  } else if (failed.length > 20) {
    console.log('\n失败 %s 个（多为不可见或 0 透明度）', failed.length);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
