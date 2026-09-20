# Figma 一键导出全部图片 — 开发计划

## 一、目标

从指定 Figma 设计稿中**一键导出全部图片**到本地目录，支持：

- **节点渲染图**：Frames、组件、形状等渲染为 PNG/JPG/SVG
- **图片填充 (Image Fills)**：设计中作为 fill 使用的位图（拖入的图片）

---

## 二、Figma 能力概览

| 类型         | API 端点                      | 说明 |
|--------------|-------------------------------|------|
| 文件结构     | `GET /v1/files/:key`          | 获取 document 树，得到所有节点 id、name、type |
| 节点渲染为图 | `GET /v1/images/:key?ids=...` | 按 node id 渲染，返回 id → 图片 URL |
| 图片填充     | `GET /v1/files/:key/images`   | 所有 imageRef → 下载 URL（内嵌位图） |

- **认证**：Header `X-FIGMA-TOKEN`（Figma Personal Access Token）
- **File Key**：从 URL 解析，本例：`1wQLulJIwcx2WLgGLsvbfd`  
  - 格式：`https://www.figma.com/design/:fileKey/:fileName?node-id=...`

参考：[Figma REST API - File Endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)

---

## 三、整体流程

```
┌─────────────────────────────────────────────────────────────────┐
│  输入：Figma 文件 URL 或 fileKey + FIGMA_TOKEN                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 解析 fileKey（若为 URL）                                      │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. GET /v1/files/:key  → 获取 document 树                        │
└─────────────────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│ 3a. 遍历 document │ │ 3b. 收集 fills 中 │ │ 3c. 收集可渲染    │
│ 提取 imageRef     │ │ 的 imageRef       │ │ 节点 id           │
│ (已在 2 的 JSON)  │ │ (已在 2 的 JSON)  │ │ (FRAME 等)        │
└───────────────────┘ └───────────────────┘ └───────────────────┘
            │                   │                   │
            └───────────────────┼───────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 获取图片 URL                                                 │
│     • Image Fills: GET /v1/files/:key/images → imageRef → URL   │
│     • 节点渲染: GET /v1/images/:key?ids=id1,id2&format=png     │
│       （ids 分批，避免单次过长或触发限流）                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. 按 URL 下载图片到本地                                         │
│     • 命名：nodeId / imageRef / 节点 name（需 sanitize）          │
│     • 目录：可按 page / 类型 分目录（可选）                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. 输出：导出数量、路径、失败列表（如有）                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、分阶段开发计划

### 阶段 0：环境与依赖（约 0.5 天）

- [ ] 初始化 Node.js 项目（`package.json`、`.gitignore`）
- [ ] 配置 `FIGMA_TOKEN`：环境变量或 `.env`（勿提交）
- [ ] 选用 HTTP 客户端：`node-fetch` 或内置 `fetch`（Node 18+）
- [ ] 可选：用 `figma-api`、`figma-export-assets` 等库减少样板代码（按需要）

**产出**：可运行的最小脚本，能带 `X-FIGMA-TOKEN` 请求 `GET /v1/files/:fileKey` 并打印 `name`。

---

### 阶段 1：解析与拉取文件结构（约 1 天）

- [ ] **解析输入**  
  - 若为 URL：正则或 `new URL` 解析出 `fileKey`  
  - 若为 `--file-key`：直接使用
- [ ] **GET /v1/files/:key**  
  - 无 `ids`、`depth` 时返回完整 document  
  - 处理 403 / 404，提示 token 或 file 权限
- [ ] **递归遍历 `document`**  
  - 收集：`id`、`name`、`type`、所在 `page`（PAGE 的 name）  
  - 收集 Paint 中的 `imageRef`（`type === 'IMAGE'` 的 fill）  
  - 判定可渲染节点：`FRAME`、`COMPONENT`、`INSTANCE`、`GROUP`、`RECTANGLE`、`ELLIPSE`、`VECTOR` 等（排除 `DOCUMENT`、`PAGE`、纯 `TEXT` 等按需）

**产出**：  
- `getFileStructure(fileKey)` → `{ nodes: [{id,name,type,page}], imageRefs: string[] }`  
- 单元测试：用一简单 fileKey 校验结构解析正确。

---

### 阶段 2：获取图片 URL（约 1 天）

- [ ] **Image Fills**  
  - `GET /v1/files/:key/images`  
  - 解析 `images: { [imageRef]: url }`，与阶段 1 的 `imageRefs` 做交集（避免多余请求）
- [ ] **节点渲染**  
  - `GET /v1/images/:key?ids=id1,id2,...,idN&format=png&scale=1`  
  - **分批**：ids 建议每批 ≤ 50–100（可配置），注意 Figma 对 `ids` 长度/次数的限制  
  - 解析 `images: { [nodeId]: url }`，`null` 表示渲染失败，记入失败列表
- [ ] **可选**：`format`（png/jpg/svg）、`scale` 做成可配置；svg 注意 `svg_include_id` 等参数

**产出**：  
- `getImageFillUrls(fileKey)` → `Map<imageRef, url>`  
- `getRenderedImageUrls(fileKey, nodeIds, options)` → `Map<nodeId, url>`，及 `failed: nodeId[]`  
- 简单集成测试：fileKey + token，能拿到至少 1 个 fill 或 1 个 node 的 URL。

---

### 阶段 3：下载与持久化（约 1 天）

- [ ] **下载单张图**  
  - `fetch(url)` 或 `node-fetch`，写到 `fs.createWriteStream`  
  - 重试 1–2 次（网络抖动），超时设置（如 30s）
- [ ] **文件命名与目录**  
  - Image Fills：`fills/{imageRef}.png`（或根据 URL 后缀选 jpg/png）  
  - 节点渲染：`nodes/{pageName}/{nodeName}_{nodeId}.png`，`nodeName` 需 sanitize（去掉 `/ \ : * ? " < > |` 等）  
  - 冲突：同名加 `_1`、`_2` 等
