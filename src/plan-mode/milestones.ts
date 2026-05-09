import type { MilestoneUpdateInput } from '../core/session-milestones';

export interface PlanMilestoneBuildOptions {
  owner?: string;
  planFilePath?: string;
  maxItems?: number;
}

const DEFAULT_MAX_ITEMS = 8;

const ACTION_SECTION_RE = /(实施|执行|步骤|任务|里程碑|开发|修改|验证|测试|上线|交付|implementation|steps?|tasks?|milestones?|todo|plan)/i;
const PASSIVE_SECTION_RE = /(背景|上下文|目标|约束|风险|说明|备注|现状|已完成|验收|参考|background|context|goals?|constraints?|risks?|notes?|done|acceptance|reference)/i;
const ACTION_TEXT_RE = /(实现|修改|新增|补充|接入|调整|修复|验证|测试|运行|更新|删除|迁移|重构|检查|确认|implement|modify|add|wire|fix|verify|test|run|update|delete|migrate|refactor|check)/i;

interface Candidate {
  text: string;
  source: 'task-list' | 'numbered-list' | 'bullet-list' | 'heading' | 'fallback';
  section?: string;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/^\s*(?:步骤|阶段|任务|Step|Phase|Task)\s*\d+\s*[:：.)-]?\s*/i, '')
    .replace(/^\s*(?:TODO|待办|实施|执行)\s*[:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。；;,.，]+$/g, '')
    .trim();
}

function truncateTitle(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function isUsefulCandidate(text: string): boolean {
  const cleaned = stripMarkdown(text);
  if (cleaned.length < 3) return false;
  if (/^https?:\/\//i.test(cleaned)) return false;
  if (/^(yes|no|true|false|null|none)$/i.test(cleaned)) return false;
  return true;
}

function pushCandidate(candidates: Candidate[], candidate: Candidate): void {
  const cleaned = truncateTitle(stripMarkdown(candidate.text));
  if (!isUsefulCandidate(cleaned)) return;
  const key = cleaned.toLowerCase();
  if (candidates.some((item) => stripMarkdown(item.text).toLowerCase() === key)) return;
  candidates.push({ ...candidate, text: cleaned });
}

export function extractPlanMilestoneCandidates(plan: string, maxItems: number = DEFAULT_MAX_ITEMS): Candidate[] {
  const candidates: Candidate[] = [];
  const headingFallback: Candidate[] = [];
  let inCodeBlock = false;
  let currentSection = '';
  let currentSectionActionable = false;
  let currentSectionPassive = false;

  for (const rawLine of plan.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      currentSection = stripMarkdown(heading[2]);
      currentSectionActionable = ACTION_SECTION_RE.test(currentSection);
      currentSectionPassive = PASSIVE_SECTION_RE.test(currentSection) && !currentSectionActionable;
      if (currentSectionActionable && !currentSectionPassive) {
        headingFallback.push({ text: currentSection, source: 'heading', section: currentSection });
      }
      continue;
    }

    const taskList = /^[-*+]\s+\[[ xX-]\]\s+(.+)$/.exec(line);
    if (taskList) {
      if (currentSectionPassive) {
        continue;
      }
      pushCandidate(candidates, { text: taskList[1], source: 'task-list', section: currentSection });
      continue;
    }

    const numbered = /^\d+[.)、]\s+(.+)$/.exec(line);
    if (numbered) {
      if (currentSectionPassive) {
        continue;
      }
      pushCandidate(candidates, { text: numbered[1], source: 'numbered-list', section: currentSection });
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      const text = bullet[1];
      if (!currentSectionPassive && (currentSectionActionable || ACTION_TEXT_RE.test(text))) {
        pushCandidate(candidates, { text, source: 'bullet-list', section: currentSection });
      }
    }
  }

  if (candidates.length === 0) {
    for (const candidate of headingFallback) {
      pushCandidate(candidates, candidate);
      if (candidates.length >= maxItems) break;
    }
  }

  if (candidates.length === 0) {
    candidates.push({ text: '按批准计划执行', source: 'fallback' });
  }

  return candidates.slice(0, Math.max(1, maxItems));
}

export function buildMilestonesFromApprovedPlan(
  plan: string,
  options: PlanMilestoneBuildOptions = {},
): MilestoneUpdateInput[] {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const candidates = extractPlanMilestoneCandidates(plan, maxItems);
  return candidates.map((candidate, index) => ({
    id: `m${index + 1}`,
    title: candidate.text,
    status: 'pending',
    owner: options.owner,
    description: candidate.section && candidate.section !== candidate.text
      ? `来自计划章节：${candidate.section}`
      : undefined,
    metadata: {
      origin: 'plan_mode',
      source: candidate.source,
      ...(options.planFilePath ? { planFilePath: options.planFilePath } : {}),
    },
  }));
}
