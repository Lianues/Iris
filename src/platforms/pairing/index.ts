/**
 * 对码系统模块入口。
 *
 * 统一导出该模块的公开 API。
 */

export { PairingGuard } from './guard';
export { PairingStore } from './store';
export { generatePairingCode } from './code-gen';
export type { PairingConfig, PairingCheckResult, PendingPairing, AllowedUser, PairingAdmin } from './types';
