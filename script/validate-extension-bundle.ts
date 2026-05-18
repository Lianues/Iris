#!/usr/bin/env bun

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  findDisallowedBareRuntimeImports,
  formatDisallowedBareRuntimeImports,
} from './extension-bundle-validation';

interface ParsedArgs {
  file?: string;
  extension?: string;
  allowedBarePackages: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { allowedBarePackages: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--file':
        args.file = argv[++i];
        break;
      case '--extension':
        args.extension = argv[++i];
        break;
      case '--allow':
        args.allowedBarePackages.push(argv[++i]);
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`用法: bun script/validate-extension-bundle.ts --file <dist/index.mjs> [--extension <name>] [--allow <pkg> ...]

校验 extension bundle 中是否仍残留非 external 的 bare ESM import。
Bun compiled binary 动态加载磁盘 extension 文件时不能可靠解析这类 bare specifier，
因此内嵌 extension 的第三方依赖应被 bundle，或显式列入 embedded.json external 并随目标平台安装。`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    printUsage();
    process.exit(1);
  }

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`bundle 文件不存在: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const violations = findDisallowedBareRuntimeImports(content, {
    allowedBarePackages: args.allowedBarePackages,
  });

  if (violations.length > 0) {
    const label = args.extension ? `extension "${args.extension}"` : path.relative(process.cwd(), filePath);
    throw new Error(
      `${label} bundle 中仍包含非 external bare ESM import: ${formatDisallowedBareRuntimeImports(violations)}。` +
      '请将这些依赖打包进 bundle，或通过 embedded.json external 声明并确保目标平台安装。',
    );
  }

  const label = args.extension ? `extension ${args.extension}` : path.relative(process.cwd(), filePath);
  console.log(`✓ ${label} bundle runtime imports validated`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
