import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);
// ../../packages/extension-sdk/dist/logger.js
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
var _logLevel = LogLevel.INFO;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= LogLevel.DEBUG)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= LogLevel.INFO)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= LogLevel.WARN)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= LogLevel.ERROR)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/dist/plugin/context.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/image-resize.ts
var DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;
var DEFAULT_OPTIONS = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: DEFAULT_MAX_BYTES,
  jpegQuality: 80
};
var _sharp = null;
async function getSharp() {
  if (!_sharp) {
    const mod = await import("sharp");
    _sharp = mod.default ?? mod;
  }
  return _sharp;
}
async function resizeImage(mimeType, base64Data, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const inputBuffer = Buffer.from(base64Data, "base64");
  try {
    const sharp = await getSharp();
    const metadata = await sharp(inputBuffer).metadata();
    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;
    if (originalWidth === 0 || originalHeight === 0) {
      return {
        data: base64Data,
        mimeType,
        originalWidth: 0,
        originalHeight: 0,
        width: 0,
        height: 0,
        wasResized: false
      };
    }
    if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && inputBuffer.length <= opts.maxBytes) {
      return {
        data: base64Data,
        mimeType,
        originalWidth,
        originalHeight,
        width: originalWidth,
        height: originalHeight,
        wasResized: false
      };
    }
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    if (targetWidth > opts.maxWidth) {
      targetHeight = Math.round(targetHeight * opts.maxWidth / targetWidth);
      targetWidth = opts.maxWidth;
    }
    if (targetHeight > opts.maxHeight) {
      targetWidth = Math.round(targetWidth * opts.maxHeight / targetHeight);
      targetHeight = opts.maxHeight;
    }
    async function tryBothFormats(width, height, jpegQuality) {
      const resized = sharp(inputBuffer).resize(width, height, {
        fit: "inside",
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3
      });
      const [pngResult, jpegResult] = await Promise.all([
        resized.clone().png().toBuffer({ resolveWithObject: true }),
        resized.clone().jpeg({ quality: jpegQuality }).toBuffer({ resolveWithObject: true })
      ]);
      const picked = pngResult.data.length <= jpegResult.data.length ? { buffer: pngResult.data, mimeType: "image/png", actualWidth: pngResult.info.width, actualHeight: pngResult.info.height } : { buffer: jpegResult.data, mimeType: "image/jpeg", actualWidth: jpegResult.info.width, actualHeight: jpegResult.info.height };
      return picked;
    }
    const qualitySteps = [85, 70, 55, 40];
    const scaleSteps = [1, 0.75, 0.5, 0.35, 0.25];
    let best;
    best = await tryBothFormats(targetWidth, targetHeight, opts.jpegQuality);
    if (best.buffer.length <= opts.maxBytes) {
      return {
        data: best.buffer.toString("base64"),
        mimeType: best.mimeType,
        originalWidth,
        originalHeight,
        width: best.actualWidth,
        height: best.actualHeight,
        wasResized: true
      };
    }
    for (const quality of qualitySteps) {
      best = await tryBothFormats(targetWidth, targetHeight, quality);
      if (best.buffer.length <= opts.maxBytes) {
        return {
          data: best.buffer.toString("base64"),
          mimeType: best.mimeType,
          originalWidth,
          originalHeight,
          width: best.actualWidth,
          height: best.actualHeight,
          wasResized: true
        };
      }
    }
    for (const scale of scaleSteps) {
      const scaledWidth = Math.round(targetWidth * scale);
      const scaledHeight = Math.round(targetHeight * scale);
      if (scaledWidth < 100 || scaledHeight < 100) {
        break;
      }
      for (const quality of qualitySteps) {
        best = await tryBothFormats(scaledWidth, scaledHeight, quality);
        if (best.buffer.length <= opts.maxBytes) {
          return {
            data: best.buffer.toString("base64"),
            mimeType: best.mimeType,
            originalWidth,
            originalHeight,
            width: best.actualWidth,
            height: best.actualHeight,
            wasResized: true
          };
        }
      }
    }
    return {
      data: best.buffer.toString("base64"),
      mimeType: best.mimeType,
      originalWidth,
      originalHeight,
      width: best.actualWidth,
      height: best.actualHeight,
      wasResized: true
    };
  } catch {
    return {
      data: base64Data,
      mimeType,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
      wasResized: false
    };
  }
}
function formatDimensionNote(result) {
  if (!result.wasResized) {
    return;
  }
  const scale = result.originalWidth / result.width;
  return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}

