/**
 * 对码系统类型定义。
 *
 * 对码系统是纯平台层的访问控制机制，与 Backend 完全无关。
 * 未通过对码的用户消息不会进入 backend.chat()。
 */

/** 对码策略配置 */
export interface PairingConfig {
  /** DM 策略：pairing = 需要对码（默认）| allowlist = 仅白名单 | open = 任何人 */
  dmPolicy: 'pairing' | 'allowlist' | 'open';
  /** 管理员 ID，格式 <platform>:<userId>（可选，直接指定则跳过首次对码） */
  admin?: string;
  /** 预设白名单，格式 <platform>:<userId>（可选） */
  allowFrom?: string[];
}

/** 待审批对码请求 */
export interface PendingPairing {
  code: string;
  platform: string;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

/** 已放行用户 */
export interface AllowedUser {
  platform: string;
  userId: string;
  userName?: string;
  pairedAt: number;
}

/** 管理员信息 */
export interface PairingAdmin {
  platform: string;
  userId: string;
  userName?: string;
  setAt: number;
  source: 'first-pairing' | 'config' | 'transfer';
}

/** PairingGuard.check() 的返回结果 */
export interface PairingCheckResult {
  /** 是否放行该消息进入 Backend */
  allowed: boolean;
  /**
   * allowed=false 时的具体原因：
   *   - needs-pairing: 用户未对码，需要联系管理员
   *   - bootstrap-success: 首次启动对码成功，该用户已成为管理员
   *   - pairing-success: 普通对码成功
   */
  reason?: 'needs-pairing' | 'bootstrap-success' | 'pairing-success';
  /** 需要回复给用户的文本（allowed=false 或对码成功时） */
  replyText?: string;
}
