import * as fs from 'node:fs';
import * as path from 'node:path';
import { addDefaultParsers, clearEnvCache, type FiletypeParserOptions } from '@opentui/core';

const OPENTUI_RUNTIME_DIR_NAME = 'opentui';

const REQUIRED_ASSET_FILES = [
  'javascript/highlights.scm',
  'javascript/tree-sitter-javascript.wasm',
  'typescript/highlights.scm',
  'typescript/tree-sitter-typescript.wasm',
  'markdown/highlights.scm',
  'markdown/injections.scm',
  'markdown/tree-sitter-markdown.wasm',
  'markdown_inline/highlights.scm',
  'markdown_inline/tree-sitter-markdown_inline.wasm',
  'zig/highlights.scm',
  'zig/tree-sitter-zig.wasm',
];

let configured = false;
let warned = false;

interface BundledFiletypeParserOptions extends FiletypeParserOptions {
  aliases?: string[];
}

function warnRuntimeIssue(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[ConsolePlatform] ${message}`);
}

function resolveBundledRuntimeDir(isCompiledBinary: boolean): string | null {
  if (!isCompiledBinary) return null;

  try {
    const execDir = path.dirname(fs.realpathSync(process.execPath));
    const candidates = [
      path.join(execDir, OPENTUI_RUNTIME_DIR_NAME),
      path.join(path.resolve(execDir, '..'), OPENTUI_RUNTIME_DIR_NAME),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, 'parser.worker.js'))) {
        return candidate;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function hasBundledAssets(assetsRoot: string): boolean {
  return REQUIRED_ASSET_FILES.every((relativePath) => fs.existsSync(path.join(assetsRoot, relativePath)));
}

function createBundledParsers(assetsRoot: string): BundledFiletypeParserOptions[] {
  const asset = (...segments: string[]) => path.join(assetsRoot, ...segments);

  return [
    {
      filetype: 'javascript',
      aliases: ['javascriptreact'],
      queries: {
        highlights: [asset('javascript', 'highlights.scm')],
      },
      wasm: asset('javascript', 'tree-sitter-javascript.wasm'),
    },
    {
      filetype: 'typescript',
      aliases: ['typescriptreact'],
      queries: {
        highlights: [asset('typescript', 'highlights.scm')],
      },
      wasm: asset('typescript', 'tree-sitter-typescript.wasm'),
    },
    {
      filetype: 'markdown',
      queries: {
        highlights: [asset('markdown', 'highlights.scm')],
        injections: [asset('markdown', 'injections.scm')],
      },
      wasm: asset('markdown', 'tree-sitter-markdown.wasm'),
      injectionMapping: {
        nodeTypes: {
          inline: 'markdown_inline',
          pipe_table_cell: 'markdown_inline',
        },
        infoStringMap: {
          javascript: 'javascript',
          js: 'javascript',
          jsx: 'javascriptreact',
          javascriptreact: 'javascriptreact',
          typescript: 'typescript',
          ts: 'typescript',
          tsx: 'typescriptreact',
          typescriptreact: 'typescriptreact',
          markdown: 'markdown',
          md: 'markdown',
        },
      },
    },
    {
      filetype: 'markdown_inline',
      queries: {
        highlights: [asset('markdown_inline', 'highlights.scm')],
      },
      wasm: asset('markdown_inline', 'tree-sitter-markdown_inline.wasm'),
    },
    {
      filetype: 'zig',
      queries: {
        highlights: [asset('zig', 'highlights.scm')],
      },
      wasm: asset('zig', 'tree-sitter-zig.wasm'),
    },
  ];
}

export function configureBundledOpenTuiTreeSitter(isCompiledBinary: boolean): void {
  if (configured) return;

  const runtimeDir = resolveBundledRuntimeDir(isCompiledBinary);
  const workerPath = process.env.OTUI_TREE_SITTER_WORKER_PATH?.trim()
    || (runtimeDir ? path.join(runtimeDir, 'parser.worker.js') : '');

  if (!workerPath) {
    if (isCompiledBinary) {
      warnRuntimeIssue('未找到 OpenTUI tree-sitter worker，Markdown 标题和加粗高亮可能不可用。');
    }
    configured = true;
    return;
  }

  process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath;
  clearEnvCache();

  if (runtimeDir) {
    const assetsRoot = path.join(runtimeDir, 'assets');
    if (hasBundledAssets(assetsRoot)) {
      addDefaultParsers(createBundledParsers(assetsRoot));
    } else {
      warnRuntimeIssue('未找到完整的 OpenTUI tree-sitter 资源目录，Markdown 代码高亮可能不可用。');
    }
  }

  configured = true;
}