// src/document-extract.ts
import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
var MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;
var SUPPORTED_BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
]);
var SUPPORTED_TEXT_MIME_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/ld+json",
  "application/xml",
  "image/svg+xml",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml",
  "application/toml",
  "text/x-toml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-shellscript",
  "application/sql"
]);
var EXTENSION_TO_MIME = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonc": "application/json",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
  ".env": "text/plain",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".py": "text/x-python",
  ".js": "application/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++src",
  ".hpp": "text/x-c++src",
  ".cc": "text/x-c++src",
  ".cs": "text/plain",
  ".go": "text/plain",
  ".rs": "text/plain",
  ".php": "application/x-httpd-php",
  ".rb": "text/plain",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".zsh": "application/x-sh",
  ".ps1": "text/plain",
  ".sql": "application/sql",
  ".css": "text/css",
  ".scss": "text/plain",
  ".less": "text/plain",
  ".vue": "text/plain"
};
var EXTENSION_TO_LANGUAGE = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".svg": "xml",
  ".html": "html",
  ".htm": "html",
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".rs": "rust",
  ".php": "php",
  ".rb": "ruby",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ps1": "powershell",
  ".sql": "sql",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".vue": "vue",
  ".csv": "csv",
  ".tsv": "tsv"
};
function normalizeMimeType(mimeType) {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}
function getFileExtension(fileName) {
  return fileName?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
}
function isSupportedTextMime(mimeType) {
  return mimeType.startsWith("text/") || SUPPORTED_TEXT_MIME_TYPES.has(mimeType);
}
function resolveSupportedDocumentMime(mimeType, fileName) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (SUPPORTED_BINARY_MIME_TYPES.has(normalizedMimeType) || isSupportedTextMime(normalizedMimeType)) {
    return normalizedMimeType;
  }
  const ext = getFileExtension(fileName);
  if (!ext)
    return null;
  return EXTENSION_TO_MIME[ext] ?? null;
}
function isSupportedDocumentMime(mimeType, fileName) {
  return resolveSupportedDocumentMime(mimeType, fileName) !== null;
}
async function extractDocument(doc) {
  try {
    const buffer = Buffer.from(doc.data, "base64");
    if (buffer.length > MAX_DOCUMENT_SIZE) {
      return {
        fileName: doc.fileName,
        text: "",
        success: false,
        error: `文件过大 (${(buffer.length / 1024 / 1024).toFixed(1)}MB)，最大支持 50MB`
      };
    }
    const effectiveMime = resolveSupportedDocumentMime(doc.mimeType, doc.fileName);
    switch (effectiveMime) {
      case "application/pdf":
        return await processPdf(buffer, doc.fileName);
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return await processDocx(buffer, doc.fileName);
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return await processPptx(buffer, doc.fileName);
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      case "application/vnd.ms-excel":
        return await processExcel(buffer, doc.fileName);
      case null:
        return unsupportedDocument(doc.fileName, doc.mimeType);
      default:
        return await processTextDocument(buffer, doc.fileName, effectiveMime);
    }
  } catch (err) {
    return {
      fileName: doc.fileName,
      text: "",
      success: false,
      error: `文档处理失败: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
function unsupportedDocument(fileName, mimeType) {
  return {
    fileName,
    text: "",
    success: false,
    error: `不支持的文档格式: ${mimeType}`
  };
}
async function processTextDocument(buffer, fileName, mimeType) {
  try {
    if (looksLikeBinaryBuffer(buffer)) {
      return {
        fileName,
        text: "",
        success: false,
        error: "检测到疑似二进制内容，无法按文本文件读取"
      };
    }
    const ext = getFileExtension(fileName);
    const language = EXTENSION_TO_LANGUAGE[ext] ?? "text";
    const decoded = decodeTextBuffer(buffer).replace(/^\uFEFF/, "").replace(/\u0000/g, "").replace(/\r\n?/g, `
`);
    const content = decoded.trim().length > 0 ? decoded.trimEnd() : "(空文件)";
    const extractedText = [
      `[MimeType: ${mimeType || "text/plain"}]`,
      `[Language: ${language}]`,
      "````" + (language === "text" ? "" : language),
      content,
      "````"
    ].join(`
`);
    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`文本文件处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function decodeTextBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191) {
    return buffer.toString("utf8", 3);
  }
  if (buffer.length >= 2 && buffer[0] === 255 && buffer[1] === 254) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 254 && buffer[1] === 255) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let index = 0;index + 1 < swapped.length; index += 2) {
      const first = swapped[index];
      swapped[index] = swapped[index + 1];
      swapped[index + 1] = first;
    }
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}
function looksLikeBinaryBuffer(buffer) {
  let startIndex = 0;
  if (buffer.length >= 3 && buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191) {
    startIndex = 3;
  } else if (buffer.length >= 2 && (buffer[0] === 255 && buffer[1] === 254 || buffer[0] === 254 && buffer[1] === 255)) {
    startIndex = 2;
  }
  const sample = buffer.subarray(startIndex, Math.min(buffer.length, startIndex + 2048));
  let suspiciousBytes = 0;
  for (const byte of sample) {
    if (byte === 0)
      return true;
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (!isAllowedControl && (byte >= 0 && byte < 8 || byte > 13 && byte < 32)) {
      suspiciousBytes += 1;
    }
  }
  return sample.length > 0 && suspiciousBytes / sample.length > 0.1;
}
async function processPdf(buffer, fileName) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await parser.getText();
    let extractedText = `<pdf filename="${escapeXml(fileName)}">`;
    if (textResult.pages.length === 0) {
      extractedText += `
<page number="1">
${textResult.text.trim()}
</page>`;
    } else {
      for (const page of textResult.pages) {
        const pageText = page.text.trim();
        if (pageText) {
          extractedText += `
<page number="${page.num}">
${pageText}
</page>`;
        }
      }
    }
    extractedText += `
</pdf>`;
    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`PDF 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await parser.destroy().catch(() => {});
  }
}
async function processDocx(buffer, fileName) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    let extractedText = `<docx filename="${escapeXml(fileName)}">`;
    extractedText += `
