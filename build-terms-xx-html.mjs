import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const p = (text) =>
  `<div style="margin:0 0 10px;font-size:12.5px;line-height:1.55;color:#2a2a2a;white-space:pre-line;">${esc(
    text
  )}</div>`;

const redTitle = (text) =>
  `<div style="margin:0 0 6px;font-size:13px;font-weight:700;color:#d3132a;font-family:Arial,Helvetica,sans-serif;">${esc(
    text
  )}</div>`;

const numline = (num, inner) =>
  `<div style="display:grid;grid-template-columns:72px 1fr;column-gap:10px;align-items:start;margin:0 0 10px;">
  <div style="font-size:13px;font-weight:700;color:#111;line-height:1.55;">${esc(num)}</div>
  <div>${inner}</div>
</div>`;

const olAlpha = (items) =>
  `<ol style="margin:0 0 10px 0;padding-left:22px;font-size:12.5px;line-height:1.55;color:#2a2a2a;list-style:lower-alpha;">
${items
  .map(
    (t) =>
      `  <li style="margin:0 0 6px;white-space:pre-line;">${esc(t)}</li>`
  )
  .join("\n")}
</ol>`;

function stripLeadingLetterMarker(line) {
  const m = line.match(/^\s*[a-zA-Z]\)\s*(.*)$/);
  return m ? m[1] : line;
}

function isBlank(l) {
  return l.trim() === "";
}

function numOnlyLine(l) {
  return l.match(/^(\d+(?:\.\d+)*)\.?\s*$/);
}

const TITLE_LINE_MAX_CHARS = 110;
const TITLE_MAX_LINES = 4;

function isPart1NewTopSection(l) {
  return (
    l.trim() === "DEFINITION" ||
    !!numOnlyLine(l) ||
    /^(\d+)\.\s+(.+)/.test(l)
  );
}

function isPart2NewTopSection(l) {
  return !!numOnlyLine(l) || /^(\d+)\s*$/.test(l);
}

/**
 * Part 1: title, intro, DEFINITION block, numbered sections with optional letter lists.
 */
