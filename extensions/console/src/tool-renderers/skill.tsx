/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ToolRendererProps } from './default';
import { ICONS } from '../terminal-compat';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unwrapSkillPayload(result: unknown): Record<string, unknown> {
  const root = asRecord(result);
  const rich = asRecord(root.__response);
  if (Object.keys(rich).length > 0) return rich;
  const nested = asRecord(root.result);
  if (Object.keys(nested).length > 0) return nested;
  return root;
}

function countResources(payload: Record<string, unknown>): number {
  const resources = payload.resources;
  return Array.isArray(resources) ? resources.length : 0;
}

function contentLength(payload: Record<string, unknown>): number {
  const content = payload.content;
  return typeof content === 'string' ? content.length : 0;
}

export function SkillRenderer({ toolName, result }: ToolRendererProps) {
  const payload = unwrapSkillPayload(result);
  const name = String(payload.skillName || payload.name || 'skill');
  const chars = contentLength(payload);
  const resources = countResources(payload);
  const truncated = payload.truncated === true;
  const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
  const exitCode = typeof payload.exitCode === 'number' ? `exit ${payload.exitCode}` : '';
  const killed = payload.killed === true ? 'killed' : '';
  const output = typeof payload.output === 'string' ? `${payload.output.length.toLocaleString()} out chars` : '';

  const details = [
    relativePath,
    chars > 0 ? `${chars.toLocaleString()} chars` : '',
    output,
    resources > 0 ? `${resources} resources` : '',
    exitCode,
    killed,
    truncated ? 'truncated' : '',
  ].filter(Boolean).join(' · ');

  const label = (toolName === 'read_skill_resource' || toolName === 'execute_skill_script') ? `${name}${relativePath ? `/${relativePath}` : ''}` : name;
  return <text fg="#888"><em> {ICONS.resultArrow} {label}{details ? ` · ${details}` : ''}</em></text>;
}
