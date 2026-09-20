# Figma 导出工具

## 1. 导出图片填充（Image Fills）

从 Figma 设计稿导出**图片填充**（拖入的 .png、.jpg 等位图）。

```bash
node export-figma-fills.js "文件URL或fileKey" [--output dir]
```

- 输出：`imageRef.ext`，默认目录 `./figma-export-fills`
- 仅包含位图填充，矢量、SVG、组件内矢量不算

---

## 2. 导出最末端 Layer（叶子节点）

从 Figma 设计稿导出**所有叶子节点**（没有子节点的 layer）——如矩形、图片、矢量、文本、以及空的 Frame/Group——逐个渲染为图片。

```bash
node export-figma-leaves.js "文件URL或fileKey" [--output dir] [--format png|jpg|svg] [--by-page]
```

| 参数 | 说明 |
|------|------|
| `--output` | 输出目录，默认 `./figma-export-leaves` |
| `--format` | `png`（默认）、`jpg`、`svg` |
| `--by-page` | 按页面建子目录存放 |

- 输出：`{图层名}_{nodeId}.png`，重名加 `_1`、`_2`
- 不可见、0 透明度的节点渲染会为空，计入失败

---

## 前置

- Node.js 18+
- **Figma Token**： [Figma 设置 → Personal access tokens](https://www.figma.com/settings) 新建，勾选 `file_content:read`
- 对目标文件有 View 或 Edit 权限  
- Token 可写在项目根目录 `.env`：`FIGMA_TOKEN=xxx`
