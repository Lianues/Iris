import type { AllowedUser, PairingAdmin, PairingCheckResult, PairingConfig, PendingPairing } from './types.js';
import { generatePairingCode } from './code-gen.js';
import { PairingStore } from './store.js';

export class PairingGuard {
  constructor(
    private platform: string,
    private config: PairingConfig,
    private store: PairingStore,
  ) {}

  check(userId: string, messageText: string, userName?: string): PairingCheckResult {
    if (this.config.dmPolicy === 'open') {
      return { allowed: true };
    }

    const platformUserId = `${this.platform}:${userId}`;

    if (this.config.allowFrom && this.config.allowFrom.includes(platformUserId)) {
      return { allowed: true };
    }

    if (this.config.admin === platformUserId) {
      return { allowed: true };
    }

    const allowlist = this.store.loadAllowlist();
    if (allowlist.some((user) => user.platform === this.platform && user.userId === userId)) {
      return { allowed: true };
    }

    const admin = this.store.loadAdmin();
    if (admin && admin.platform === this.platform && admin.userId === userId) {
      return { allowed: true };
    }

    this.cleanExpiredPending();

    if (this.config.dmPolicy === 'allowlist') {
      return {
        allowed: false,
        reason: 'needs-pairing',
        replyText: '需要对码验证，请联系管理员。',
      };
    }

    const inputCode = messageText.trim().toUpperCase();
    const pending = this.store.loadPending();
    const matchIndex = pending.findIndex((item) => item.code.toUpperCase() === inputCode);

    if (matchIndex !== -1) {
      const matched = pending[matchIndex];

      if (matched.platform === '*' && matched.userId === '*') {
        const newAdmin: PairingAdmin = {
          platform: this.platform,
          userId,
          userName,
          setAt: Date.now(),
          source: 'first-pairing',
        };
        this.store.saveAdmin(newAdmin);
        this.addUserToAllowlist(userId, userName);
        pending.splice(matchIndex, 1);
        this.store.savePending(pending);

        return {
          allowed: false,
          reason: 'bootstrap-success',
          replyText: `对码成功！你已成为管理员 (ID: ${userId})。`,
        };
      }

      this.addUserToAllowlist(userId, userName);
      pending.splice(matchIndex, 1);
      this.store.savePending(pending);

      return {
        allowed: false,
        reason: 'pairing-success',
        replyText: '对码成功！你已获得使用权限。',
      };
    }

    return {
      allowed: false,
      reason: 'needs-pairing',
      replyText: '需要对码验证，请联系管理员获取对码。',
    };
  }

  isAdmin(userId: string): boolean {
    const platformUserId = `${this.platform}:${userId}`;
    if (this.config.admin === platformUserId) return true;
    const admin = this.store.loadAdmin();
    return !!(admin && admin.platform === this.platform && admin.userId === userId);
  }

  generateInviteCode(): string {
    const code = generatePairingCode();
    const pending = this.store.loadPending();

    const platformPending = pending.filter((item) => item.platform !== '*');
    if (platformPending.length >= 5) {
      const oldestIndex = pending.findIndex((item) => item.platform !== '*');
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

  removeUser(targetPlatform: string, targetUserId: string): boolean {
    let allowlist = this.store.loadAllowlist();
    const initialLength = allowlist.length;
    allowlist = allowlist.filter((user) => !(user.platform === targetPlatform && user.userId === targetUserId));
    if (allowlist.length !== initialLength) {
      this.store.saveAllowlist(allowlist);
      return true;
    }
    return false;
  }

  private addUserToAllowlist(userId: string, userName?: string): void {
    const allowlist = this.store.loadAllowlist();
    if (!allowlist.some((user) => user.platform === this.platform && user.userId === userId)) {
      allowlist.push({
        platform: this.platform,
        userId,
        userName,
        pairedAt: Date.now(),
      });
      this.store.saveAllowlist(allowlist);
    }
  }

  private cleanExpiredPending(): void {
    const pending = this.store.loadPending();
    const now = Date.now();
    const filtered = pending.filter((item) => item.expiresAt > now);
    if (filtered.length !== pending.length) {
      this.store.savePending(filtered);
    }
  }
}
