import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolDefinition, FunctionDeclaration } from '../../types';
import type { SkillDefinition } from '../../config/types';
import { hashFileSync, normalizeSkillRelativePath, resolveSkillResourceSync } from '../../config/skill-resource-manifest';
import { resolveProjectPath } from '../utils';
import { killProcessTree } from './process-tree';

const DEFAULT_SKILL_SCRIPT_TIMEOUT_MS = 60_000;
const MAX_SKILL_SCRIPT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 20_000;

export interface ExecuteSkillScriptDeps {
  getBackend: () => {
    getSkillByName(name: string): SkillDefinition | undefined;
  };
}

interface ExecuteSkillScriptArgs {
  name: string;
  relativePath: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
}

function buildDeclaration(): FunctionDeclaration {
  return {
    name: 'execute_skill_script',
    description:
      'Execute an allowlisted script bundled with a Skill using structured arguments.\n\n' +
      'Use this instead of shell/bash when a Skill instructs you to run a script from its scripts/ directory. ' +
      'The tool validates the manifest entry, verifies sha256, stages the script to a temporary directory, and executes via argv rather than shell string concatenation.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name from read_skill.' },
        relativePath: { type: 'string', description: 'Script manifest relativePath, e.g. scripts/check.js.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the script as argv strings.' },
        cwd: { type: 'string', description: 'Optional project-relative working directory. Defaults to project root.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Defaults to 60000 and is capped at 300000.' },
      },
      required: ['name', 'relativePath'],
    },
  };
}

function normalizeTimeout(timeout?: number): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) return DEFAULT_SKILL_SCRIPT_TIMEOUT_MS;
  return Math.min(Math.floor(timeout), MAX_SKILL_SCRIPT_TIMEOUT_MS);
}

function resolveWorkspaceCwd(cwd?: string): { ok: true; cwd: string } | { ok: false; error: string } {
  if (!cwd || cwd.trim() === '.') return { ok: true, cwd: resolveProjectPath('.') };
  const trimmed = cwd.trim();
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('\\\\')) {
    return { ok: false, error: 'cwd must be project-relative.' };
  }
  try {
    return { ok: true, cwd: resolveProjectPath(trimmed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function getExtension(relativePath: string): string {
  return path.posix.extname(relativePath).toLowerCase();
}

function resolveRunner(stagedPath: string, relativePath: string): { command: string; args: string[] } | { error: string } {
  const ext = getExtension(relativePath);
  const isWin = process.platform === 'win32';
  if (ext === '.py') return { command: isWin ? 'python' : 'python3', args: [stagedPath] };
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return { command: 'node', args: [stagedPath] };
  if (ext === '.ps1') return { command: isWin ? 'powershell.exe' : 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stagedPath] };
  if (ext === '.sh' || ext === '.bash' || ext === '.zsh') {
    if (isWin) return { command: 'bash.exe', args: [stagedPath] };
    if (ext === '.zsh') return { command: 'zsh', args: [stagedPath] };
    if (ext === '.bash') return { command: 'bash', args: [stagedPath] };
    return { command: 'sh', args: [stagedPath] };
  }
  if (ext === '.cmd' || ext === '.bat') return { error: 'Windows batch scripts are not supported by execute_skill_script.' };
  return { error: `Unsupported Skill script extension: ${ext || '(none)'}` };
}

async function stageScript(sourcePath: string, relativePath: string, expectedSha256: string): Promise<{ dir: string; file: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'iris-skill-script-'));
  const stagedName = `script${path.extname(relativePath) || '.txt'}`;
  const file = path.join(dir, stagedName);
  await fs.promises.copyFile(sourcePath, file);
  const stagedHash = hashFileSync(file);
  if (stagedHash !== expectedSha256) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error('Skill script changed before staging. Refresh skills and ask for confirmation again.');
  }
  if (process.platform !== 'win32') {
    await fs.promises.chmod(file, 0o500);
  }
  return { dir, file };
}

