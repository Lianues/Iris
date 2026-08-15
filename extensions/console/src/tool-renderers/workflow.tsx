/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ToolInvocation } from 'irises-extension-sdk';
import type { ToolRendererProps } from './default';
import type { ToolDetailRendererProps } from './index';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

interface WorkflowStepView {
  id?: string;
  path?: string;
  name?: string;
  type?: string;
  depth?: number;
  status?: string;
  durationMs?: number;
  tokens?: number;
  attempt?: number;
  error?: string;
  cachedFromRunId?: string;
  incomplete?: boolean;
  workspace?: {
    branch?: string;
    cwd?: string;
    commit?: string;
    dirty?: boolean;
    changedFiles?: string[];
  };
}

interface WorkflowRunView {
  id?: string;
  name?: string;
  status?: string;
  durationMs?: number;
  tokens?: number;
  agentCount?: number;
  failureCount?: number;
  effectiveBudget?: {
    maxAgents?: number;
    maxTokens?: number;
    maxDurationMs?: number;
    maxFailures?: number;
  };
  error?: string;
  steps?: WorkflowStepView[];
  output?: unknown;
  events?: Array<{ timestamp?: number; level?: string; message?: string; stepPath?: string }>;
}

interface WorkflowDefinitionSummaryView {
  name?: string;
  description?: string;
  stepCount?: number;
  tags?: string[];
}

interface WorkflowDefinitionView extends WorkflowDefinitionSummaryView {
  steps?: Array<Record<string, unknown>>;
}

