/**
 * 专用工具结果渲染器
 *
 * 将每种工具的 args / result 转换为紧凑的一行摘要，
 * 带有可选的颜色片段。移植自 TUI tool-renderers。
 */

// ---- 类型 ----

export type SegmentColor = 'green' | 'red' | 'purple' | 'yellow' | 'muted'

export interface SummarySegment {
  text: string
  color?: SegmentColor
}

export interface ToolSummary {
  /** 纯文本摘要（不含颜色标记，用于 aria / fallback） */
  text: string
  /** 带颜色的片段序列 */
  segments: SummarySegment[]
}

// ---- 辅助函数 ----

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p
}

function countLines(content: unknown): number {
  if (typeof content !== 'string' || content.length === 0) return 0
  return content.endsWith('\n')
    ? content.split('\n').length - 1
    : content.split('\n').length
}

function truncStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function seg(text: string, color?: SegmentColor): SummarySegment {
  return color ? { text, color } : { text }
}

function buildSummary(segments: SummarySegment[]): ToolSummary {
  return {
    text: segments.map(s => s.text).join(''),
    segments,
  }
}

// ---- 各工具渲染器 ----

function firstLine(text: string | undefined, max: number): string {
  if (!text) return ''
  const line = text.trimStart().split('\n')[0] ?? ''
  return line.length > max ? line.slice(0, max) + '…' : line
}

function lineCount(text: string | undefined): number {
  if (!text) return 0
  return text.split('\n').filter(Boolean).length
}

function shellSummary(result: Record<string, unknown>): ToolSummary {
  const exitCode = (result.exitCode ?? 0) as number
  const killed = result.killed as boolean | undefined
  const isError = exitCode !== 0

  // 超时被杀
  if (killed) {
    return buildSummary([seg('✗ killed (timeout)', 'yellow')])
  }

  // 失败：显示 stderr 内容
  if (isError) {
    const reason = firstLine(result.stderr as string | undefined, 80) || `exit ${exitCode}`
    return buildSummary([seg(`✗ ${reason}`, 'red')])
  }

  // 成功：显示输出行数
  const lines = lineCount(result.stdout as string | undefined)
  const summary = lines > 0 ? `${lines} lines output` : 'done (no output)'
  return buildSummary([seg(`✓ ${summary}`, 'green')])
}

interface ReadResultItem {
  path?: string
  lineCount?: number
  startLine?: number
  endLine?: number
}

function readFileSummary(result: Record<string, unknown>): ToolSummary {
  const items = (result.results ?? []) as ReadResultItem[]

  if (items.length === 0) {
    return buildSummary([seg('read 0 lines', 'muted')])
  }

  if (items.length === 1) {
    const item = items[0]
    const lines = item.lineCount ?? 0
    const name = item.path ?? '?'
    const range = item.startLine != null && item.endLine != null
      ? `:${item.startLine}-${item.endLine}`
      : ''
    return buildSummary([
      seg(`${lines} lines`, 'purple'),
      seg(` · ${name}${range}`, 'muted'),
    ])
  }

  const totalLines = items.reduce((sum, i) => sum + (i.lineCount ?? 0), 0)
  const names = items.map(i => basename(i.path ?? '?')).join(', ')
  return buildSummary([
    seg(`${totalLines} lines`, 'purple'),
    seg(` · ${names}`, 'muted'),
  ])
}

function writeFileSummary(result: Record<string, unknown>, args: Record<string, unknown>): ToolSummary {
  const action = (result.action ?? (result.success ? 'written' : 'failed')) as string
  const filePath = (result.path ?? args.path ?? '?') as string
  const content = args.content

  if (!result.path) {
    return buildSummary([seg('wrote 0 files', 'muted')])
  }

  const lines = countLines(content)
  const parts: SummarySegment[] = []

  if (lines > 0 && action !== 'unchanged') {
    if (action === 'created') {
      parts.push(seg(`+${lines} lines`, 'green'))
    } else {
      parts.push(seg(`~${lines} lines`, 'purple'))
    }
    parts.push(seg(' · '))
  }
  if (result.success === false) {
    parts.push(seg(action, 'red'))
  } else {
    parts.push(seg(action))
  }
  parts.push(seg(` · ${filePath}`, 'muted'))
  return buildSummary(parts)
}