function cleanupStaging(dir: string): void {
  fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

function redactStagingPaths(output: string, stagedDir: string, stagedFile: string): string {
  return output.split(stagedFile).join('[skill-script]').split(stagedDir).join('[skill-staging]');
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(-MAX_OUTPUT_CHARS)}\n... (output truncated to last ${MAX_OUTPUT_CHARS} chars)`;
}

function normalizeArgs(args: ExecuteSkillScriptArgs): string[] {
  return Array.isArray(args.args) ? args.args.map(String) : [];
}

export function createExecuteSkillScriptTool(deps: ExecuteSkillScriptDeps): ToolDefinition {
  return {
    declaration: buildDeclaration(),
    handler: async (rawArgs, context) => {
      const args = rawArgs as unknown as ExecuteSkillScriptArgs;
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      const relativePathInput = typeof args.relativePath === 'string' ? args.relativePath.trim() : '';
      if (!name || !relativePathInput) {
        return { success: false, error: `Missing required parameter: ${!name ? 'name' : 'relativePath'}` };
      }

      const skill = deps.getBackend().getSkillByName(name);
      if (!skill) return { success: false, error: `Skill not found: ${name}` };
      if (skill.disableModelInvocation) {
        return { success: false, error: `Skill "${skill.name}" is not available for model invocation.` };
      }
      if (!skill.canonicalBasePath) return { success: false, error: `Skill "${name}" does not have a filesystem resource root.` };

      let relativePath: string;
      try {
        relativePath = normalizeSkillRelativePath(relativePathInput);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }

      const item = (skill.resources || []).find(resource => resource.relativePath === relativePath);
      if (!item) return { success: false, error: `Skill script is not in the manifest: ${relativePathInput}` };
      if (!(item.kind === 'script' && item.maybeExecutable)) {
        return { success: false, error: `Skill resource is not an executable script: ${relativePathInput}` };
      }

      let resolved;
      try {
        resolved = resolveSkillResourceSync(skill.canonicalBasePath, item.relativePath);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (resolved.sha256 !== item.sha256) {
        return { success: false, error: `Skill script changed after manifest creation: ${item.relativePath}. Refresh skills and ask for confirmation again.` };
      }

      const cwdResolution = resolveWorkspaceCwd(args.cwd);
      if (!cwdResolution.ok) return { success: false, error: cwdResolution.error };

      let staged: { dir: string; file: string };
      try {
        staged = await stageScript(resolved.realPath, item.relativePath, item.sha256);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }

      const runner = resolveRunner(staged.file, item.relativePath);
      if ('error' in runner) {
        cleanupStaging(staged.dir);
        return { success: false, error: runner.error };
      }

      const scriptArgs = normalizeArgs(args);
      const finalArgs = [...runner.args, ...scriptArgs];
      const timeout = normalizeTimeout(args.timeout);

      if (!context?.requestApproval) {
        cleanupStaging(staged.dir);
        return {
          success: false,
          error: 'execute_skill_script requires explicit interactive user confirmation and cannot run in this context.',
        };
      }
      const approved = await context.requestApproval();
      if (!approved || context.signal?.aborted) {
        cleanupStaging(staged.dir);
        return {
          success: false,
          error: context.signal?.aborted ? 'Skill script execution was aborted before confirmation completed.' : 'User rejected Skill script execution.',
        };
      }

      return await new Promise<Record<string, unknown>>((resolve) => {
        const output: string[] = [];
        let killed = false;
        let settled = false;
        const proc = cp.spawn(runner.command, finalArgs, {
          cwd: cwdResolution.cwd,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          env: { ...process.env, IRIS_SKILL_NAME: skill.name, IRIS_SKILL_URI: item.skillUri },
        });

        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        let cancelForceKill: (() => void) | undefined;
        let onAbort: () => void = () => undefined;

        const finish = (result: Record<string, unknown>) => {
          if (settled) return;
          settled = true;
          if (timeoutTimer) clearTimeout(timeoutTimer);
          cancelForceKill?.();
          context?.signal?.removeEventListener('abort', onAbort);
          cleanupStaging(staged.dir);
          resolve(result);
        };

        const requestTermination = () => {
          if (killed) return;
          killed = true;
          cancelForceKill = killProcessTree(proc.pid, { forceAfterMs: 2_000 });
        };

        timeoutTimer = setTimeout(requestTermination, timeout);
        timeoutTimer.unref?.();

        onAbort = requestTermination;
        if (context?.signal) {
          if (context.signal.aborted) onAbort();
          else context.signal.addEventListener('abort', onAbort, { once: true });
        }

        proc.stdout?.on('data', chunk => output.push(String(chunk)));
        proc.stderr?.on('data', chunk => output.push(String(chunk)));
        proc.on('error', error => {
          finish({ success: false, error: error.message });
        });
        proc.on('close', code => {
          const joined = redactStagingPaths(output.join(''), staged.dir, staged.file);
          const success = code === 0 && !killed;
          finish({
            success,
            schemaVersion: 1,
            skillName: skill.name,
            skillUri: item.skillUri,
            relativePath: item.relativePath,
            runner: runner.command,
            args: scriptArgs,
            exitCode: code,
            killed,
            output: truncateOutput(joined),
            ...(success ? {} : { error: killed ? `Skill script timed out after ${timeout}ms.` : `Skill script exited with code ${code}.` }),
          });
        });
      });
    },
    approvalMode: 'handler',
    parallel: false,
  };
}