function parsePart1(lines) {
  let i = 0;
  const html = [];

  const skipBlanks = () => {
    while (i < lines.length && isBlank(lines[i])) i++;
  };

  skipBlanks();
  const title = (lines[i++] ?? "").trim();
  html.push(
    `<div style="margin:0 0 18px;text-align:center;font-size:16px;font-weight:700;letter-spacing:0.2px;">${esc(
      title
    )}</div>`
  );
  skipBlanks();

  const readFreetextParagraph = () => {
    const buf = [];
    while (i < lines.length && !isBlank(lines[i])) {
      const l = lines[i];
      if (l.trim() === "DEFINITION") break;
      const mMain = l.match(/^(\d+)\.\s+(.+)/);
      if (mMain) break;
      if (numOnlyLine(l)) break;
      buf.push(l);
      i++;
    }
    skipBlanks();
    return buf.join("\n").trimEnd();
  };

  const readNumberedBlock = () => {
    const m = numOnlyLine(lines[i]);
    if (!m) return null;
    let num = m[1];
    if (num.endsWith(".")) num = num.slice(0, -1);
    i++;
    skipBlanks();

    const titleBuf = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      titleBuf.length < TITLE_MAX_LINES
    ) {
      const l = lines[i];
      if (/^\s*[a-zA-Z]\)\s*/.test(l)) break;
      if (numOnlyLine(l)) break;
      const mMain = l.match(/^(\d+)\.\s+(.+)/);
      if (mMain) break;
      if (l.length > TITLE_LINE_MAX_CHARS) break;
      titleBuf.push(l);
      i++;
    }
    const subTitle = titleBuf.join("\n").trim();

    const parts = [];
    const listItems = [];
    const flushList = () => {
      if (listItems.length) {
        parts.push({ type: "list", items: listItems.splice(0) });
      }
    };
    let textLines = [];
    const flushText = () => {
      if (textLines.length) {
        parts.push({ type: "text", text: textLines.join("\n") });
        textLines = [];
      }
    };

    while (i < lines.length) {
      if (isBlank(lines[i])) {
        i++;
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j >= lines.length) {
          i = j;
          flushText();
          flushList();
          break;
        }
        const next = lines[j];
        if (isPart1NewTopSection(next)) {
          i = j;
          flushText();
          flushList();
          break;
        }
        flushText();
        i = j;
        continue;
      }
      const l = lines[i];
      if (numOnlyLine(l)) {
        flushText();
        flushList();
        break;
      }
      const mMain = l.match(/^(\d+)\.\s+(.+)/);
      if (mMain) {
        flushText();
        flushList();
        break;
      }

      if (/^\s*[a-zA-Z]\)\s*/.test(l)) {
        flushText();
        flushList();
        listItems.push(stripLeadingLetterMarker(l));
        i++;
        continue;
      }

      flushList();
      textLines.push(l);
      i++;
    }

    flushText();
    flushList();

    let inner = "";
    if (subTitle) inner += redTitle(subTitle);
    for (const part of parts) {
      if (part.type === "list") inner += olAlpha(part.items);
      if (part.type === "text") inner += p(part.text);
    }
    return numline(num, inner);
  };

  while (i < lines.length) {
    skipBlanks();
    if (i >= lines.length) break;

    const l = lines[i];

    if (l.trim() === "DEFINITION") {
      i++;
      skipBlanks();
      html.push(redTitle("DEFINITION"));
      continue;
    }

    const mMain = l.match(/^(\d+)\.\s+(.+)/);
    if (mMain) {
      const num = mMain[1];
      const titleRest = mMain[2].trim();
      i++;
      skipBlanks();

      const bodyParas = [];
      let cur = [];
      const flush = () => {
        if (cur.length) {
          bodyParas.push(cur.join("\n"));
          cur = [];
        }
      };
      while (i < lines.length) {
        if (isBlank(lines[i])) {
          i++;
          let j = i;
          while (j < lines.length && isBlank(lines[j])) j++;
          if (j >= lines.length) {
            i = j;
            break;
          }
          const next = lines[j];
          if (isPart1NewTopSection(next)) {
            i = j;
            break;
          }
          flush();
          i = j;
          continue;
        }
        const curLine = lines[i];
        if (isPart1NewTopSection(curLine)) break;
        cur.push(curLine);
        i++;
      }
      flush();
      skipBlanks();

      const inner =
        redTitle(titleRest.toUpperCase()) +
        bodyParas.map((t) => p(t)).join("");
      html.push(numline(num, inner));
      continue;
    }

    if (numOnlyLine(l)) {
      const block = readNumberedBlock();
      if (block) html.push(block);
      continue;
    }

    const para = readFreetextParagraph();
    if (para) html.push(p(para));
  }

  return html.join("\n");
}

/**
 * Part 2: starts at 3.2; includes "4" + title on next line for sections 4–7.
 */