function applyDiffSummary(result: Record<string, unknown>, args: Record<string, unknown>): ToolSummary {
  const applied = (result.applied ?? 0) as number
  const totalHunks = (result.totalHunks ?? 0) as number
  const failed = (result.failed ?? 0) as number
  const filePath = (result.path ?? args.path ?? '') as string

  // 从 patch 统计增删行数
  let added = 0
  let deleted = 0
  if (typeof args.patch === 'string') {
    for (const line of (args.patch as string).split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) deleted++
    }
  }

  const parts: SummarySegment[] = []
  if (added > 0) parts.push(seg(`+${added}`, 'green'))
  if (added > 0 && deleted > 0) parts.push(seg(' '))
  if (deleted > 0) parts.push(seg(`-${deleted}`, 'red'))
  if (added > 0 || deleted > 0) parts.push(seg(' · '))
  parts.push(seg(`${applied}/${totalHunks} hunks`))
  if (failed > 0) parts.push(seg(` · ${failed} failed`, 'yellow'))
  if (filePath) parts.push(seg(` · ${filePath}`, 'muted'))

  return buildSummary(parts)
}

function searchInFilesSummary(result: Record<string, unknown>, args: Record<string, unknown>): ToolSummary {
  const mode = result.mode as string | undefined
  const truncated = result.truncated as boolean | undefined
  const suffix = truncated ? ' (truncated)' : ''

  if (mode === 'replace') {
    const total = (result.totalReplacements ?? 0) as number
    const files = (result.processedFiles ?? 0) as number
    const results = result.results as Array<{ changed?: boolean }> | undefined
    const changedFiles = results ? results.filter(f => f.changed).length : files

    const query = typeof args.query === 'string' ? truncStr(args.query, 16) : ''
    const replace = typeof args.replace === 'string' ? truncStr(args.replace, 16) : ''

    const parts: SummarySegment[] = [
      seg(`${total}`, 'purple'),
      seg(` replacements · `),
      seg(`${changedFiles}`, 'purple'),
      seg(`/${files} files`),
    ]
    if (query) parts.push(seg(` · "${query}" → "${replace}"`, 'muted'))
    if (suffix) parts.push(seg(suffix, 'yellow'))
    return buildSummary(parts)
  }

  const count = (result.count ?? 0) as number
  return buildSummary([
    seg(`${count}`),
    seg(` matches found${suffix}`),
  ])
}

function findFilesSummary(result: Record<string, unknown>): ToolSummary {
  const count = (result.count ?? 0) as number
  const truncated = result.truncated as boolean | undefined
  const suffix = truncated ? ' (truncated)' : ''
  return buildSummary([seg(`${count} files found${suffix}`)])
}

function listFilesSummary(result: Record<string, unknown>): ToolSummary {
  const totalFiles = (result.totalFiles ?? 0) as number
  const totalDirs = (result.totalDirs ?? 0) as number
  const items = result.results as Array<{ success?: boolean }> | undefined
  const failCount = items ? items.filter(i => !i.success).length : 0

  const parts: SummarySegment[] = [seg(`${totalFiles} files, ${totalDirs} dirs`)]
  if (failCount > 0) parts.push(seg(` · ${failCount} failed`, 'yellow'))
  return buildSummary(parts)
}

function insertCodeSummary(result: Record<string, unknown>): ToolSummary {
  if (!result.path) {
    return buildSummary([seg('inserted 0 lines', 'muted')])
  }

  if (result.success === false) {
    return buildSummary([seg(`failed (${(result.error as string) ?? result.path ?? '?'})`, 'red')])
  }

  const inserted = (result.insertedLines ?? 0) as number
  const pos = result.line != null ? ` · at L${result.line}` : ''
  return buildSummary([
    seg(`+${inserted} lines`, 'green'),
    seg(`${pos} · ${result.path ?? '?'}`, 'muted'),
  ])
}

