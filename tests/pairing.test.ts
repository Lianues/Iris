/**
 * 对码系统单元测试。
 *
 * 测试对码生成器、存储和门禁逻辑。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generatePairingCode } from '../src/platforms/pairing/code-gen';
import { PairingStore } from '../src/platforms/pairing/store';
import { PairingGuard } from '../src/platforms/pairing/guard';
import { PairingConfig } from '../src/platforms/pairing/types';

describe('Pairing System', () => {
  let testDataDir: string;

  beforeEach(() => {
    testDataDir = path.join(os.tmpdir(), `iris-test-${Date.now()}`);
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('generatePairingCode', () => {
    it('should generate a 6-character code', () => {
      const code = generatePairingCode();
      expect(code).toHaveLength(6);
    });

    it('should not contain confusing characters', () => {
      const confusing = ['0', 'O', '1', 'I', 'L'];
      for (let i = 0; i < 100; i++) {
        const code = generatePairingCode();
        for (const char of confusing) {
          expect(code).not.toContain(char);
        }
      }
    });
  });

  describe('PairingStore', () => {
    it('should initialize and create credentials directory', () => {
      const store = new PairingStore(testDataDir);
      expect(fs.existsSync(path.join(testDataDir, 'credentials'))).toBe(true);
    });

    it('should load and save pending pairings', () => {
      const store = new PairingStore(testDataDir);
      const pending = [{
        code: 'TEST12',
        platform: 'test',
        userId: 'user1',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      }];
      store.savePending(pending);
      const loaded = store.loadPending();
      expect(loaded).toEqual(pending);
    });

    it('should load and save admin', () => {
      const store = new PairingStore(testDataDir);
      const admin = {
        platform: 'test',
        userId: 'admin1',
        setAt: Date.now(),
        source: 'first-pairing' as const,
      };
      store.saveAdmin(admin);
      const loaded = store.loadAdmin();
      expect(loaded).toEqual(admin);
    });

    it('should generate bootstrap code when needed', () => {
      const store = new PairingStore(testDataDir);
      expect(store.needsBootstrap()).toBe(true);
      const code = store.getOrCreateBootstrapCode();
      expect(code).toHaveLength(6);
      expect(store.loadPending()).toHaveLength(1);
      expect(store.loadPending()[0].platform).toBe('*');
    });
  });

  describe('PairingGuard', () => {
    let store: PairingStore;
    const defaultConfig: PairingConfig = {
      dmPolicy: 'pairing',
    };

    beforeEach(() => {
      store = new PairingStore(testDataDir);
    });

    it('should allow everyone if dmPolicy is open', () => {
      const guard = new PairingGuard('test', { dmPolicy: 'open' }, store);
      const result = guard.check('user1', 'Hello');
      expect(result.allowed).toBe(true);
    });

    it('should block un-paired user if dmPolicy is pairing', () => {
      const guard = new PairingGuard('test', { dmPolicy: 'pairing' }, store);
      const result = guard.check('user1', 'Hello');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('needs-pairing');
    });

    it('should allow paired user from allowlist', () => {
      store.saveAllowlist([{
        platform: 'test',
        userId: 'user1',
        pairedAt: Date.now(),
      }]);
      const guard = new PairingGuard('test', { dmPolicy: 'pairing' }, store);
      const result = guard.check('user1', 'Hello');
      expect(result.allowed).toBe(true);
    });

    it('should handle bootstrap pairing', () => {
      const guard = new PairingGuard('test', { dmPolicy: 'pairing' }, store);
      const code = store.getOrCreateBootstrapCode();
      
      const result = guard.check('user1', code, 'User One');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('bootstrap-success');
      expect(guard.isAdmin('user1')).toBe(true);
      
      // Subsequent messages should be allowed
      const result2 = guard.check('user1', 'Normal message');
      expect(result2.allowed).toBe(true);
    });

    it('should handle invite pairing', () => {
      const guard = new PairingGuard('test', { dmPolicy: 'pairing' }, store);
      // Make user1 an admin first
      store.saveAdmin({
          platform: 'test',
          userId: 'admin1',
          setAt: Date.now(),
          source: 'config',
      });

      const inviteCode = guard.generateInviteCode();
      const result = guard.check('user2', inviteCode, 'User Two');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('pairing-success');
      
      const result2 = guard.check('user2', 'Hello');
      expect(result2.allowed).toBe(true);
    });

    it('should block user not in allowFrom if policy is allowlist', () => {
        const guard = new PairingGuard('test', { dmPolicy: 'allowlist', allowFrom: ['test:user1'] }, store);
        expect(guard.check('user1', 'Hi').allowed).toBe(true);
        expect(guard.check('user2', 'Hi').allowed).toBe(false);
    });

    it('should respect expired codes', async () => {
        const guard = new PairingGuard('test', { dmPolicy: 'pairing' }, store);
        const code = guard.generateInviteCode();
        
        // Mock expiration
        const pending = store.loadPending();
        pending[0].expiresAt = Date.now() - 1000;
        store.savePending(pending);
        
        const result = guard.check('user2', code);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('needs-pairing');
    });
  });
});
