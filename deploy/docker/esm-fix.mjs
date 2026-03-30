// Bridges tsc (moduleResolution: "bundler") output with Node.js ESM resolution.
// tsc emits extensionless relative specifiers; Node.js ESM requires explicit .js.
import { register } from 'node:module';

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('.') || /\.\w+$/.test(specifier))
    return nextResolve(specifier, context);
  for (const suffix of ['.js', '/index.js']) {
    try { return await nextResolve(specifier + suffix, context); } catch {}
  }
  return nextResolve(specifier, context);
}
`)}`);
