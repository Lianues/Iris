# 媒体处理层

## 职责

处理用户上传的图片和文档，在进入 LLM 调用之前完成预处理。

- **图片缩放**：自动将图片缩放到 API 限制以内（尺寸 + 文件大小）
- **文档提取**：从 PDF / DOCX / PPTX / XLSX 及文本/代码文件中提取可读内容
- **Office 转 PDF**：将 Office 文档转为 PDF 以利用 LLM 原生 PDF 能力（可选，需 LibreOffice）

## 文件结构

```
src/media/
├── index.ts             统一导出
├── image-resize.ts      图片缩放（sharp）
├── document-extract.ts  文档文本提取
└── office-to-pdf.ts     Office → PDF 转换（LibreOffice）
```

---

## 图片缩放

`resizeImage(mimeType, base64Data, options?)` — 自动将图片缩放到安全范围内。

### 默认限制

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxWidth` | 2000 | 最大宽度（像素） |
| `maxHeight` | 2000 | 最大高度（像素） |
| `maxBytes` | 4.5MB | 最大文件大小（低于 Anthropic 5MB 限制） |
| `jpegQuality` | 80 | JPEG 压缩质量 |

### 缩放策略

1. 先按 maxWidth / maxHeight 等比缩放
2. 同时尝试 PNG 和 JPEG，选文件更小的格式
3. 若仍超 maxBytes，逐步降低 JPEG 质量（85 → 70 → 55 → 40）
4. 若仍超，逐步缩小尺寸（75% → 50% → 35% → 25%）
5. 已在限制内的图片直接返回，不做处理

### 返回值

```typescript
interface ResizedImage {
  data: string;          // base64
  mimeType: string;      // 可能从 PNG 变为 JPEG
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
}
```

缩放后会生成坐标映射说明（`formatDimensionNote`），帮助模型理解原图与缩放后的坐标关系。

### 平台兼容

sharp 采用延迟加载，不支持的平台（如 Termux/Android）在不使用图片功能时不会崩溃。

---

## 文档提取

`extractDocument(doc: DocumentInput)` — 从各类文档中提取文本内容。

### 支持的格式

**二进制文档：**

| 格式 | MIME | 提取方式 |
|------|------|----------|
| PDF | `application/pdf` | pdf-parse，按页提取 |
| DOCX | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | mammoth 提取纯文本 |
| PPTX | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | JSZip 解析 XML，提取幻灯片文本和批注 |
| XLSX / XLS | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | xlsx 库，按 sheet 转 CSV |

**文本/代码文件：**

支持 40+ 种扩展名，包括 `.md`、`.json`、`.yaml`、`.xml`、`.py`、`.js`、`.ts`、`.java`、`.go`、`.rs`、`.sql`、`.css`、`.vue` 等。按扩展名自动识别语言并用代码块包裹。

### 输入/输出

```typescript
interface DocumentInput {
  fileName: string;
  mimeType: string;
  data: string;      // base64
}

interface ExtractedDocument {
  fileName: string;
  text: string;       // 提取的文本内容
  success: boolean;
  error?: string;
}
```

### 限制

- 单文件最大 50MB
- 自动检测二进制内容并拒绝按文本处理
- 支持 BOM 检测（UTF-8 / UTF-16LE / UTF-16BE）

---

## Office 转 PDF

`convertToPDF(buffer, ext)` — 将 Office 文档转为 PDF。

### 前置条件

需同时满足：

1. 系统安装 LibreOffice（`libreoffice --version` 或 `soffice --version` 可执行）
2. 安装 npm 包 `libreoffice-convert`（可选依赖）

不满足时平滑降级——`convertToPDF` 返回 `null`，Backend 自动回退到文本提取。

### 用途

当 LLM 端点支持原生 PDF（如 Gemini、Claude、OpenAI Responses）时，Office 文档先转 PDF 再直传，比纯文本提取保留更多格式信息。

### 检测函数

| 函数 | 说明 |
|------|------|
| `isLibreOfficeAvailable()` | LibreOffice 二进制是否可用（结果缓存） |
| `isNpmPackageAvailable()` | libreoffice-convert 包是否安装（结果缓存） |
| `isConversionAvailable()` | 两者同时满足 |
| `resetAvailabilityCache()` | 清除缓存（安装新依赖后调用） |

---

## 在 Backend 中的集成

Backend 在 `buildStoredUserParts()` 中按以下优先级处理上传的文档：

```
文档上传
  │
  ├─ PDF + 端点支持原生 PDF → 直传 inlineData
  │
  ├─ Office + 端点支持原生 PDF → 先转 PDF 再直传
  │   └─ 转换失败 + 端点支持原生 Office → 直传原格式
  │   └─ 转换失败 → 回退文本提取
  │
  ├─ Office + 端点支持原生 Office → 直传原格式
  │
  └─ 其余情况 → extractDocument() 文本提取
```

图片上传的处理：

```
图片上传
  │
  ├─ resizeImage() 自动缩放
  │
  ├─ 主模型支持 vision → 直传缩放后图片
  │
  ├─ 主模型不支持 vision + 有 OCR → OCR 提取文本
  │
  └─ 主模型不支持 vision + 无 OCR → 占位提示
```
