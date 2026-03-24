/**
 * 对码系统门禁逻辑。
 *
 * 核心类 PairingGuard，负责用户请求的权限检查。
 */

import { PairingConfig, PairingCheckResult, PendingPairing, AllowedUser, PairingAdmin } from './types';
import { PairingStore } from './store';
import { generatePairingCode } from './code-gen';

export class PairingGuard {
  constructor(
    private platform: string,
    private config: PairingConfig,
    private store: PairingStore
  ) {}

  /**
   * 检查用户消息是否有权进入 Backend。
   * @param userId 平台端的用户 ID
   * @param messageText 消息内容（用于匹配对码）
   * @param userName 可选的用户名
   */
  check(userId: string, messageText: string, userName?: string): PairingCheckResult {
    // 1. 如果 dmPolicy === 'open'，直接放行
    if (this.config.dmPolicy === 'open') {
      return { allowed: true };
    }

    const platformUserId = `${this.platform}:${userId}`;

    // 2. 检查用户是否在配置的 allowFrom 中
    if (this.config.allowFrom && this.config.allowFrom.includes(platformUserId)) {
      return { allowed: true };
    }

    // 3. 检查用户是否在配置中直接指定为 admin
    if (this.config.admin === platformUserId) {
      return { allowed: true };
    }

    // 4. 检查用户是否在 store 的白名单中
    const allowlist = this.store.loadAllowlist();
    if (allowlist.some(u => u.platform === this.platform && u.userId === userId)) {
      return { allowed: true };
    }

    // 5. 检查是否为当前管理员
    const admin = this.store.loadAdmin();
    if (admin && admin.platform === this.platform && admin.userId === userId) {
      return { allowed: true };
    }

    // 每次 check 调用时清理过期的 pending 对码
    this.cleanExpiredPending();

    // 6. 如果 dmPolicy === 'allowlist'，不在名单就拒绝
    if (this.config.dmPolicy === 'allowlist') {
      return {
        allowed: false,
        reason: 'needs-pairing',
        replyText: '需要对码验证，请联系管理员。',
      };
    }

    // 7. 如果 dmPolicy === 'pairing'：
    const inputCode = messageText.trim().toUpperCase();
    const pending = this.store.loadPending();
    const matchIndex = pending.findIndex(p => p.code.toUpperCase() === inputCode);

    if (matchIndex !== -1) {
      const p = pending[matchIndex];

      // 匹配到 bootstrap 对码（platform='*'）
      if (p.platform === '*' && p.userId === '*') {
        // 设为管理员
        const newAdmin: PairingAdmin = {
          platform: this.platform,
          userId,
          userName,
          setAt: Date.now(),
          source: 'first-pairing',
        };
        this.store.saveAdmin(newAdmin);
        // 加白名单
        this.addUserToAllowlist(userId, userName);
        // 移除该 bootstrap 对码
        pending.splice(matchIndex, 1);
        this.store.savePending(pending);

        return {
          allowed: false,
          reason: 'bootstrap-success',
          replyText: `对码成功！你已成为管理员 (ID: ${userId})。`,
        };
      }

      // 匹配到普通邀请对码
      this.addUserToAllowlist(userId, userName);
      // 移除对码（一次性）
      pending.splice(matchIndex, 1);
      this.store.savePending(pending);

      return {
        allowed: false,
        reason: 'pairing-success',
        replyText: '对码成功！你已获得使用权限。',
      };
    }

    // 都不匹配
    return {
      allowed: false,
      reason: 'needs-pairing',
      replyText: '需要对码验证，请联系管理员获取对码。',
    };
  }

  /** 检查用户是否为管理员 */
  isAdmin(userId: string): boolean {
    const platformUserId = `${this.platform}:${userId}`;
    if (this.config.admin === platformUserId) return true;
    const admin = this.store.loadAdmin();
    return !!(admin && admin.platform === this.platform && admin.userId === userId);
  }

  /** 生成邀请对码（1 小时过期） */
  generateInviteCode(): string {
    const code = generatePairingCode();
    const pending = this.store.loadPending();

    // 每个平台最多 5 个 pending
    const platformPending = pending.filter(p => p.platform !== '*');
    if (platformPending.length >= 5) {
      const oldestIndex = pending.findIndex(p => p.platform !== '*');
      if (oldestIndex !== -1) pending.splice(oldestIndex, 1);
    }

    pending.push({
      code,
      platform: this.platform,
      userId: '',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    });
    this.store.savePending(pending);
    return code;
  }

  listPending(): PendingPairing[] {
    return this.store.loadPending();
  }

  listUsers(): AllowedUser[] {
    return this.store.loadAllowlist();
  }

  /** 让渡管理员身份 */
  transferAdmin(targetPlatform: string, targetUserId: string): boolean {
    const newAdmin: PairingAdmin = {
      platform: targetPlatform,
      userId: targetUserId,
      setAt: Date.now(),
      source: 'transfer',
    };
    this.store.saveAdmin(newAdmin);
    return true;
  }

  /** 移除用户白名单 */
  removeUser(targetPlatform: string, targetUserId: string): boolean {
    let allowlist = this.store.loadAllowlist();
    const initialLen = allowlist.length;
    allowlist = allowlist.filter(u => !(u.platform === targetPlatform && u.userId === targetUserId));
    if (allowlist.length !== initialLen) {
      this.store.saveAllowlist(allowlist);
      return true;
    }
    return false;
  }

  private addUserToAllowlist(userId: string, userName?: string) {
    const allowlist = this.store.loadAllowlist();
    if (!allowlist.some(u => u.platform === this.platform && u.userId === userId)) {
      allowlist.push({
        platform: this.platform,
        userId,
        userName,
        pairedAt: Date.now(),
      });
      this.store.saveAllowlist(allowlist);
    }
  }

  private cleanExpiredPending() {
    const pending = this.store.loadPending();
    const now = Date.now();
    const filtered = pending.filter(p => p.expiresAt > now);
    if (filtered.length !== pending.length) {
      this.store.savePending(filtered);
    }
  }
}