<page number="1">
${text}
</page>`;
    extractedText += `
</docx>`;
    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`DOCX 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function processPptx(buffer, fileName) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    let extractedText = `<pptx filename="${escapeXml(fileName)}">`;
    const slideFiles = Object.keys(zip.files).filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/)).sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || "0", 10);
      return numA - numB;
    });
    for (let i = 0;i < slideFiles.length; i++) {
      const slideFile = zip.file(slideFiles[i]);
      if (slideFile) {
        const slideXml = await slideFile.async("text");
        const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
        if (textMatches) {
          extractedText += `
<slide number="${i + 1}">`;
          const slideTexts = textMatches.map((match) => {
            const textMatch = match.match(/<a:t[^>]*>([^<]+)<\/a:t>/);
            return textMatch ? textMatch[1] : "";
          }).filter((t) => t.trim());
          if (slideTexts.length > 0) {
            extractedText += `
${slideTexts.join(`
`)}`;
          }
          extractedText += `
</slide>`;
        }
      }
    }
    const notesFiles = Object.keys(zip.files).filter((name) => name.match(/ppt\/notesSlides\/notesSlide\d+\.xml$/)).sort((a, b) => {
      const numA = parseInt(a.match(/notesSlide(\d+)\.xml$/)?.[1] || "0", 10);
      const numB = parseInt(b.match(/notesSlide(\d+)\.xml$/)?.[1] || "0", 10);
      return numA - numB;
    });
    if (notesFiles.length > 0) {
      extractedText += `
<notes>`;
      for (const noteFile of notesFiles) {
        const file = zip.file(noteFile);
        if (file) {
          const noteXml = await file.async("text");
          const textMatches = noteXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
          if (textMatches) {
            const noteTexts = textMatches.map((match) => {
              const textMatch = match.match(/<a:t[^>]*>([^<]+)<\/a:t>/);
              return textMatch ? textMatch[1] : "";
            }).filter((t) => t.trim());
            if (noteTexts.length > 0) {
              const slideNum = noteFile.match(/notesSlide(\d+)\.xml$/)?.[1];
              extractedText += `
[Slide ${slideNum} notes]: ${noteTexts.join(" ")}`;
            }
          }
        }
      }
      extractedText += `
</notes>`;
    }
    extractedText += `
</pptx>`;
    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`PPTX 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function processExcel(buffer, fileName) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let extractedText = `<excel filename="${escapeXml(fileName)}">`;
    for (const [index, sheetName] of workbook.SheetNames.entries()) {
      const worksheet = workbook.Sheets[sheetName];
      const csvText = XLSX.utils.sheet_to_csv(worksheet);
      extractedText += `
