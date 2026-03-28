import fs from 'node:fs';
import path from 'node:path';
import { createExtensionLogger } from '../logger.js';
import { resolveDefaultDataDir } from '../runtime-paths.js';
import { generatePairingCode } from './code-gen.js';
import type { AllowedUser, PairingAdmin, PendingPairing } from './types.js';

const logger = createExtensionLogger('ExtensionSDK', 'PairingStore');
const NEVER_EXPIRE = 253402272000000;

export class PairingStore {
  private credentialsDir: string;

  constructor(customDataDir?: string) {
    this.credentialsDir = path.join(resolveDefaultDataDir(customDataDir), 'credentials');
    try {
      if (!fs.existsSync(this.credentialsDir)) {
        fs.mkdirSync(this.credentialsDir, { recursive: true });
      }
    } catch (error) {
      logger.error('Failed to create credentials directory:', error);
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
    } catch (error) {
      logger.error(`Failed to load ${filename}:`, error);
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
    } catch (error) {
      logger.error(`Failed to save ${filename}:`, error);
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
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

  needsBootstrap(): boolean {
    return this.loadAdmin() === null;
  }

  getOrCreateBootstrapCode(): string {
    const pending = this.loadPending();
    const bootstrap = pending.find((item) => item.platform === '*' && item.userId === '*');
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