interface WorkflowResultView {
  ok?: boolean;
  action?: string;
  run?: WorkflowRunView;
  runs?: WorkflowRunView[];
  activeRuns?: WorkflowRunView[];
  workflow?: WorkflowDefinitionSummaryView;
  workflows?: WorkflowDefinitionSummaryView[];
  definition?: WorkflowDefinitionView;
  name?: string;
  deleted?: boolean;
  valid?: boolean;
  cancelled?: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function getResult(result: unknown): WorkflowResultView | undefined {
  return record(result) as WorkflowResultView | undefined;
}

function getRun(result: unknown): WorkflowRunView | undefined {
  return getResult(result)?.run;
}

function getProgress(invocation: ToolInvocation): WorkflowRunView | undefined {
  const progress = record(invocation.progress);
  if (progress?.kind !== 'workflow') return undefined;
  return {
    id: String(progress.runId ?? ''),
    name: String(progress.name ?? ''),
    status: String(progress.status ?? 'running'),
    durationMs: Number(progress.elapsedMs ?? 0),
    tokens: Number(progress.tokens ?? 0),
    agentCount: Number(progress.agentCount ?? 0),
    failureCount: Number(progress.failureCount ?? 0),
    effectiveBudget: record(progress.effectiveBudget) as WorkflowRunView['effectiveBudget'],
    steps: Array.isArray(progress.steps) ? progress.steps as WorkflowStepView[] : [],
  };
}

function getVisibleRun(invocation: ToolInvocation): WorkflowRunView | undefined {
  const persisted = getRun(invocation.result);
  const progress = getProgress(invocation);
  return progress ? { ...persisted, ...progress, output: persisted?.output, events: persisted?.events } : persisted;
}

function statusIcon(status?: string): { icon: string; color: string } {
  switch (status) {
    case 'completed': case 'cached': case 'skipped': return { icon: ICONS.checkmark, color: C.accent };
    case 'failed': return { icon: ICONS.crossmark, color: C.error };
    case 'cancelled': return { icon: ICONS.cancelled, color: C.dim };
    case 'running': return { icon: ICONS.progressInProgress, color: C.accent };
    default: return { icon: ICONS.progressPending, color: C.dim };
  }
}

function duration(ms?: number): string {
  if (!ms || ms < 50) return '';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function summary(run: WorkflowRunView): string {
  const steps = run.steps ?? [];
  const completed = steps.filter((step) => ['completed', 'cached', 'skipped'].includes(step.status ?? '')).length;
  return `${completed}/${steps.length} steps · ${run.agentCount ?? 0} agents${run.tokens ? ` · ${run.tokens.toLocaleString()} tk` : ''}`;
}

function flattenDefinitionSteps(
  steps: Array<Record<string, unknown>> | undefined,
  depth = 0,
): Array<{ name: string; type: string; depth: number }> {
  if (!steps) return [];
  return steps.flatMap((step) => {
    const entry = {
      name: String(step.name ?? step.id ?? 'step'),
      type: String(step.type ?? 'step'),
      depth,
    };
    const nested = Array.isArray(step.steps)
      ? step.steps.flatMap((child) => {
          const value = record(child);
          return value ? [value] : [];
        })
      : [];
    return [entry, ...flattenDefinitionSteps(nested, depth + 1)];
  });
}

function printable(value: unknown, limit = 2_000): string {
  if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}…` : value;
  try {
    const rendered = JSON.stringify(value, null, 2) ?? String(value);
    return rendered.length > limit ? `${rendered.slice(0, limit)}…` : rendered;
  } catch {
    return String(value);
  }
}

export function workflowResultSummary(result: unknown): string | undefined {
  const view = getResult(result);
  if (!view) return undefined;
  if (view.run) return `${view.run.name ?? 'workflow'} · ${summary(view.run)}`;
  if (view.workflows) return `${view.workflows.length} saved workflow${view.workflows.length === 1 ? '' : 's'}`;
  const runs = view.runs ?? view.activeRuns;
  if (runs) return `${runs.length} workflow run${runs.length === 1 ? '' : 's'}`;
  const definition = view.definition ?? view.workflow;
  if (definition) {
    const count = definition.stepCount ?? flattenDefinitionSteps((definition as WorkflowDefinitionView).steps).length;
    return `${definition.name ?? 'workflow'}${count ? ` · ${count} steps` : ''}`;
  }
  if (view.action === 'delete') return view.deleted ? `deleted ${view.name ?? 'workflow'}` : `${view.name ?? 'workflow'} not found`;
  if (view.action === 'validate') return view.valid ? `${view.name ?? 'workflow'} is valid` : 'workflow is invalid';
  if (view.action === 'cancel') return view.cancelled ? 'cancellation requested' : 'run is no longer active';
  return view.action ? `workflow ${view.action} completed` : undefined;
}

export function WorkflowRenderer({ result }: ToolRendererProps) {
  const run = getRun(result);
  if (!run) {
    const view = getResult(result);
    const ok = view?.ok !== false;
    return (
      <text>
        <span fg={ok ? C.accent : C.error}>{ok ? ICONS.checkmark : ICONS.crossmark} </span>
        <span fg={C.textSec}>{workflowResultSummary(result) ?? 'Workflow 操作完成'}</span>
      </text>
    );
  }
  const state = statusIcon(run.status);
  return (
    <text>
      <span fg={state.color}>{state.icon} </span>
      <span fg={C.textSec}>{run.name ?? 'workflow'}</span>
      <span fg={C.dim}> · {summary(run)}</span>
      {run.id ? <span fg={C.dim}> · {run.id}</span> : null}
    </text>
  );
}

function WorkflowOperationDetail({ view }: { view: WorkflowResultView }) {
  const definitions = view.workflows ?? (view.workflow ? [view.workflow] : []);
  const definition = view.definition;
  const definitionSteps = flattenDefinitionSteps(definition?.steps);
  const runs = view.runs ?? view.activeRuns ?? [];
  return (
    <box flexDirection="column" width="100%">
      <text>
        <span bg={view.ok === false ? C.error : C.primary} fg={C.cursorFg}><strong> ◇ WORKFLOW </strong></span>
        <span fg={C.primaryLight}><strong> {String(view.action ?? 'result')}</strong></span>
      </text>
      <text fg={C.dim}>  {workflowResultSummary(view) ?? '操作完成'}</text>

      {definitions.length > 0 ? (
        <box flexDirection="column">
          <text fg={C.dim}>{'─'.repeat(64)}</text>
          <text><span fg={C.primaryLight}><strong>  Saved workflows ({definitions.length})</strong></span></text>
          {definitions.slice(0, 40).map((entry, index) => (
            <box key={`${entry.name}:${index}`} flexDirection="column">
              <text>
                <span fg={C.accent}>  {ICONS.progressPending} </span>
                <span fg={C.textSec}>{entry.name ?? 'workflow'}</span>
                <span fg={C.dim}> · {entry.stepCount ?? 0} steps</span>
                {entry.tags?.length ? <span fg={C.dim}> · {entry.tags.join(', ')}</span> : null}
              </text>
              {entry.description ? <text fg={C.dim}>      {entry.description}</text> : null}
            </box>
          ))}
          {definitions.length > 40 ? <text fg={C.dim}>  … 仅显示前 40 个 Workflow</text> : null}
        </box>
      ) : null}

      {definition ? (
        <box flexDirection="column">
          <text fg={C.dim}>{'─'.repeat(64)}</text>
          <text><span fg={C.primaryLight}><strong>  {definition.name ?? 'Workflow'} definition</strong></span></text>
          {definition.description ? <text fg={C.dim}>  {definition.description}</text> : null}
          {definitionSteps.slice(0, 80).map((step, index) => (
            <text key={`${step.name}:${index}`}>
              <span fg={C.dim}>  {'  '.repeat(step.depth)}{step.depth > 0 ? '└─ ' : ''}</span>
              <span fg={C.textSec}>{step.name}</span>
              <span fg={C.dim}> [{step.type}]</span>
            </text>
          ))}
          {definitionSteps.length > 80 ? <text fg={C.dim}>  … 仅显示前 80 个步骤；使用 /workflow show 查看完整 JSON</text> : null}
        </box>
      ) : null}

      {runs.length > 0 ? (
        <box flexDirection="column">
          <text fg={C.dim}>{'─'.repeat(64)}</text>
          <text><span fg={C.primaryLight}><strong>  Run history ({runs.length})</strong></span></text>
          {runs.slice(0, 30).map((run, index) => {
            const runState = statusIcon(run.status);
            return (
              <text key={`${run.id}:${index}`}>
                <span fg={runState.color}>  {runState.icon} </span>
                <span fg={C.textSec}>{run.name ?? 'workflow'}</span>
                <span fg={C.dim}> · {run.status ?? 'unknown'} · {run.id ?? ''}</span>
                {run.tokens ? <span fg={C.dim}> · {run.tokens.toLocaleString()}tk</span> : null}
              </text>
            );
          })}
          {runs.length > 30 ? <text fg={C.dim}>  … 仅显示最近 30 次运行</text> : null}
        </box>
      ) : null}
    </box>
  );
}

export function WorkflowDetailRenderer({ invocation, children, onNavigateChild, selectedChildIndex = 0 }: ToolDetailRendererProps) {
  const run = getVisibleRun(invocation);
  const operation = getResult(invocation.result);
  if (!run && operation) return <WorkflowOperationDetail view={operation} />;
  const steps = run?.steps ?? [];
  const state = statusIcon(run?.status ?? (invocation.status === 'error' ? 'failed' : 'running'));
  const visibleError = run?.error ?? invocation.error;
  const childWindowStart = Math.max(0, Math.min(selectedChildIndex - 5, children.length - 12));
  const visibleChildren = children.slice(childWindowStart, childWindowStart + 12);
  return (
    <box flexDirection="column" width="100%">
      <text>
        <span bg={visibleError ? C.error : C.primary} fg={C.cursorFg}><strong> ◇ WORKFLOW </strong></span>
        <span fg={C.primaryLight}><strong> {run?.name ?? String(invocation.args.name ?? 'inline')}</strong></span>
        <span fg={state.color}>  {state.icon} {run?.status ?? invocation.status}</span>
      </text>
      <text>
        <span fg={C.dim}>  {run?.id ?? ''}</span>
        <span fg={C.dim}>  {run ? summary(run) : ''}</span>
        {duration(run?.durationMs) ? <span fg={C.dim}> · {duration(run?.durationMs)}</span> : null}
      </text>
      {run?.effectiveBudget ? (
        <text fg={C.dim}>
          {'  '}budget {run.agentCount ?? 0}/{run.effectiveBudget.maxAgents ?? '∞'} agents
          {' · '}{(run.tokens ?? 0).toLocaleString()}/{run.effectiveBudget.maxTokens?.toLocaleString() ?? '∞'} tk
          {' · '}{run.failureCount ?? 0}/{run.effectiveBudget.maxFailures ?? '∞'} failures
          {run.effectiveBudget.maxDurationMs ? ` · ≤${duration(run.effectiveBudget.maxDurationMs)}` : ''}
        </text>
      ) : null}

      <text fg={C.dim}>{'─'.repeat(64)}</text>
      <text><span fg={C.primaryLight}><strong>  Execution tree</strong></span></text>
      {steps.length === 0 ? <text fg={C.dim}>  正在准备步骤…</text> : null}
      {steps.slice(-40).map((step, index) => {
        const stepState = statusIcon(step.status);
        const depth = Math.max(0, Math.min(8, Number(step.depth ?? 0)));
        const prefix = `${'  '.repeat(depth + 1)}${depth > 0 ? '└─ ' : ''}`;
        return (
          <box key={`${step.path ?? step.id}:${index}`} flexDirection="column">
            <text>
              <span fg={C.dim}>{prefix}</span>
              <span fg={stepState.color}>{stepState.icon} </span>
              <span fg={step.status === 'running' ? C.text : step.status === 'failed' ? C.error : step.status === 'completed' ? C.textSec : C.dim}>
                {step.status === 'running' ? <strong>{step.name ?? step.id}</strong> : step.name ?? step.id}
              </span>
              <span fg={C.dim}> [{step.type}]</span>
              {step.cachedFromRunId ? <span fg={C.primaryLight}> cached</span> : null}
              {step.incomplete ? <span fg={C.warn}> partial</span> : null}
              {step.attempt && step.attempt > 1 ? <span fg={C.warn}> try {step.attempt}</span> : null}
              {step.tokens ? <span fg={C.dim}> · {step.tokens.toLocaleString()}tk</span> : null}
              {duration(step.durationMs) ? <span fg={C.dim}> · {duration(step.durationMs)}</span> : null}
            </text>
            {step.workspace ? (
              <box flexDirection="column">
                <text>
                  <span fg={C.dim}>{'  '.repeat(depth + 3)}↳ </span>
                  <span fg={C.primaryLight}>{step.workspace.branch}</span>
                  {step.workspace.commit ? <span fg={C.dim}> · {step.workspace.commit.slice(0, 12)}</span> : null}
                  {step.workspace.dirty ? <span fg={C.warn}> · dirty</span> : null}
                </text>
                {step.workspace.changedFiles?.slice(0, 5).map((file) => (
                  <text key={file} fg={C.dim}>{'  '.repeat(depth + 5)}{file}</text>
                ))}
              </box>
            ) : null}
            {step.error ? <text fg={C.error}>{'  '.repeat(depth + 3)}{step.error}</text> : null}
          </box>
        );
      })}
      {steps.length > 40 ? <text fg={C.dim}>  … 仅显示最近 40 个步骤</text> : null}

      {children.length > 0 ? (
        <box flexDirection="column">
          <text fg={C.dim}>{'─'.repeat(64)}</text>
          <text><span fg={C.primaryLight}><strong>  Scheduled children ({children.length})</strong></span></text>
          {visibleChildren.map((child, index) => {
            const childState = statusIcon(child.status === 'success' ? 'completed' : child.status === 'error' ? 'failed' : 'running');
            const selected = childWindowStart + index === selectedChildIndex;
            return (
              <text key={child.id}>
                <span fg={selected ? C.accent : C.dim}>  {selected ? '›' : ' '} └─ </span>
                <span fg={childState.color}>{childState.icon} </span>
                <span fg={selected ? C.text : C.textSec}>{selected ? <strong>{child.toolName}</strong> : child.toolName}</span>
                <span fg={C.dim}>  {child.id}</span>
                {selected && onNavigateChild ? <span fg={C.dim}>  [Enter 查看]</span> : null}
              </text>
            );
          })}
          {children.length > 12 ? <text fg={C.dim}>  {childWindowStart + 1}-{childWindowStart + visibleChildren.length} / {children.length}</text> : null}
        </box>
      ) : null}

      {visibleError ? (
        <box flexDirection="column">
          <text fg={C.dim}>{'─'.repeat(64)}</text>
          <text fg={C.error}>  {visibleError}</text>
        </box>
      ) : null}

      {run?.output !== undefined ? (
        <box flexDirection="column">
          <text fg={C.dim}>{'─'.repeat(64)}</text>
          <text><span fg={C.primaryLight}><strong>  Output</strong></span></text>
          {printable(run.output).split(/\r?\n/).slice(0, 30).map((line, index) => (
            <text key={`${index}:${line}`} fg={C.textSec}>  {line}</text>
          ))}
        </box>
      ) : null}

      {run?.events?.length ? (
        <box flexDirection="column">
          <text fg={C.dim}>{'─'.repeat(64)}</text>
          <text><span fg={C.primaryLight}><strong>  Recent events</strong></span></text>
          {run.events.slice(-8).map((event, index) => (
            <text key={`${event.timestamp}:${index}`} fg={event.level === 'error' ? C.error : event.level === 'warn' ? C.warn : C.dim}>
              {'  '}{event.stepPath ? `${event.stepPath} · ` : ''}{event.message ?? ''}
            </text>
          ))}
        </box>
      ) : null}
    </box>
  );
}
