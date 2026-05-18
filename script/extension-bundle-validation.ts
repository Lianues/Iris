import { builtinModules } from 'node:module';

export interface BundleRuntimeImportViolation {
  specifier: string;
  packageName: string;
}

export interface FindDisallowedBareRuntimeImportsOptions {
  allowedBarePackages?: string[];
}

const builtinModuleSet = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((name) => name.replace(/^node:/, '')),
]);

/**
 * 提取会由运行时 resolver 处理的 E import specifier。
 *
 * 这里有意只覆盖静态 import/export 和字面量 dynamic import()：
 * - 它们是 Bun compiled binary 动态加载 extension 时最容易泄漏的 bare specifier。
 * - 不扫描普通字符串或 require("...")，避免误报上游库代码生成模板中的字符串。
 */
export function extractEsmRuntimeImportSpecifiers(content: string): string[] {
  const matches = new Set<string>();
  const staticImportRe = /(?:import|export)\s+(?:[^'"`]+?\s+from\s+)?['"]([^'"`]+)['"]/g;
  const dynamicImportRe = /\bimport\(\s*['"]([^'"`]+)['"]\s*\)/g;

  for (const regex of [staticImportRe, dynamicImportRe]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const specifier = match[1]?.trim();
      if (specifier) matches.add(specifier);
    }
  }

  return Array.from(matches).sort();
}

export function normalizeBarePackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split('/')[0] ?? specifier;
}

function isNonBareSpecifier(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return true;
  // URL / node: / file: / data: / bun: 等 scheme specifier 不走 node_modules 包解析。
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return true;
  // 规避对第三方库模板字符串源码片段的误判，例如 pdf.js 中
  // `const wrapper = `await import("${url}");`;` 这类纯字符串模板。
  if (specifier.includes('${')) return true;
  return false;
}

function isBuiltinSpecifier(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return builtinModuleSet.has(specifier);
}

export function findDisallowedBareRuntimeImports(
  content: string,
  options: FindDisallowedBareRuntimeImportsOptions = {},
): BundleRuntimeImportViolation[] {
  const allowedBarePackages = new Set(options.allowedBarePackages ?? []);
  const violations: BundleRuntimeImportViolation[] = [];

  for (const specifier of extractEsmRuntimeImportSpecifiers(content)) {
    if (isNonBareSpecifier(specifier) || isBuiltinSpecifier(specifier)) continue;

    const packageName = normalizeBarePackageName(specifier);
    if (allowedBarePackages.has(packageName)) continue;

    violations.push({ specifier, packageName });
  }

  return violations;
}

export function formatDisallowedBareRuntimeImports(violations: BundleRuntimeImportViolation[]): string {
  return violations
    .map((violation) => violation.specifier === violation.packageName
      ? violation.specifier
      : `${violation.specifier} (package: ${violation.packageName})`)
    .join(', ');
}
