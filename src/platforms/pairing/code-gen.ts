/**
 * 对码生成器。
 *
 * 生成 6 位大写字母 + 数字组成的对码，排除易混淆字符（0/O、1/I、L）。
 * 对码用于平台层用户身份验证，与 Backend 无关。
 */

// 排除 0, O, 1, I, L
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generatePairingCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}
