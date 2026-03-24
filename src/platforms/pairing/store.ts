/**
 * 对码系统状态持久化存储。
 *
 * 存储在 ~/.iris/credentials/ 下的 JSON 文件中。
 * 支持多 Agent 场景通过构造函数传入 dataDir。
 */

import * as fs from 'fs';
import * as path from 'path';
import { dataDir } from '../../paths';
import { createLogger } from '../../logger';
import { PendingPairing, AllowedUser, PairingAdmin } from './types';
import { generatePairingCode } from './code-gen';

const logger = createLogger('PairingStore');

/** 永不过期的时间戳（用于 bootstrap） */
const NEVER_EXPIRE = 253402272000000; // 9999-12-31

export class PairingStore {
  private credentialsDir: string;

  constructor(customDataDir?: string) {
    this.credentialsDir = path.join(customDataDir || dataDir, 'credentials');
    try {
      if (!fs.existsSync(this.credentialsDir)) {
        fs.mkdirSync(this.credentialsDir, { recursive: true });
      }
    } catch (e) {
      logger.error('Failed to create credentials directory:', e);
    }
  }

  private getPath(filename: string): string {
    return path.join(this.credentialsDir, filename);
  }

  private loadJSON<T>(filename: string, defaultValue: T): T {
    const filePath = this.getPath(filename);
    if (!fs.existsSync(filePath)) return defaultValue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) return defaultValue;
      return JSON.parse(content) as T;
    } catch (e) {
      logger.error(`Failed to load ${filename}:`, e);
      return defaultValue;
    }
  }

  private saveJSON<T>(filename: string, data: T): void {
    const filePath = this.getPath(filename);
    const tempPath = `${filePath}.tmp`;
    try {
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (e) {
      logger.error(`Failed to save ${filename}:`, e);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }
  }

  loadPending(): PendingPairing[] {
    return this.loadJSON<PendingPairing[]>('pairing-pending.json', []);
  }

  savePending(pending: PendingPairing[]): void {
    this.saveJSON('pairing-pending.json', pending);
  }

  loadAllowlist(): AllowedUser[] {
    return this.loadJSON<AllowedUser[]>('pairing-allowlist.json', []);
  }

  saveAllowlist(allowlist: AllowedUser[]): void {
    this.saveJSON('pairing-allowlist.json', allowlist);
  }

  loadAdmin(): PairingAdmin | null {
    return this.loadJSON<PairingAdmin | null>('pairing-admin.json', null);
  }

  saveAdmin(admin: PairingAdmin | null): void {
    this.saveJSON('pairing-admin.json', admin);
  }

  /** 是否需要首次对码（无管理员） */
  needsBootstrap(): boolean {
    return this.loadAdmin() === null;
  }

  /** 获取或创建启动对码 */
  getOrCreateBootstrapCode(): string {
    const pending = this.loadPending();
    const bootstrap = pending.find(p => p.platform === '*' && p.userId === '*');
    if (bootstrap) return bootstrap.code;

    const newCode = generatePairingCode();
    pending.push({
      code: newCode,
      platform: '*',
      userId: '*',
      createdAt: Date.now(),
      expiresAt: NEVER_EXPIRE,
    });
    this.savePending(pending);
    return newCode;
  }
}