function deleteCodeSummary(result: Record<string, unknown>): ToolSummary {
  if (!result.path) {
    return buildSummary([seg('deleted 0 lines', 'muted')])
  }

  if (result.success === false) {
    return buildSummary([seg(`failed (${(result.error as string) ?? result.path ?? '?'})`, 'red')])
  }

  const deleted = (result.deletedLines ?? 0) as number
  const range = result.start_line != null && result.end_line != null
    ? ` · L${result.start_line}-${result.end_line}`
    : ''
  return buildSummary([
    seg(`-${deleted} lines`, 'red'),
    seg(`${range} · ${result.path ?? '?'}`, 'muted'),
  ])
}

// ---- Call 类型摘要 ----

function callSummary(toolName: string, args: Record<string, unknown>): ToolSummary | null {
  switch (toolName) {
    case 'shell':
    case 'bash': {
      const cmd = typeof args.command === 'string' ? truncStr(args.command, 60) : ''
      return cmd ? buildSummary([seg(cmd, 'muted')]) : null
    }
    case 'read_file': {
      const files = args.files as Array<{ path?: string }> | undefined
      if (files && files.length > 0) {
        const names = files.map(f => basename(f.path ?? '?')).join(', ')
        return buildSummary([seg(truncStr(names, 60), 'muted')])
      }
      const p = (args.path ?? args.file_path ?? '') as string
      return p ? buildSummary([seg(p, 'muted')]) : null
    }
    case 'write_file':
    case 'apply_diff':
    case 'insert_code':
    case 'delete_code': {
      const p = (args.path ?? args.file_path ?? '') as string
      return p ? buildSummary([seg(p, 'muted')]) : null
    }
    case 'search_in_files': {
      const q = typeof args.query === 'string' ? truncStr(args.query, 40) : ''
      const mode = args.mode as string | undefined
      if (mode === 'replace') {
        const r = typeof args.replace === 'string' ? truncStr(args.replace, 20) : ''
        return buildSummary([seg(`"${q}" → "${r}"`, 'muted')])
      }
      return q ? buildSummary([seg(`"${q}"`, 'muted')]) : null
    }
    case 'find_files': {
      const pattern = typeof args.pattern === 'string' ? truncStr(args.pattern, 40) : ''
      return pattern ? buildSummary([seg(pattern, 'muted')]) : null
    }
    case 'list_files': {
      const p = (args.path ?? '') as string
      return p ? buildSummary([seg(p, 'muted')]) : null
    }
    default:
      return null
  }
}

// ---- 通用入口 ----

function defaultSummary(data: unknown): ToolSummary {
  if (Array.isArray(data)) {
    return buildSummary([seg(`${data.length} 项`)])
  }
  if (data && typeof data === 'object') {
    return buildSummary([seg(`${Object.keys(data).length} 个字段`)])
  }
  if (typeof data === 'string') {
    return buildSummary([seg(`${data.length} 字符`)])
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return buildSummary([seg('标量结果')])
  }
  return buildSummary([seg('空结果')])
}

/**
 * 获取工具的格式化摘要
 *
 * @param toolName 工具名称
 * @param type     call（工具调用参数）或 response（工具结果）
 * @param data     当 type='call' 时为 args，当 type='response' 时为 result
 * @param args     仅当 type='response' 时传入关联的 call args，供结果渲染器使用
 */
export function getToolSummary(
  toolName: string,
  type: 'call' | 'response',
  data: unknown,
  args?: unknown,
): ToolSummary {
  const d = (data ?? {}) as Record<string, unknown>
  const a = (args ?? {}) as Record<string, unknown>

  if (type === 'call') {
    return callSummary(toolName, d) ?? defaultSummary(data)
  }

  // type === 'response'
  switch (toolName) {
    case 'shell': return shellSummary(d)
    case 'bash': return shellSummary(d)
    case 'read_file': return readFileSummary(d)
    case 'write_file': return writeFileSummary(d, a)
    case 'apply_diff': return applyDiffSummary(d, a)
    case 'search_in_files': return searchInFilesSummary(d, a)
    case 'find_files': return findFilesSummary(d)
    case 'list_files': return listFilesSummary(d)
    case 'insert_code': return insertCodeSummary(d)
    case 'delete_code': return deleteCodeSummary(d)
    default: return defaultSummary(data)
  }
}

/**
 * 获取工具在折叠卡片中的短标签
 * 例如 shell → "shell", read_file → "read_file"
 */
export function getToolShortLabel(toolName: string): string {
  return toolName
}