- [ ] **输出目录**  
  - 默认 `./figma-export/{fileKey}/` 或 `--output`  
  - 可选：`--structure flat|by-page|by-type`

**产出**：  
- `downloadImage(url, filepath)`  
- `exportImageFills(fileKey, imageRefToUrl, outputDir, naming)`  
- `exportRenderedNodes(fileKey, nodeIdToUrl, nodesMeta, outputDir, naming)`  
- 集成：阶段 1+2+3 串联，能从一个 test file 导出到本地并核对文件数、可打开性。

---

### 阶段 4：CLI 与配置（约 0.5 天）

- [ ] **CLI 参数**（示例）  
  - `--url` 或 `--file-key`（二选一）  
  - `--token` 或读 `process.env.FIGMA_TOKEN`  
  - `--output`（默认 `./figma-export/{fileKey}`）  
  - `--format`：png | jpg | svg（仅影响节点渲染）  
  - `--scale`：1 | 2 等（仅节点渲染）  
  - `--only-fills`：只导出 image fills  
  - `--only-nodes`：只导出节点渲染  
  - `--batch-size`：节点 id 每批数量（默认 50）  
  - `--structure`：flat | by-page | by-type
- [ ] **日志**  
  - 进度：`[1/3] Fetching file...`、`[2/3] Fetching image URLs...`、`[3/3] Downloading...`  
  - 汇总：成功数、失败数、输出目录  
- [ ] **错误**  
  - token 缺失、file 无权限、部分 node 渲染失败：明确报错或写 `export-errors.json`

**产出**：  
- `bin/figma-export-all` 或 `npx figma-export-all --url "..."`  
- `README.md`：安装、环境变量、常用命令示例。

---

### 阶段 5：健壮性与体验（约 1 天）

- [ ] **限流与重试**  
  - Figma 有 rate limit，请求间加简单 `delay(200)` 或按 429 退避  
  - 下载失败重试 2 次，指数退避