<sheet name="${escapeXml(sheetName)}" index="${index + 1}">
${csvText}
</sheet>`;
    }
    extractedText += `
</excel>`;
    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`Excel 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/office-to-pdf.ts
import { execSync } from "child_process";
var _libreOfficeAvailable = null;
var _npmPackageAvailable = null;
var _convertAsync = null;
function isLibreOfficeAvailable() {
  if (_libreOfficeAvailable !== null)
    return _libreOfficeAvailable;
  const commands = process.platform === "win32" ? ["soffice --version", "libreoffice --version"] : ["libreoffice --version"];
  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: "ignore", timeout: 5000 });
      _libreOfficeAvailable = true;
      return true;
    } catch {}
  }
  _libreOfficeAvailable = false;
  return false;
}
function isNpmPackageAvailable() {
  if (_npmPackageAvailable !== null)
    return _npmPackageAvailable;
  try {
    __require.resolve("libreoffice-convert");
    _npmPackageAvailable = true;
  } catch {
    _npmPackageAvailable = false;
  }
  return _npmPackageAvailable;
}
async function loadConvert() {
  if (_convertAsync)
    return _convertAsync;
  if (!isNpmPackageAvailable())
    return null;
  try {
    const { promisify } = await import("util");
    const libre = await import("libreoffice-convert");
    const mod = libre.default ?? libre;
    _convertAsync = promisify(mod.convert);
    return _convertAsync;
  } catch {
    _npmPackageAvailable = false;
    return null;
  }
}
function isConversionAvailable() {
  return isNpmPackageAvailable() && isLibreOfficeAvailable();
}
async function convertToPDF(buffer, _ext) {
  if (!isLibreOfficeAvailable())
    return null;
  const convert = await loadConvert();
  if (!convert)
    return null;
  try {
    return await convert(buffer, ".pdf", undefined);
  } catch {
    return null;
  }
}

// src/ocr-service.ts
var OCR_TEXT_MARKER_RE = /^\[\[IRIS_OCR_IMAGE_(\d+)\]\]\n/;
var OCR_PROMPT = "请详细描述图片内容，优先完整、准确地提取其中所有可见文字；若存在段落、表格、列表或表单，请尽量保持原有结构。若图片中没有文字，再简要描述主要视觉内容。";
var OCR_EMPTY_TEXT = "（OCR 未提取到可识别内容）";