function parsePart2(lines) {
  let i = 0;
  const html = [];

  const skipBlanks = () => {
    while (i < lines.length && isBlank(lines[i])) i++;
  };

  const readNumberedBlock = () => {
    const m = numOnlyLine(lines[i]);
    if (!m) return null;
    let num = m[1];
    if (num.endsWith(".")) num = num.slice(0, -1);
    i++;
    skipBlanks();

    const titleBuf = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      titleBuf.length < TITLE_MAX_LINES
    ) {
      const l = lines[i];
      if (/^\s*[a-zA-Z]\)\s*/.test(l)) break;
      if (numOnlyLine(l)) break;
      if (/^(\d+)\s*$/.test(l)) break;
      if (l.length > TITLE_LINE_MAX_CHARS) break;
      titleBuf.push(l);
      i++;
    }
    const subTitle = titleBuf.join("\n").trim();

    const parts = [];
    const listItems = [];
    const flushList = () => {
      if (listItems.length) {
        parts.push({ type: "list", items: listItems.splice(0) });
      }
    };
    let textLines = [];
    const flushText = () => {
      if (textLines.length) {
        parts.push({ type: "text", text: textLines.join("\n") });
        textLines = [];
      }
    };

    while (i < lines.length) {
      if (isBlank(lines[i])) {
        i++;
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j >= lines.length) {
          i = j;
          flushText();
          flushList();
          break;
        }
        const next = lines[j];
        if (isPart2NewTopSection(next)) {
          i = j;
          flushText();
          flushList();
          break;
        }
        flushText();
        i = j;
        continue;
      }
      const l = lines[i];
      if (numOnlyLine(l)) {
        flushText();
        flushList();
        break;
      }
      if (/^(\d+)\s*$/.test(l)) {
        flushText();
        flushList();
        break;
      }

      if (/^\s*[a-zA-Z]\)\s*/.test(l)) {
        flushText();
        flushList();
        listItems.push(stripLeadingLetterMarker(l));
        i++;
        continue;
      }

      flushList();
      textLines.push(l);
      i++;
    }

    flushText();
    flushList();

    let inner = "";
    if (subTitle) inner += redTitle(subTitle);
    for (const part of parts) {
      if (part.type === "list") inner += olAlpha(part.items);
      if (part.type === "text") inner += p(part.text);
    }
    return numline(num, inner);
  };

  while (i < lines.length) {
    skipBlanks();
    if (i >= lines.length) break;
    const l = lines[i];

    if (numOnlyLine(l)) {
      const block = readNumberedBlock();
      if (block) html.push(block);
      continue;
    }

    const loneNum = l.match(/^(\d+)\s*$/);
    if (loneNum) {
      const num = loneNum[1];
      i++;
      skipBlanks();
      const buf = [];
      while (i < lines.length && !isBlank(lines[i])) {
        if (numOnlyLine(lines[i])) break;
        if (/^(\d+)\s*$/.test(lines[i])) break;
        buf.push(lines[i]);
        i++;
      }
      skipBlanks();
      const titleLine = buf.join("\n").trim();
      html.push(numline(num, redTitle(titleLine.toUpperCase())));
      continue;
    }

    const buf = [];
    while (i < lines.length && !isBlank(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    skipBlanks();
    const text = buf.join("\n").trimEnd();
    if (text) html.push(p(text));
  }

  return html.join("\n");
}

const part1Path = path.join(__dirname, "Terms & Condition Part 1.txt");
const part2Path = path.join(__dirname, "Terms & Condition Part 2.txt");
const part1 = fs.readFileSync(part1Path, "utf8");
const part2 = fs.readFileSync(part2Path, "utf8");

const lines1 = part1.replace(/\r\n/g, "\n").split("\n");
const lines2 = part2.replace(/\r\n/g, "\n").split("\n");

const body1 = parsePart1(lines1);
const body2 = parsePart2(lines2);

const out = `<div style="background:#f5f2d6;padding:36px 0;box-sizing:border-box;">
  <div
    style="
      width:min(980px, calc(100% - 56px));
      margin:0 auto;
      background:#ffffff;
      border-radius:18px;
      padding:42px 46px;
      box-shadow:0 10px 24px rgba(0, 0, 0, 0.06);
      box-sizing:border-box;
      font-family:'Times New Roman', Times, serif;
      color:#1b1b1b;
      -webkit-font-smoothing:antialiased;
      -moz-osx-font-smoothing:grayscale;
    "
    aria-label="Terms and Conditions document"
  >
${body1}
${body2}
  </div>
</div>
`;

const outPath = path.join(__dirname, "xx.html");
fs.writeFileSync(outPath, out, "utf8");
console.log("Wrote", outPath);
