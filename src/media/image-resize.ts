/**
 * 图片缩放模块
 *
 * 使用 sharp 进行图片处理。
 * 自动将图片缩放到 API 限制以内（尺寸 + 文件大小）。
 *
 * sharp 采用延迟加载，不支持的平台（如 Termux/Android）在不使用图片功能时不会崩溃。
 */

export interface ImageResizeOptions {
  maxWidth?: number;    // Default: 2000
  maxHeight?: number;   // Default: 2000
  maxBytes?: number;    // Default: 4.5MB (below Anthropic's 5MB limit)
  jpegQuality?: number; // Default: 80
}

export interface ResizedImage {
  data: string;   // base64
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
}

// 4.5MB - provides headroom below Anthropic's 5MB limit
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: DEFAULT_MAX_BYTES,
  jpegQuality: 80,
};

/** 延迟加载 sharp，避免在不支持的平台上启动即崩溃 */
let _sharp: typeof import('sharp') | null = null;

async function getSharp() {
  if (!_sharp) {
    const mod = await import('sharp');
    _sharp = (mod.default ?? mod) as typeof import('sharp');
  }
  return _sharp;
}

/**
 * Resize an image to fit within the specified max dimensions and file size.
 * Returns the original image if it already fits within the limits.
 *
 * Uses sharp for image processing.
 *
 * Strategy for staying under maxBytes:
 * 1. First resize to maxWidth/maxHeight
 * 2. Try both PNG and JPEG formats, pick the smaller one
 * 3. If still too large, try JPEG with decreasing quality
 * 4. If still too large, progressively reduce dimensions
 */
export async function resizeImage(
  mimeType: string,
  base64Data: string,
  options?: ImageResizeOptions,
): Promise<ResizedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const inputBuffer = Buffer.from(base64Data, 'base64');

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
        wasResized: false,
      };
    }

    // Check if already within all limits (dimensions AND size)
    if (
      originalWidth <= opts.maxWidth &&
      originalHeight <= opts.maxHeight &&
      inputBuffer.length <= opts.maxBytes
    ) {
      return {
        data: base64Data,
        mimeType,
        originalWidth,
        originalHeight,
        width: originalWidth,
        height: originalHeight,
        wasResized: false,
      };
    }

    // Calculate initial dimensions respecting max limits
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;

    if (targetWidth > opts.maxWidth) {
      targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
      targetWidth = opts.maxWidth;
    }
    if (targetHeight > opts.maxHeight) {
      targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
      targetHeight = opts.maxHeight;
    }

    // Helper to resize and encode in both formats, returning the smaller one
    async function tryBothFormats(
      width: number,
      height: number,
      jpegQuality: number,
    ): Promise<{ buffer: Buffer; mimeType: string; actualWidth: number; actualHeight: number }> {
      const resized = sharp(inputBuffer).resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });

      const [pngResult, jpegResult] = await Promise.all([
        resized.clone().png().toBuffer({ resolveWithObject: true }),
        resized.clone().jpeg({ quality: jpegQuality }).toBuffer({ resolveWithObject: true }),
      ]);

      const picked = pngResult.data.length <= jpegResult.data.length
        ? { buffer: pngResult.data, mimeType: 'image/png', actualWidth: pngResult.info.width, actualHeight: pngResult.info.height }
        : { buffer: jpegResult.data, mimeType: 'image/jpeg', actualWidth: jpegResult.info.width, actualHeight: jpegResult.info.height };

      return picked;
    }

    // Try to produce an image under maxBytes
    const qualitySteps = [85, 70, 55, 40];
    const scaleSteps = [1.0, 0.75, 0.5, 0.35, 0.25];

    let best: { buffer: Buffer; mimeType: string; actualWidth: number; actualHeight: number };

    // First attempt: resize to target dimensions, try both formats
    best = await tryBothFormats(targetWidth, targetHeight, opts.jpegQuality);

    if (best.buffer.length <= opts.maxBytes) {
      return {
        data: best.buffer.toString('base64'),
        mimeType: best.mimeType,
        originalWidth,
        originalHeight,
        width: best.actualWidth,
        height: best.actualHeight,
        wasResized: true,
      };
    }

    // Still too large - try JPEG with decreasing quality
    for (const quality of qualitySteps) {
      best = await tryBothFormats(targetWidth, targetHeight, quality);

      if (best.buffer.length <= opts.maxBytes) {
        return {
          data: best.buffer.toString('base64'),
          mimeType: best.mimeType,
          originalWidth,
          originalHeight,
          width: best.actualWidth,
          height: best.actualHeight,
          wasResized: true,
        };
      }
    }

    // Still too large - reduce dimensions progressively
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
            data: best.buffer.toString('base64'),
            mimeType: best.mimeType,
            originalWidth,
            originalHeight,
            width: best.actualWidth,
            height: best.actualHeight,
            wasResized: true,
          };
        }
      }
    }

    // Last resort: return smallest version we produced
    return {
      data: best.buffer.toString('base64'),
      mimeType: best.mimeType,
      originalWidth,
      originalHeight,
      width: best.actualWidth,
      height: best.actualHeight,
      wasResized: true,
    };
  } catch {
    // Failed to process image (or sharp unavailable) - return original
    return {
      data: base64Data,
      mimeType,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
      wasResized: false,
    };
  }
}

/**
 * Format a dimension note for resized images.
 * This helps the model understand the coordinate mapping.
 */
export function formatDimensionNote(result: ResizedImage): string | undefined {
  if (!result.wasResized) {
    return undefined;
  }

  const scale = result.originalWidth / result.width;
  return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
