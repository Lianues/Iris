import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearProtectedSkillRootsForOwner,
  getProtectedSkillRoots,
  getSkillAccessPreflightRejection,
  setProtectedSkillRoots,
  setProtectedSkillRootsForOwner,
} from '../src/tools/internal/skill-access-guard';
import { sessionContext } from '../src/core/backend/session-context';
import { searchInFiles } from '../src/tools/internal/search_in_files';
import { listFiles } from '../src/tools/internal/list_files';
import { findFiles } from '../src/tools/internal/find_files';
import { writeFile } from '../src/tools/internal/write_file';
import { deleteFile } from '../src/tools/internal/delete_file';

describe('Skill access preflight guard', () => {
  afterEach(() => {
    setProtectedSkillRoots([]);
    clearProtectedSkillRootsForOwner('a');
    clearProtectedSkillRootsForOwner('b');
  });

  it('拒绝 skill:// URI 和 Skill 目录直接访问', () => {
    expect(getSkillAccessPreflightRejection('cat skill://demo/references/guide.md')).toContain('read_skill_resource');
    expect(getSkillAccessPreflightRejection('Get-Content .agents\\skills\\demo\\SKILL.md')).toContain('read_skill_resource');
    expect(getSkillAccessPreflightRejection('cat ~/.iris/skills/demo/SKILL.md')).toContain('read_skill_resource');
  });

  it('不误伤普通 skills 文件名', () => {
    expect(getSkillAccessPreflightRejection('cat docs/skills-overview.md')).toBeNull();
    expect(getSkillAccessPreflightRejection('cat resources/skills/tutorial.md')).toBeNull();
  });

  it('根据动态 protected roots 拦截自定义 dataDir 下的 Skill 目录', () => {
    const root = path.resolve('custom-data/skills/demo');
    setProtectedSkillRoots([root]);
    expect(getSkillAccessPreflightRejection(path.join(root, 'SKILL.md'))).toContain('read_skill_resource');
    expect(getSkillAccessPreflightRejection(`cat "${path.join(root, 'references', 'guide.md')}"`)).toContain('read_skill_resource');
    expect(getSkillAccessPreflightRejection(`cat "${root}-backup/guide.md"`)).toBeNull();
    expect(getSkillAccessPreflightRejection('cat docs/guide.md')).toBeNull();
  });

  it('支持多 owner roots 合并与单 owner 清理', () => {
    const rootA = path.resolve('custom-data-a/skills/demo');
    const rootB = path.resolve('custom-data-b/skills/demo');
    setProtectedSkillRootsForOwner('a', [rootA]);
    setProtectedSkillRootsForOwner('b', [rootB]);
    expect(getProtectedSkillRoots().length).toBeGreaterThanOrEqual(2);
    expect(getSkillAccessPreflightRejection(path.join(rootA, 'SKILL.md'))).toContain('read_skill_resource');
    expect(getSkillAccessPreflightRejection(path.join(rootB, 'SKILL.md'))).toContain('read_skill_resource');
    clearProtectedSkillRootsForOwner('a');
    expect(getSkillAccessPreflightRejection(path.join(rootA, 'SKILL.md'))).toBeNull();
    expect(getSkillAccessPreflightRejection(path.join(rootB, 'SKILL.md'))).toContain('read_skill_resource');
  });

  it('搜索/列目录/查找工具会跳过或拒绝 Skill 目录', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-skill-guard-'));
    try {
      const skillDir = path.join(tmpDir, '.agents', 'skills', 'demo');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'SECRET_SKILL_CONTENT');
      fs.writeFileSync(path.join(tmpDir, 'src', 'normal.txt'), 'SECRET_SKILL_CONTENT');
      setProtectedSkillRootsForOwner('test', [skillDir]);

      await sessionContext.run({ sessionId: 'skill-guard-search', cwd: tmpDir }, async () => {
        const searchResult = await searchInFiles.handler({ query: 'SECRET_SKILL_CONTENT' }) as any;
        expect(searchResult.results.map((item: any) => item.file)).toEqual(['src/normal.txt']);

        const listRoot = await listFiles.handler({ paths: ['.'], recursive: true }) as any;
        const listed = listRoot.results[0].entries.map((entry: any) => entry.name);
        expect(listed).toContain('src/');
        expect(listed.some((name: string) => name.includes('.agents/skills'))).toBe(false);

        const findResult = await findFiles.handler({ patterns: ['**/*'] }) as any;
        expect(findResult.results).toContain('src/normal.txt');
        expect(findResult.results.some((name: string) => name.includes('.agents/skills'))).toBe(false);

        await expect(listFiles.handler({ paths: ['.agents/skills'] })).resolves.toMatchObject({
          results: [expect.objectContaining({ success: false })],
        });
      });
    } finally {
      clearProtectedSkillRootsForOwner('test');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('编辑/删除工具拒绝 Skill 目录目标', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-skill-guard-'));
    try {
      const skillDir = path.join(tmpDir, '.agents', 'skills', 'demo');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'content');
      setProtectedSkillRootsForOwner('test', [skillDir]);

      await sessionContext.run({ sessionId: 'skill-guard-edit', cwd: tmpDir }, async () => {
        await expect(writeFile.handler({ path: '.agents/skills/demo/SKILL.md', content: 'new' })).rejects.toThrow(/Skill directories/);
        const deleteResult = await deleteFile.handler({ paths: ['.agents'] }) as any;
        expect(deleteResult.successCount).toBe(0);
        expect(deleteResult.results[0].error).toContain('Skill directories');
      });
    } finally {
      clearProtectedSkillRootsForOwner('test');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
