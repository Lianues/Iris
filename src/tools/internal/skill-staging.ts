import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SkillDefinition } from '../../config/types';
import { hashFileSync, resolveSkillResourceSync } from '../../config/skill-resource-manifest';

const MAX_STAGED_PACKAGE_BYTES = 50 * 1024 * 1024;

export interface StagedSkillPackage {
  dir: string;
  resolve(relativePath: string): string;
  cleanup(): void;
}

/** Stage a manifest-verified Skill package while preserving relative layout. */
export async function stageSkillPackage(skill: SkillDefinition): Promise<StagedSkillPackage> {
  if (!skill.canonicalBasePath) throw new Error('Skill does not have a canonical resource root.');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'iris-skill-package-'));
  let totalBytes = 0;

  try {
    for (const item of skill.resources ?? []) {
      if (item.truncatedReason) {
        throw new Error('Skill resource manifest is truncated; refusing to stage an incomplete package.');
      }
      if (!item.sha256) continue;
      totalBytes += item.size;
      if (totalBytes > MAX_STAGED_PACKAGE_BYTES) {
        throw new Error(`Skill resource package exceeds staging limit (${MAX_STAGED_PACKAGE_BYTES} bytes).`);
      }

      const resolved = resolveSkillResourceSync(skill.canonicalBasePath, item.relativePath);
      if (resolved.sha256 !== item.sha256) {
        throw new Error(`Skill resource changed after manifest creation: ${item.relativePath}. Refresh skills and ask for confirmation again.`);
      }

      const destination = path.join(dir, ...item.relativePath.split('/'));
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.copyFile(resolved.realPath, destination);
      if (hashFileSync(destination) !== item.sha256) {
        throw new Error(`Skill resource changed while staging: ${item.relativePath}.`);
      }
    }
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    dir,
    resolve(relativePath: string): string {
      return path.join(dir, ...relativePath.split('/'));
    },
    cleanup(): void {
      fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
