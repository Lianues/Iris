/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

export interface SkillDiagnosticItem {
  severity: 'fatal' | 'warning' | 'info' | string;
  code: string;
  message: string;
  field?: string;
  skillName?: string;
  filePath?: string;
  source?: string;
}

export interface SkillResourceItem {
  relativePath: string;
  kind?: string;
  textReadable?: boolean;
  maybeExecutable?: boolean;
  size?: number;
}

export interface SkillListItem {
  name: string;
  description?: string;
  source?: string;
  mode?: string;
  whenToUse?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  resources?: SkillResourceItem[];
}

export interface SkillLoadReportItem {
  skill: SkillListItem;
  diagnostics?: SkillDiagnosticItem[];
}

export interface SkillLoadReport {
  loaded: SkillLoadReportItem[];
  skipped: SkillDiagnosticItem[];
}

interface SkillListViewProps {
  report: SkillLoadReport;
  selectedIndex: number;
  detailsExpanded: boolean;
}

function severityColor(severity: string): string {
  if (severity === 'fatal') return C.error;
  if (severity === 'warning') return C.warn;
  return C.dim;
}

function sourceLabel(source?: string): string {
  return source || 'unknown';
}

function summarizeResources(resources: SkillResourceItem[] | undefined): string {
  if (!resources || resources.length === 0) return '0 resources';
  const scripts = resources.filter(r => r.kind === 'script').length;
  const refs = resources.filter(r => r.kind === 'reference').length;
  const text = resources.filter(r => r.textReadable).length;
  const parts = [`${resources.length} resources`];
  if (refs) parts.push(`${refs} ref`);
  if (scripts) parts.push(`${scripts} script`);
  if (text) parts.push(`${text} text`);
  return parts.join(' / ');
}

export function SkillListView({ report, selectedIndex, detailsExpanded }: SkillListViewProps) {
  const loaded = report.loaded || [];
  const skipped = report.skipped || [];
  const totalDiagnostics = loaded.reduce((sum, item) => sum + (item.diagnostics?.length ?? 0), 0) + skipped.length;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>{`${ICONS.bullet} `}</text>
        <text fg={C.primary}>{'Skills '}</text>
        <text fg={C.dim}>{`(${loaded.length} loaded, ${skipped.length} skipped, ${totalDiagnostics} diagnostics)`}</text>
        <text fg={C.dim}>{`  ${ICONS.arrowUp}${ICONS.arrowDown} select  Enter details  R refresh  PgUp/PgDn  Esc back`}</text>
      </box>
      <scrollbox flexGrow={1}>
        {loaded.length === 0 && skipped.length === 0 && (
          <text fg={C.dim} paddingLeft={2}>No skills found.</text>
        )}
        {loaded.map((item, index) => {
          const skill = item.skill;
          const isSelected = index === selectedIndex;
          const diagCount = item.diagnostics?.length ?? 0;
          const mode = skill.mode || 'inline';
          return (
            <box key={skill.name} flexDirection="column" paddingLeft={1}>
              <box>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? `${ICONS.selectorArrow} ` : '  '}</span>
                  <span fg={C.dim}>{`[${sourceLabel(skill.source)}:${mode}] `}</span>
                  {isSelected
                    ? <strong><span fg={C.text}>{skill.name}</span></strong>
                    : <span fg={C.textSec}>{skill.name}</span>}
                  {skill.disableModelInvocation ? <span fg={C.warn}> model-disabled</span> : null}
                  <span fg={C.dim}>{` ${ICONS.emDash} ${skill.description || '(no description)'}`}</span>
                  <span fg={C.dim}>{`  ${summarizeResources(skill.resources)}`}</span>
                  {diagCount > 0 ? <span fg={C.warn}>{`  ${diagCount} diag`}</span> : null}
                </text>
              </box>
              {isSelected && detailsExpanded && (
                <box flexDirection="column" paddingLeft={4} paddingBottom={1}>
                  {skill.whenToUse ? <text fg={C.textSec}>{`when: ${skill.whenToUse}`}</text> : null}
                  {skill.argumentHint ? <text fg={C.textSec}>{`args: ${skill.argumentHint}`}</text> : null}
                  {(item.diagnostics || []).map((diag, diagIndex) => (
                    <text key={`${diag.code}-${diagIndex}`} fg={severityColor(diag.severity)}>
                      {`${diag.severity}: ${diag.code}${diag.field ? ` (${diag.field})` : ''} - ${diag.message}`}
                    </text>
                  ))}
                  {skill.resources && skill.resources.length > 0 ? (
                    <box flexDirection="column" paddingTop={1}>
                      <text fg={C.dim}>{'resources:'}</text>
                      {skill.resources.slice(0, 12).map((resource) => (
                        <text key={resource.relativePath} fg={C.dim}>{`  - ${resource.relativePath} [${resource.kind || 'other'}${resource.textReadable ? ', text' : ''}${resource.maybeExecutable ? ', exec' : ''}]`}</text>
                      ))}
                      {skill.resources.length > 12 ? <text fg={C.dim}>{`  ... ${skill.resources.length - 12} more`}</text> : null}
                    </box>
                  ) : null}
                  {!skill.whenToUse && !skill.argumentHint && (item.diagnostics || []).length === 0 && (!skill.resources || skill.resources.length === 0) ? (
                    <text fg={C.dim}>{'No additional details.'}</text>
                  ) : null}
                </box>
              )}
              {isSelected && !detailsExpanded && (
                <box paddingLeft={4} paddingBottom={1}>
                  <text fg={C.dim}>{'Details collapsed. Press Enter to expand.'}</text>
                </box>
              )}
            </box>
          );
        })}
        {skipped.length > 0 && (
          <box flexDirection="column" paddingLeft={1} paddingTop={1}>
            <text fg={C.warn}>{'Skipped / global diagnostics'}</text>
            {skipped.map((diag, index) => (
              <text key={`${diag.code}-${index}`} fg={severityColor(diag.severity)}>
                {`  ${diag.severity}: ${diag.skillName ? `${diag.skillName} ` : ''}${diag.code} - ${diag.message}`}
              </text>
            ))}
          </box>
        )}
      </scrollbox>
    </box>
  );
}
