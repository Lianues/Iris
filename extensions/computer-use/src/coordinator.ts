/**
 * 坐标反归一化
 *
 * Gemini Computer Use 模型输出 0-999 的归一化坐标。
 * 此模块将其转换为实际像素坐标，或反向转换。
 */

/** 将 0-999 归一化 X 坐标转换为实际像素 */
export function denormalizeX(x: number, screenWidth: number): number {
  return Math.round(x / 1000 * screenWidth);
}

/** 将 0-999 归一化 Y 坐标转换为实际像素 */
export function denormalizeY(y: number, screenHeight: number): number {
  return Math.round(y / 1000 * screenHeight);
}

/** 将实际像素 X 坐标转换为 0-999 归一化值 */
export function normalizeX(px: number, screenWidth: number): number {
  return Math.round(px / screenWidth * 1000);
}

/** 将实际像素 Y 坐标转换为 0-999 归一化值 */
export function normalizeY(px: number, screenHeight: number): number {
  return Math.round(px / screenHeight * 1000);
}
