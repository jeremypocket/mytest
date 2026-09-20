import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取文件
const filePath = path.join(__dirname, 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 匹配 className 属性中的类名
// 这个正则表达式会匹配 className="..." 或 className={`...`} 中的内容
const classNameRegex = /className=["'`]([^"'`]*)["'`]/g;

let matchCount = 0;
let replacements = [];

// 处理每个 className
content = content.replace(classNameRegex, (match, classes) => {
  // 检查是否同时包含 absolute、left-0 和 top-*
  if (classes.includes('absolute') && classes.includes('left-0')) {
    // 检查是否有 top-* 类
    const topRegex = /\btop-[\w\[\]-]+\b/;
    if (topRegex.test(classes)) {
      matchCount++;
      
      // 移除 absolute、left-0 和 top-* 类
      let newClasses = classes
        .replace(/\babsolute\b/g, '')
        .replace(/\bleft-0\b/g, '')
        .replace(/\btop-[\w\[\]-]+\b/g, '')
        .replace(/\s+/g, ' ') // 清理多余空格
        .trim();
      
      // 添加 m-auto
      if (newClasses) {
        newClasses = 'm-auto ' + newClasses;
      } else {
        newClasses = 'm-auto';
      }
      
      // 再次清理空格
      newClasses = newClasses.replace(/\s+/g, ' ').trim();
      
      replacements.push({
        original: classes,
        replaced: newClasses
      });
      
      return match.replace(classes, newClasses);
    }
  }
  return match;
});

// 写入文件
fs.writeFileSync(filePath, content, 'utf8');

console.log(`找到并替换了 ${matchCount} 个类名`);
console.log('\n替换详情:');
replacements.forEach((r, i) => {
  console.log(`\n${i + 1}. 原类名: ${r.original}`);
  console.log(`   新类名: ${r.replaced}`);
});
