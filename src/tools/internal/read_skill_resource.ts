import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { ToolDefinition, FunctionDeclaration } from '../../types';
import type { SkillDefinition } from '../../config/types';
import { normalizeSkillRelativePath, resolveSkillResourceSync } from '../../config/skill-resource-manifest';

const MAX_RESOURCE_TEXT_CHARS = 300_000;

export interface ReadSkillResourceDeps {
  getBackend: () => {
    getSkillByName(name: string): SkillDefinition | undefined;
  };
}

function buildDeclaration(): FunctionDeclaration {
  return {
    name: 'read_skill_resource',
    description:
      'Read one text resource bundled with an activated Skill by skill name and manifest relativePath.\n\n' +
      'Use this only after read_skill returns a resources manifest. The relativePath must exactly match a manifest entry with textReadable=true. ' +
      'This tool rejects absolute paths, URI paths, and ../ traversal. Binary assets are not read into context.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name from read_skill.',
        },
        relativePath: {
          type: 'string',
          description: 'Manifest relativePath to read, e.g. references/guide.md.',
        },
      },
      required: ['name', 'relativePath'],
    },
  };
}

export function createReadSkillResourceTool(deps: ReadSkillResourceDeps): ToolDefinition {
  return {
    declaration: buildDeclaration(),
    handler: async (args) => {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      const relativePathInput = typeof args.relativePath === 'string' ? args.relativePath.trim() : '';
      if (!name || !relativePathInput) {
        return { success: false, error: `Missing required parameter: ${!name ? 'name' : 'relativePath'}` };
      }

      const skill = deps.getBackend().getSkillByName(name);
      if (!skill) {
        return { success: false, error: `Skill not found: ${name}` };
      }
      if (skill.disableModelInvocation) {
        return { success: false, error: `Skill "${skill.name}" is not available for model invocation.` };
      }
      if (!skill.canonicalBasePath) {
        return { success: false, error: `Skill "${name}" does not have a filesystem resource root.` };
      }

      let relativePath: string;
      try {
        relativePath = normalizeSkillRelativePath(relativePathInput);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }

      const item = (skill.resources || []).find(resource => resource.relativePath === relativePath);
      if (!item) {
        return { success: false, error: `Skill resource is not in the manifest: ${relativePathInput}` };
      }
      if (!item.textReadable) {
        return { success: false, error: `Skill resource is not text-readable: ${relativePathInput}` };
      }

      let resolved;
      try {
        resolved = resolveSkillResourceSync(skill.canonicalBasePath, item.relativePath);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (resolved.sha256 !== item.sha256) {
        return { success: false, error: `Skill resource changed after manifest creation: ${item.relativePath}. Refresh skills and try again.` };
      }

      const buffer = fs.readFileSync(resolved.realPath);
      const contentSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      if (contentSha256 !== item.sha256) {
        return { success: false, error: 'Skill resource changed before read.' };
      }
      const content = buffer.toString('utf-8');
      const truncated = content.length > MAX_RESOURCE_TEXT_CHARS;
      return {
        success: true,
        schemaVersion: 1,
        skillName: skill.name,
        skillUri: item.skillUri,
        relativePath: item.relativePath,
        sha256: contentSha256,
        content: truncated ? content.slice(0, MAX_RESOURCE_TEXT_CHARS) : content,
        truncated,
      };
    },
    parallel: false,
  };
}