class OCRService {
  router;
  modelName;
  constructor(router, config) {
    this.router = router;
    this.modelName = config?.model;
  }
  async extractText(mimeType, base64Data) {
    const request = {
      contents: [{
        role: "user",
        parts: [
          { text: OCR_PROMPT },
          { inlineData: { mimeType, data: base64Data } }
        ]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096
      }
    };
    const response = await this.router.chat(request, this.modelName);
    const parts = response?.content?.parts ?? [];
    const text = parts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("");
    return text.trim() || OCR_EMPTY_TEXT;
  }
}
function createOCRTextPart(index, text) {
  const normalized = text.trim() || OCR_EMPTY_TEXT;
  return {
    text: `[[IRIS_OCR_IMAGE_${index}]]
[图片${index}内容]
${normalized}`
  };
}
function isOCRTextValue(text) {
  return typeof text === "string" && OCR_TEXT_MARKER_RE.test(text);
}
function isOCRTextPart(part) {
  return typeof part?.text === "string" && isOCRTextValue(part.text);
}
function stripOCRTextMarker(text) {
  return text.replace(OCR_TEXT_MARKER_RE, "");
}

// src/index.ts
var logger = createPluginLogger("multimodal");
var DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
]);
function isDocumentMimeType(mime) {
  return DOCUMENT_MIME_TYPES.has(mime);
}
var EXTENSION_TO_MIME2 = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel"
};
async function extractDocumentFallback(doc, parts) {
  try {
    const result = await extractDocument(doc);
    if (result.success) {
      parts.push({ text: `[Document: ${doc.fileName}]
${result.text}` });
    } else {
      logger.warn(`文档提取失败 (${doc.fileName}): ${result.error}`);
      parts.push({ text: `[Document: ${doc.fileName}] 提取失败: ${result.error}` });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(`文档处理异常 (${doc.fileName}): ${detail}`);
    parts.push({ text: `[Document: ${doc.fileName}] 处理异常: ${detail}` });
  }
}
var DEFAULT_CONFIG_TEMPLATE = `# 多模态处理配置
#
# 本扩展为 Iris 提供图片缩放、OCR 文字提取、文档解析等多模态处理能力。
# 删除整个文件或注释掉所有字段即可使用默认设置。

# ── OCR 配置（可选） ──
#
# 当主模型不支持图片输入（supportsVision: false）时，
# 扩展会调用 vision 模型提取图片中的文字，再把提取结果作为文本注入上下文。
#
# 何时需要配置：
#   - 主模型是纯文本模型，但用户会上传图片
#   - 主模型本身支持图片输入时，通常不需要配置 OCR
#
# 注释掉 ocr 段落即可关闭 OCR 回退。
# 关闭后，不支持图片的模型会收到"无法查看图片内容"的占位提示。

# ocr:
#   model: gpt-4o-mini   # 推荐使用轻量 vision 模型，成本低、速度快
`;
var ocrService;
var cachedApi;
var src_default = definePlugin({
  name: "multimodal",
  version: "0.1.0",
  description: "多模态处理 — 图片缩放、OCR、文档提取、Office→PDF 转换",
  activate(ctx) {
    ctx.ensureConfigFile("multimodal.yaml", DEFAULT_CONFIG_TEMPLATE);
    const rawConfig = ctx.readConfigSection("multimodal");
    const ocrConfig = rawConfig?.ocr;
    ctx.addHook({
      name: "multimodal:process-media",
      priority: 100,
      async onProcessUserMedia(params) {
        const { text, images, documents, capabilities } = params;
        const parts = [];
        if (Array.isArray(images) && images.length > 0) {
          if (capabilities.supportsVision || !ocrService) {
            for (const image of images) {
              const resized = await resizeImage(image.mimeType, image.data);
              parts.push({ inlineData: { mimeType: resized.mimeType, data: resized.data } });
              if (capabilities.supportsVision) {
                const dimNote = formatDimensionNote(resized);
                if (dimNote)
                  parts.push({ text: dimNote });
              }
            }
          } else {
            const resizedImages = await Promise.all(images.map((img) => resizeImage(img.mimeType, img.data)));
            const ocrTexts = await Promise.all(resizedImages.map(async (resized, index) => {
              try {
                return await ocrService.extractText(resized.mimeType, resized.data);
              } catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`OCR 处理第 ${index + 1} 张图片失败: ${detail}`);
              }
            }));
            for (let i = 0;i < resizedImages.length; i++) {
              const resized = resizedImages[i];
              parts.push({ inlineData: { mimeType: resized.mimeType, data: resized.data } });
              parts.push(createOCRTextPart(i + 1, ocrTexts[i]));
            }
          }
        }
        if (Array.isArray(documents) && documents.length > 0) {
          for (const doc of documents) {
            let effectiveMime = doc.mimeType;
            const ext = doc.fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
            if (!isDocumentMimeType(effectiveMime) && ext in EXTENSION_TO_MIME2) {
              effectiveMime = EXTENSION_TO_MIME2[ext];
            }
            const isPdf = effectiveMime === "application/pdf";
            const isOffice = isDocumentMimeType(effectiveMime) && !isPdf;
            if (isPdf && capabilities.supportsNativePDF) {
              parts.push({ inlineData: { mimeType: "application/pdf", data: doc.data } });
              parts.push({ text: `[Document: ${doc.fileName}]` });
            } else if (isOffice && capabilities.supportsNativePDF) {
              const pdfBuffer = await convertToPDF(Buffer.from(doc.data, "base64"), ext);
              if (pdfBuffer) {
                parts.push({ inlineData: { mimeType: "application/pdf", data: pdfBuffer.toString("base64") } });
                parts.push({ text: `[Document: ${doc.fileName}]` });
              } else if (capabilities.supportsNativeOffice) {
                parts.push({ inlineData: { mimeType: effectiveMime, data: doc.data } });
                parts.push({ text: `[Document: ${doc.fileName}]` });
              } else {
                await extractDocumentFallback(doc, parts);
              }
            } else if (isOffice && capabilities.supportsNativeOffice) {
              parts.push({ inlineData: { mimeType: effectiveMime, data: doc.data } });
              parts.push({ text: `[Document: ${doc.fileName}]` });
            } else {
              await extractDocumentFallback(doc, parts);
            }
          }
        }
        if (text.trim().length > 0) {
          parts.push({ text });
        }
        if (parts.length === 0) {
          parts.push({ text: "" });
        }
        return { parts };
      },
      onBeforeLLMCall(params) {
        const { request } = params;
        if (!request.contents)
          return;
        const supportsVision = cachedApi?.supportsVision?.() ?? false;
        let changed = false;
        for (const msg of request.contents) {
          if (!Array.isArray(msg.parts))
            continue;
          const cleaned = [];
          for (const part of msg.parts) {
            if (isOCRTextPart(part)) {
              changed = true;
              if (!supportsVision && part.text) {
                cleaned.push({ ...part, text: stripOCRTextMarker(part.text) });
              }
              continue;
            }
            cleaned.push(part);
          }
          if (changed) {
            msg.parts = cleaned;
          }
        }
        return changed ? { request } : undefined;
      }
    });
    ctx.onReady((api) => {
      cachedApi = api;
      if (ocrConfig && ocrConfig.enabled !== false && api.router?.chat) {
        ocrService = new OCRService(api.router, {
          model: ocrConfig?.model
        });
        logger.info(`OCR 服务已启用${ocrConfig.model ? ` (model: ${ocrConfig.model})` : ""}`);
      }
      if (api.media === undefined) {
        api.media = {
          resizeImage,
          formatDimensionNote,
          extractDocument,
          isSupportedDocumentMime,
          convertToPDF,
          isConversionAvailable
        };
      }
      logger.info("多模态处理扩展已就绪");
    });
  }
});
export {
  src_default as default
};