- [ ] **大文件**  
  - 单个渲染图超过 32MP 时 Figma 会缩放，日志注明  
  - 超多节点（>500）时提示并确认或 `--yes`
- [ ] **命名与去重**  
  - 节点 `name` 重名时：`name_id` 或 `name_id_1`  
  - 跨 page 的 `name` 可加 page 前缀：`{page}_{name}_{id}.png`
- [ ] **可选功能**  
  - `--ids`：只导出指定 node-id，逗号分隔  
  - `--version`：指定文件版本（GET files/images 的 `version` 参数）  
  - 写 `manifest.json`：`{ fileKey, exportedAt, fills: [...], nodes: [...] }` 便于后续脚本使用

**产出**：  
- 可在 1000+ 节点的文件中稳定跑通  
- `manifest.json` 与 `export-errors.json` 格式固定，便于排查与二次处理。

---

## 五、技术选型建议

| 项目     | 建议 | 说明 |
|----------|------|------|
| 运行环境 | Node 18+ | 使用原生 `fetch`，减少依赖 |
| 语言     | JavaScript 或 TypeScript | 若长期维护推荐 TS |
| HTTP     | 原生 `fetch` 或 `axios` | `axios` 便于重试、超时 |
| 配置     | `dotenv` + `process.env.FIGMA_TOKEN` | 敏感信息不入库 |
| CLI      | `commander` 或 `yargs` | 参数与 help 生成 |
| 测试     | `node:test` 或 `vitest` | 轻量、够用 |

---

## 六、本项目对应的 File Key

从你提供的链接：

```
https://www.figma.com/design/1wQLulJIwcx2WLgGLsvbfd/Best-inc?node-id=0-1&p=f&t=...
```

- **File Key**: `1wQLulJIwcx2WLgGLsvbfd`  
- **Node ID**（可选）: `0-1`，若只导出该节点可用 `--ids 0-1`。

---

## 七、Figma Token 获取

1. 打开 [Figma → Settings → Personal access tokens](https://www.figma.com/settings)  
2. 创建 token，勾选至少 `file_content:read`  
3. 配置到环境变量：  
   - `export FIGMA_TOKEN=xxx`  
   - 或在项目根目录 `.env`：`FIGMA_TOKEN=xxx`（并加入 `.gitignore`）

---

## 八、风险与注意事项

- **权限**：Token 需能访问该文件（本人创建、或已分享给你 Edit/View 的文件）。  
- **图片有效期**：  
  - 节点渲染 URL：约 30 天  
  - Image Fills URL：约 14 天  
  - 导出后本地文件永久有效。  
- **限流**：大批量时控制并发与间隔，避免 429。  
- **不可见节点**：`visible: false` 或 0 透明度可能渲染为 `null`，属预期。  
- **图片来源**：Image Fills 为设计内嵌图；若还要「仅导出从外部拖入的图片」，可只做阶段 2 的 Image Fills 分支。

---

## 九、里程碑与时间预估

| 阶段 | 内容                     | 预估   |
|------|--------------------------|--------|
| 0    | 环境与依赖               | 0.5 天 |
| 1    | 解析与文件结构           | 1 天   |
| 2    | 获取图片 URL（fills+节点）| 1 天   |
| 3    | 下载与持久化             | 1 天   |
| 4    | CLI 与配置               | 0.5 天 |
| 5    | 健壮性与体验             | 1 天   |
| **合计** |                        | **5 天** |

可按需先做「仅 Image Fills」或「仅 Frames 渲染」的 MVP（约 2 天），再扩展到全部。

---

## 十、参考

- [Figma REST API - File Endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)  
- [Figma REST API - Get image](https://www.figma.com/developers/api#get-images-endpoint)  
- [figma-export-assets](https://github.com/mariohamann/figma-export-assets)  
- [figma-tools](https://github.com/figma-tools/figma-tools)
