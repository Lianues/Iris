/**
 * 富文本消息渲染工具
 *
 * 参考 webchat-main 的渲染思路，并结合 Iris 当前 GUI 风格做适配：
 * - Markdown → HTML
 * - DOMPurify 安全净化
 * - LaTeX 公式占位/恢复
 * - 代码高亮 + 代码块工具条
 * - 表格滚动容器等结构增强
 */

import 'katex/dist/katex.min.css'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import katex from 'katex'
import hljs from 'highlight.js/lib/core'
import bashLanguage from 'highlight.js/lib/languages/bash'
import cLanguage from 'highlight.js/lib/languages/c'
import cppLanguage from 'highlight.js/lib/languages/cpp'
import csharpLanguage from 'highlight.js/lib/languages/csharp'
import cssLanguage from 'highlight.js/lib/languages/css'
import goLanguage from 'highlight.js/lib/languages/go'
import javaLanguage from 'highlight.js/lib/languages/java'
import javascriptLanguage from 'highlight.js/lib/languages/javascript'
import jsonLanguage from 'highlight.js/lib/languages/json'
import markdownLanguage from 'highlight.js/lib/languages/markdown'
import phpLanguage from 'highlight.js/lib/languages/php'
import pythonLanguage from 'highlight.js/lib/languages/python'
import rubyLanguage from 'highlight.js/lib/languages/ruby'
import rustLanguage from 'highlight.js/lib/languages/rust'
import sqlLanguage from 'highlight.js/lib/languages/sql'
import typescriptLanguage from 'highlight.js/lib/languages/typescript'
import xmlLanguage from 'highlight.js/lib/languages/xml'
import yamlLanguage from 'highlight.js/lib/languages/yaml'

import { findFenceRenderer } from './renderers/registry'
import './renderers/svg-renderer'
import './renderers/html-renderer'
import './renderers/diff-renderer'
import './renderers/mermaid-renderer'
import { parseLineHighlights } from './code-highlights'

hljs.registerLanguage('bash', bashLanguage)
hljs.registerLanguage('c', cLanguage)
hljs.registerLanguage('cpp', cppLanguage)
hljs.registerLanguage('csharp', csharpLanguage)
hljs.registerLanguage('css', cssLanguage)
hljs.registerLanguage('go', goLanguage)
hljs.registerLanguage('java', javaLanguage)
hljs.registerLanguage('javascript', javascriptLanguage)
hljs.registerLanguage('json', jsonLanguage)
hljs.registerLanguage('markdown', markdownLanguage)
hljs.registerLanguage('php', phpLanguage)
hljs.registerLanguage('python', pythonLanguage)
hljs.registerLanguage('ruby', rubyLanguage)
hljs.registerLanguage('rust', rustLanguage)
hljs.registerLanguage('sql', sqlLanguage)
hljs.registerLanguage('typescript', typescriptLanguage)
hljs.registerLanguage('xml', xmlLanguage)
hljs.registerLanguage('yaml', yamlLanguage)

const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a',
    'p',
    'br',
    'strong',
    'em',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'colgroup',
    'col',
    'caption',
    'img',
    'hr',
    'del',
    'span',
    'div',
    'section',
    'sup',
    'sub',
    'mark',
    'small',
    'b',
    'i',
    'u',
    's',
    'details',
    'summary',
    'kbd',
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'title',
    'class',
    'id',
    'role',
    'target',
    'rel',
    'width',
    'height',
    'loading',
    'decoding',
    'open',
    'colspan',
    'rowspan',
    'scope',
    'start',
    'reversed',
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form', 'input', 'textarea', 'button', 'select', 'option'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'oninput', 'onchange'],
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
}

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  diff: 'Diff',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  latex: 'LaTeX',
  json: 'JSON',
  markdown: 'Markdown',
  php: 'PHP',
  plaintext: '文本',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  sql: 'SQL',
  svg: 'SVG',
  text: '文本',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
}

const LANGUAGE_ALIASES: Record<string, string> = {
  cplusplus: 'cpp',
  cs: 'csharp',
  htm: 'html',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  'c#': 'csharp',
  plaintext: 'text',
  katex: 'latex',
  patch: 'diff',
  py: 'python',
  rb: 'ruby',
  tex: 'latex',
  math: 'latex',
  latex: 'latex',
  rs: 'rust',
  shell: 'bash',
  sh: 'bash',
  text: 'text',
  svg: 'svg',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
}

const HIGHLIGHT_LANGUAGE_MAP: Record<string, string> = {
  csharp: 'csharp',
  cpp: 'cpp',
  html: 'xml',
  javascript: 'javascript',
  markdown: 'markdown',
  text: 'plaintext',
  svg: 'xml',
  typescript: 'typescript',
  yaml: 'yaml',
}

const LATEX_FENCE_LANGUAGES = new Set(['latex', 'tex', 'math'])
const FENCED_CODE_BLOCK_PATTERN = /(^|\n)(`{3,}|~{3,})/
const HTML_DOCTYPE_PATTERN = /<!doctype\s+html/i
const HTML_ROOT_TAG_PATTERN = /<html(?:\s|>)/i
const HTML_STRUCTURE_TAG_PATTERN = /<(head|body)(?:\s|>)/ig
const LATEX_BLOCK_ENV_PATTERN = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|aligned\*?|alignat\*?|split|cases|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|matrix)\}([\s\S]*?)\\end\{\1\}/g
const LATEX_EXPLICIT_MATH_PATTERN = /\\begin\{(?:equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|aligned\*?|alignat\*?|split|cases|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|matrix)\}|\\\[|\\\(|\$\$/
const LATEX_STRONG_PATTERN = /\\documentclass|\\usepackage|\\begin\{document\}|\\end\{document\}|\\(?:sub)*section\*?\{|\\begin\{(?:equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|aligned\*?|alignat\*?|split|cases|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|matrix)\}|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/m
const LATEX_MATH_COMMAND_PATTERN = /\\(?:nabla|frac|mathbf|mathbb|mathrm|epsilon|varepsilon|mu|rho|Phi|phi|oint|cdot|times|partial|text|sum|prod|int|sqrt|left|right|begin|end|alpha|beta|gamma|delta|lambda|omega)\b/
const LATEX_TABULAR_ENV_PATTERN = /\\begin\{tabular\*?\}/
const LATEX_BOOKTABS_RULE_PATTERN = /\\(?:toprule|midrule|bottomrule|cmidrule)\b/
const AMBIGUOUS_STRONG_SEGMENT_PATTERN = /\*\*([^\r\n]+?)\*\*/g
const AMBIGUOUS_EMPHASIS_SEGMENT_PATTERN = /\*([^\r\n*]+?)\*/g
const HTML_INLINE_FALLBACK_BLOCKED_CONTENT_PATTERN = /[`<>\[\]_]/
const EMPHASIS_BOUNDARY_PUNCTUATION_PATTERN = /[\p{P}\p{S}]/u
const ASCII_WORD_CHARACTER_PATTERN = /[A-Za-z0-9]/
const NON_ASCII_CHARACTER_PATTERN = /[^\u0000-\u007F]/

interface LatexFormula {
  formula: string
  display: boolean
  placeholderType: 'inline' | 'block'
}

type LatexBooktabsAlign = 'left' | 'center' | 'right'

interface LatexBooktabsCell {
  html: string
  colspan: number
  align: LatexBooktabsAlign
}

interface LatexBooktabsRow {
  cells: LatexBooktabsCell[]
}

type LatexBooktabsToken =
  | { type: 'row'; content: string }
  | { type: 'rule'; rule: 'mid' | 'cmid' }

interface ProtectedSegment {
  placeholder: string
  value: string
}

interface DeferredHtmlSegment {
  placeholder: string
  html: string
}

interface MarkdownRenderEnv {
  deferredHtmlSegments?: DeferredHtmlSegment[]
}

class RichTextCache {
  private readonly cache = new Map<string, string>()

  constructor(private readonly maxSize = 60) {}

  get(key: string): string | null {
    if (!this.cache.has(key)) return null
    const value = this.cache.get(key) ?? null
    if (value === null) return null
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: string, value: string) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (typeof oldestKey === 'string') {
        this.cache.delete(oldestKey)
      }
    }
    this.cache.set(key, value)
  }

  clear() {
    this.cache.clear()
  }
}

const richTextCache = new RichTextCache(60)

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function hasEmphasisBoundaryPunctuation(text: string): boolean {
  if (!text) return false
  const chars = Array.from(text)
  const first = chars[0] ?? ''
  const last = chars[chars.length - 1] ?? ''
  return EMPHASIS_BOUNDARY_PUNCTUATION_PATTERN.test(first) || EMPHASIS_BOUNDARY_PUNCTUATION_PATTERN.test(last)
}

function hasNonAsciiCharacters(text: string): boolean {
  return NON_ASCII_CHARACTER_PATTERN.test(text)
}

function isAsciiWordCharacter(char: string): boolean {
  return !!char && ASCII_WORD_CHARACTER_PATTERN.test(char)
}

function getAdjacentCharacters(source: string, startIndex: number, endIndex: number): { previous: string; next: string } {
  const previous = Array.from(source.slice(0, startIndex)).pop() ?? ''
  const next = Array.from(source.slice(endIndex))[0] ?? ''
  return { previous, next }
}

function shouldUseHtmlStrongFallback(content: string): boolean {
  if (!content || content.trim() !== content) return false
  if (HTML_INLINE_FALLBACK_BLOCKED_CONTENT_PATTERN.test(content)) return false
  if (content.includes('**')) return false
  return hasEmphasisBoundaryPunctuation(content)
}

function shouldUseHtmlEmphasisFallback(content: string, previous: string, next: string): boolean {
  if (!content || content.trim() !== content) return false
  if (HTML_INLINE_FALLBACK_BLOCKED_CONTENT_PATTERN.test(content)) return false
  if (content.includes('*')) return false
  if (!hasEmphasisBoundaryPunctuation(content)) return false
  if (!hasNonAsciiCharacters(content)) return false
  return !isAsciiWordCharacter(previous) && !isAsciiWordCharacter(next)
}

function normalizeAmbiguousStrongSyntax(text: string): string {
  // CommonMark 对 emphasis delimiter 的左右夹逼规则较严格：
  // 当 **...** 的首尾字符是括号/引号/符号，且内容两侧又紧邻中文时，
  // markdown-it 可能把整段保留为纯文本，例如：
  //   当前**工作区（项目根目录）**下
  // 这里仅对“纯文本型”的粗体片段做兜底，转成显式 <strong>，
  // 避免误伤包含链接、代码、下划线等更复杂的 Markdown 结构。
  return text.replace(AMBIGUOUS_STRONG_SEGMENT_PATTERN, (match, content: string) => {
    if (!shouldUseHtmlStrongFallback(content)) {
      return match
    }

    return `<strong>${escapeHtml(content)}</strong>`
  })
}

function normalizeAmbiguousEmphasisSyntax(text: string): string {
  // 单星号更容易与乘法、通配符、标识符边界混淆，因此这里额外要求：
  // 1. 内容首尾命中括号/引号/符号等边界标点；
  // 2. 内容中至少包含非 ASCII 字符（主要覆盖中文/全角标点场景）；
  // 3. 定界符两侧都不能紧邻 ASCII 单词字符，避免误伤 a*(b)*c 之类表达式。
  return text.replace(AMBIGUOUS_EMPHASIS_SEGMENT_PATTERN, (match, content: string, offset: number, source: string) => {
    const previous = source[offset - 1] ?? ''
    const next = source[offset + match.length] ?? ''
    if (previous === '*' || next === '*') {
      return match
    }

    const adjacent = getAdjacentCharacters(source, offset, offset + match.length)
    if (!shouldUseHtmlEmphasisFallback(content, adjacent.previous, adjacent.next)) {
      return match
    }

    return `<em>${escapeHtml(content)}</em>`
  })
}

function normalizeAmbiguousInlineEmphasisSyntax(text: string): string {
  return normalizeAmbiguousEmphasisSyntax(normalizeAmbiguousStrongSyntax(text))
}

function normalizeLanguageLabel(lang?: string | null): string {
  const value = lang?.trim().toLowerCase()
  if (!value) return 'text'
  return LANGUAGE_ALIASES[value] ?? value
}

function getHighlightLanguage(label: string): string | null {
  const normalized = normalizeLanguageLabel(label)
  const highlightLanguage = HIGHLIGHT_LANGUAGE_MAP[normalized] ?? normalized
  return hljs.getLanguage(highlightLanguage) ? highlightLanguage : null
}

function containsFencedCodeBlocks(text: string): boolean {
  return FENCED_CODE_BLOCK_PATTERN.test(text)
}

function looksLikeStandaloneHtmlDocument(text: string): boolean {
  const normalized = text.trim()
  if (!normalized || containsFencedCodeBlocks(normalized)) return false

  if (HTML_DOCTYPE_PATTERN.test(normalized)) {
    return true
  }

  const hasRootTag = HTML_ROOT_TAG_PATTERN.test(normalized)
  const structureTagMatches = normalized.match(HTML_STRUCTURE_TAG_PATTERN) ?? []
  const hasClosingRoot = /<\/html>|<\/body>/i.test(normalized)

  return hasRootTag && structureTagMatches.length >= 1 && hasClosingRoot
}

function looksLikeLatexSource(text: string, hintedLang?: string | null): boolean {
  const normalizedHint = normalizeLanguageLabel(hintedLang)
  if (LATEX_FENCE_LANGUAGES.has(normalizedHint)) return true

  const trimmed = text.trim()
  if (!trimmed) return false

  if (LATEX_STRONG_PATTERN.test(trimmed)) return true

  const commandMatches = trimmed.match(/\\[A-Za-z]+(?:\*?)/g) ?? []
  return commandMatches.length >= 4 && LATEX_MATH_COMMAND_PATTERN.test(trimmed)
}

function shouldNormalizeLatexDocument(text: string): boolean {
  if (containsFencedCodeBlocks(text)) return false
  return /\\documentclass|\\usepackage|\\begin\{document\}|\\(?:sub)*section\*?\{|\\maketitle/.test(text)
}

function normalizeLatexDocumentText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*%.*$/gm, '')
    .replace(/^\s*\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\s*$/gm, '')
    .replace(/^\s*\\usepackage(?:\[[^\]]*\])?\{[^}]+\}\s*$/gm, '')
    .replace(/^\s*\\(?:begin|end)\{document\}\s*$/gm, '')
    .replace(/^\s*\\maketitle\s*$/gm, '')
    .replace(/^\s*\\section\*?\{([^{}]+)\}\s*$/gm, '\n## $1\n')
    .replace(/^\s*\\subsection\*?\{([^{}]+)\}\s*$/gm, '\n### $1\n')
    .replace(/^\s*\\subsubsection\*?\{([^{}]+)\}\s*$/gm, '\n#### $1\n')
    .replace(/^\s*\\paragraph\*?\{([^{}]+)\}\s*$/gm, '\n**$1**\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sanitizeLatexFormula(formula: string): string {
  return formula
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\\label\{[^{}]*\}/g, '')
    .replace(/\\ref\{([^{}]*)\}/g, '$1')
    .replace(/\\eqref\{([^{}]*)\}/g, '($1)')
    .replace(/\\pageref\{([^{}]*)\}/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasRenderedLatexPreview(html: string): boolean {
  return /class="(?:message-katex-(?:block|inline)|katex\b)/.test(html)
}

function unwrapLatexPreviewFormula(source: string): { formula: string; display: boolean } {
  const trimmed = source.trim()

  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
    return { formula: trimmed.slice(2, -2).trim(), display: true }
  }

  const bracketMatch = trimmed.match(/^\\\[([\s\S]*?)\\\]$/)
  if (bracketMatch) {
    return { formula: bracketMatch[1].trim(), display: true }
  }

  const parenMatch = trimmed.match(/^\\\(([\s\S]*?)\\\)$/)
  if (parenMatch) {
    return { formula: parenMatch[1].trim(), display: false }
  }

  const inlineDollarMatch = trimmed.match(/^\$([^$\n]+?)\$$/)
  if (inlineDollarMatch) {
    return { formula: inlineDollarMatch[1].trim(), display: false }
  }

  return { formula: trimmed, display: true }
}

function renderDirectLatexPreviewMath(source: string): string {
  const { formula, display } = unwrapLatexPreviewFormula(source)
  const sanitized = sanitizeLatexFormula(formula)
  if (!sanitized) return ''

  try {
    const rendered = katex.renderToString(sanitized, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
      trust: false,
      strict: 'warn',
    })

    return display
      ? `<div class="message-katex-block">${rendered}</div>`
      : `<span class="message-katex-inline">${rendered}</span>`
  } catch (error) {
    const message = error instanceof Error ? error.message : '公式渲染失败'
    return [
      '<div class="message-latex-raw-fallback">',
      `<div class="message-latex-fallback-hint">预览失败，已回退到源码展示：${escapeHtml(message)}</div>`,
      `<pre>${escapeHtml(source)}</pre>`,
      '</div>',
    ].join('')
  }
}

function skipWhitespace(value: string, startIndex: number): number {
  let index = startIndex
  while (index < value.length && /\s/.test(value[index])) {
    index += 1
  }
  return index
}

function readLatexGroup(value: string, startIndex: number): { content: string; nextIndex: number } | null {
  const index = skipWhitespace(value, startIndex)
  if (value[index] !== '{') return null

  let depth = 0
  let content = ''

  for (let cursor = index; cursor < value.length; cursor += 1) {
    const char = value[cursor]
    const escaped = value[cursor - 1] === '\\'

    if (char === '{' && !escaped) {
      depth += 1
      if (depth > 1) content += char
      continue
    }

    if (char === '}' && !escaped) {
      depth -= 1
      if (depth === 0) {
        return { content, nextIndex: cursor + 1 }
      }
      content += char
      continue
    }

    if (depth >= 1) {
      content += char
    }
  }

  return null
}

function readLatexOptionalBracketGroup(value: string, startIndex: number): { content: string; nextIndex: number } | null {
  const index = skipWhitespace(value, startIndex)
  if (value[index] !== '[') return null

  let depth = 0
  let content = ''

  for (let cursor = index; cursor < value.length; cursor += 1) {
    const char = value[cursor]
    const escaped = value[cursor - 1] === '\\'

    if (char === '[' && !escaped) {
      depth += 1
      if (depth > 1) content += char
      continue
    }

    if (char === ']' && !escaped) {
      depth -= 1
      if (depth === 0) {
        return { content, nextIndex: cursor + 1 }
      }
      content += char
      continue
    }

    if (depth >= 1) {
      content += char
    }
  }

  return null
}

function stripLatexComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, '$1')
}

function parseLatexColumnAlignments(spec: string): LatexBooktabsAlign[] {
  const alignments: LatexBooktabsAlign[] = []

  const appendAlignments = (segment: string) => {
    let index = 0

    while (index < segment.length) {
      index = skipWhitespace(segment, index)
      const char = segment[index]
      if (!char) break

      if (char === 'l') {
        alignments.push('left')
        index += 1
        continue
      }
      if (char === 'c') {
        alignments.push('center')
        index += 1
        continue
      }
      if (char === 'r' || char === 'S') {
        alignments.push('right')
        index += 1
        continue
      }
      if (char === 'p' || char === 'm' || char === 'b' || char === 'X') {
        alignments.push('left')
        const group = readLatexGroup(segment, index + 1)
        index = group ? group.nextIndex : index + 1
        continue
      }
      if (char === '@' || char === '!' || char === '>' || char === '<') {
        const group = readLatexGroup(segment, index + 1)
        index = group ? group.nextIndex : index + 1
        continue
      }
      if (char === '*') {
        const repeatGroup = readLatexGroup(segment, index + 1)
        if (!repeatGroup) {
          index += 1
          continue
        }
        const repeatedSpecGroup = readLatexGroup(segment, repeatGroup.nextIndex)
        if (!repeatedSpecGroup) {
          index = repeatGroup.nextIndex
          continue
        }
        const repeatCount = Math.max(0, Number.parseInt(repeatGroup.content.trim(), 10) || 0)
        const repeatedAlignments = parseLatexColumnAlignments(repeatedSpecGroup.content)
        for (let repeat = 0; repeat < repeatCount; repeat += 1) {
          alignments.push(...repeatedAlignments)
        }
        index = repeatedSpecGroup.nextIndex
        continue
      }
      if (char === '|' || char === ':') {
        index += 1
        continue
      }

      index += 1
    }
  }

  appendAlignments(spec)
  return alignments.length > 0 ? alignments : ['left']
}

function renderInlineLatexMath(source: string): string {
  const sanitized = sanitizeLatexFormula(source)
  if (!sanitized) return ''

  try {
    const rendered = katex.renderToString(sanitized, {
      displayMode: false,
      throwOnError: false,
      output: 'html',
      trust: false,
      strict: 'warn',
    })
    return `<span class="message-katex-inline">${rendered}</span>`
  } catch {
    return ''
  }
}

function normalizeLatexBooktabsInlineText(text: string): string {
  return text
    .replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
    .replace(/\\(?:textit|emph)\{([^{}]*)\}/g, '*$1*')
    .replace(/\\texttt\{([^{}]*)\}/g, '`$1`')
    .replace(/\\(?:mathrm|mathbf|mathit)\{([^{}]*)\}/g, '$1')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/~/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

function renderLatexBooktabsCellHtml(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  if (
    LATEX_EXPLICIT_MATH_PATTERN.test(trimmed)
    || (/\\[A-Za-z]+/.test(trimmed) && looksLikePlainLatexMathLine(trimmed))
  ) {
    const mathHtml = renderInlineLatexMath(trimmed)
    if (mathHtml) {
      return mathHtml
    }
  }

  const inlineHtml = compileInlineRichText(trimmed).trim()
  if (inlineHtml) return inlineHtml

  return escapeHtml(trimmed)
}

function splitLatexBooktabsCells(rowContent: string): string[] {
  const cells: string[] = []
  let buffer = ''
  let braceDepth = 0

  for (let index = 0; index < rowContent.length; index += 1) {
    const char = rowContent[index]
    const escaped = rowContent[index - 1] === '\\'

    if (char === '{' && !escaped) {
      braceDepth += 1
      buffer += char
      continue
    }

    if (char === '}' && !escaped) {
      braceDepth = Math.max(0, braceDepth - 1)
      buffer += char
      continue
    }

    if (char === '&' && !escaped && braceDepth === 0) {
      cells.push(buffer.trim())
      buffer = ''
      continue
    }

    buffer += char
  }

  cells.push(buffer.trim())
  return cells
}

function parseLatexMulticolumn(cellSource: string): { colspan: number; align: LatexBooktabsAlign; content: string } | null {
  const trimmed = cellSource.trim()
  if (!trimmed.startsWith('\\multicolumn')) return null

  let cursor = '\\multicolumn'.length
  const spanGroup = readLatexGroup(trimmed, cursor)
  if (!spanGroup) return null
  cursor = spanGroup.nextIndex

  const alignGroup = readLatexGroup(trimmed, cursor)
  if (!alignGroup) return null
  cursor = alignGroup.nextIndex

  const contentGroup = readLatexGroup(trimmed, cursor)
  if (!contentGroup) return null

  const span = Math.max(1, Number.parseInt(spanGroup.content.trim(), 10) || 1)
  const alignments = parseLatexColumnAlignments(alignGroup.content)
  return {
    colspan: span,
    align: alignments[0] ?? 'center',
    content: contentGroup.content,
  }
}

function findLatexBooktabsTabular(source: string): { columnSpec: string; body: string } | null {
  const beginMatch = source.match(/\\begin\{tabular\*?\}/)
  if (!beginMatch || beginMatch.index === undefined) return null

  const envName = beginMatch[0].includes('tabular*') ? 'tabular*' : 'tabular'
  let cursor = beginMatch.index + beginMatch[0].length

  if (envName === 'tabular*') {
    const widthGroup = readLatexGroup(source, cursor)
    if (!widthGroup) return null
    cursor = widthGroup.nextIndex
  }

  const columnSpecGroup = readLatexGroup(source, cursor)
  if (!columnSpecGroup) return null
  cursor = columnSpecGroup.nextIndex

  const endToken = `\\end{${envName}}`
  const endIndex = source.indexOf(endToken, cursor)
  if (endIndex < 0) return null

  return {
    columnSpec: columnSpecGroup.content,
    body: source.slice(cursor, endIndex),
  }
}

function createLatexPlaceholder(index: number, placeholderType: 'inline' | 'block'): string {
  if (placeholderType === 'block') {
    return `\n\n<div class="latex-placeholder-block" data-latex-index="${index}"></div>\n\n`
  }
  return `<span class="latex-placeholder-inline" data-latex-index="${index}"></span>`
}

function createLatexPlaceholderPattern(index: number): RegExp {
  return new RegExp(
    `<(?:span|div)[^>]*data-latex-index="${index}"[^>]*><\\/(?:span|div)>`,
  )
}

function createDeferredHtmlPlaceholder(index: number): string {
  return `<div class="rendered-html-placeholder" data-rendered-html-index="${index}"></div>`
}

function createDeferredHtmlPlaceholderPattern(index: number): RegExp {
  return new RegExp(
    `<div[^>]*class="rendered-html-placeholder"[^>]*data-rendered-html-index="${index}"[^>]*><\\/div>`,
  )
}

function restoreDeferredHtmlSegments(html: string, segments: DeferredHtmlSegment[]): string {
  let result = html
  for (let index = 0; index < segments.length; index += 1) {
    result = result.replace(createDeferredHtmlPlaceholderPattern(index), segments[index].html)
  }
  return result
}

function looksLikePlainLatexMathLine(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('%')) return false

  if (LATEX_MATH_COMMAND_PATTERN.test(trimmed)) return true

  return /(=|\\cdot|\\times|\\partial|\\to|\\mapsto|\\implies|\\iff|[_^][{A-Za-z0-9]|\\[A-Za-z]+\{)/.test(trimmed)
}

function buildLatexPreviewSource(source: string): string {
  const normalized = normalizeLatexDocumentText(source) || source
  if (!normalized) return source

  if (LATEX_EXPLICIT_MATH_PATTERN.test(normalized)) {
    return normalized
  }

  const segments: string[] = []
  let formulaLines: string[] = []

  const flushFormulaLines = () => {
    if (formulaLines.length === 0) return
    segments.push(`$$\n${formulaLines.join('\n')}\n$$`)
    formulaLines = []
  }

  for (const line of normalized.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushFormulaLines()
      continue
    }

    if (trimmed.startsWith('%')) {
      flushFormulaLines()
      const commentText = trimmed.replace(/^%+\s*/, '').trim()
      if (commentText) {
        segments.push(`<p class="message-latex-note">${escapeHtml(commentText)}</p>`)
      }
      continue
    }

    if (looksLikePlainLatexMathLine(trimmed)) {
      formulaLines.push(trimmed)
      continue
    }

    flushFormulaLines()
    segments.push(`<p>${escapeHtml(trimmed)}</p>`)
  }

  flushFormulaLines()
  return segments.join('\n\n').trim() || normalized
}

function buildDirectLatexPreviewHtml(source: string): string {
  const normalized = normalizeLatexDocumentText(source) || source
  if (!normalized.trim()) return ''

  if (LATEX_EXPLICIT_MATH_PATTERN.test(normalized)) {
    return renderDirectLatexPreviewMath(normalized)
  }

  const segments: string[] = []
  let formulaLines: string[] = []

  const flushFormulaLines = () => {
    if (formulaLines.length === 0) return
    const rendered = renderDirectLatexPreviewMath(formulaLines.join('\n'))
    if (rendered) {
      segments.push(rendered)
    }
    formulaLines = []
  }

  for (const line of normalized.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushFormulaLines()
      continue
    }

    if (trimmed.startsWith('%')) {
      flushFormulaLines()
      const commentText = trimmed.replace(/^%+\s*/, '').trim()
      if (commentText) {
        segments.push(`<p class="message-latex-note">${escapeHtml(commentText)}</p>`)
      }
      continue
    }

    if (looksLikePlainLatexMathLine(trimmed)) {
      formulaLines.push(trimmed)
      continue
    }

    flushFormulaLines()
    segments.push(`<p>${escapeHtml(trimmed)}</p>`)
  }

  flushFormulaLines()
  return segments.join('\n').trim()
}

function extractLatexCaptionSource(source: string): string {
  const captionIndex = source.indexOf('\\caption')
  if (captionIndex < 0) return ''

  let cursor = captionIndex + '\\caption'.length
  const optionalShortCaption = readLatexOptionalBracketGroup(source, cursor)
  if (optionalShortCaption) {
    cursor = optionalShortCaption.nextIndex
  }

  const captionGroup = readLatexGroup(source, cursor)
  return captionGroup?.content.trim() ?? ''
}

function tokenizeLatexBooktabsBody(body: string): LatexBooktabsToken[] {
  const tokens: LatexBooktabsToken[] = []
  const normalized = stripLatexComments(body).replace(/\r\n?/g, '\n')
  let buffer = ''

  const flushRow = () => {
    const content = buffer.trim()
    if (content) {
      tokens.push({ type: 'row', content })
    }
    buffer = ''
  }

  for (let index = 0; index < normalized.length; ) {
    if (normalized.startsWith('\\toprule', index)) {
      flushRow()
      index += '\\toprule'.length
      continue
    }
    if (normalized.startsWith('\\midrule', index)) {
      flushRow()
      tokens.push({ type: 'rule', rule: 'mid' })
      index += '\\midrule'.length
      continue
    }
    if (normalized.startsWith('\\bottomrule', index)) {
      flushRow()
      index += '\\bottomrule'.length
      continue
    }
    if (normalized.startsWith('\\cmidrule', index)) {
      flushRow()
      tokens.push({ type: 'rule', rule: 'cmid' })
      index += '\\cmidrule'.length
      const cmidruleOptions = readLatexOptionalBracketGroup(normalized, index)
      if (cmidruleOptions) {
        index = cmidruleOptions.nextIndex
      }
      const cmidruleRange = readLatexGroup(normalized, index)
      if (cmidruleRange) {
        index = cmidruleRange.nextIndex
      }
      continue
    }
    if (normalized.startsWith('\\addlinespace', index)) {
      flushRow()
      index += '\\addlinespace'.length
      const lineSpaceOptions = readLatexOptionalBracketGroup(normalized, index)
      if (lineSpaceOptions) {
        index = lineSpaceOptions.nextIndex
      }
      continue
    }
    if (normalized.startsWith('\\hline', index)) {
      flushRow()
      tokens.push({ type: 'rule', rule: 'mid' })
      index += '\\hline'.length
      continue
    }
    if (normalized[index] === '\\' && normalized[index + 1] === '\\') {
      flushRow()
      index += 2
      const rowSpacing = readLatexOptionalBracketGroup(normalized, index)
      if (rowSpacing) {
        index = rowSpacing.nextIndex
      }
      continue
    }

    buffer += normalized[index]
    index += 1
  }

  flushRow()
  return tokens
}

function buildLatexBooktabsPreviewHtml(source: string): string {
  const normalized = normalizeLatexDocumentText(source) || source
  if (!LATEX_TABULAR_ENV_PATTERN.test(normalized) || !LATEX_BOOKTABS_RULE_PATTERN.test(normalized)) {
    return ''
  }

  const tabular = findLatexBooktabsTabular(normalized)
  if (!tabular) return ''

  const alignments = parseLatexColumnAlignments(tabular.columnSpec)
  const tokens = tokenizeLatexBooktabsBody(tabular.body)
  const headerRows: LatexBooktabsRow[] = []
  const bodyRows: LatexBooktabsRow[] = []
  let currentSection: 'header' | 'body' = 'header'
  let alignmentCursor = 0

  const buildRow = (content: string): LatexBooktabsRow | null => {
    alignmentCursor = 0
    const cells = splitLatexBooktabsCells(content).map((cellSource) => {
      const multicolumn = parseLatexMulticolumn(cellSource)
      const colspan = multicolumn?.colspan ?? 1
      const align = multicolumn?.align ?? (alignments[alignmentCursor] ?? 'left')
      const cellContent = normalizeLatexBooktabsInlineText(multicolumn?.content ?? cellSource)
      const html = renderLatexBooktabsCellHtml(cellContent)
      alignmentCursor += colspan
      return { html: html || '&#8203;', colspan, align }
    })

    return cells.length > 0 ? { cells } : null
  }

  for (const token of tokens) {
    if (token.type === 'rule') {
      if (token.rule === 'mid' && headerRows.length > 0) {
        currentSection = 'body'
      }
      continue
    }

    const row = buildRow(token.content)
    if (!row) continue
    if (currentSection === 'header') headerRows.push(row)
    else bodyRows.push(row)
  }

  if (bodyRows.length === 0 && headerRows.length > 1) {
    bodyRows.push(...headerRows.splice(1))
  }
  if (headerRows.length === 0 && bodyRows.length === 0) return ''

  const captionSource = normalizeLatexBooktabsInlineText(extractLatexCaptionSource(normalized))
  const captionHtml = captionSource ? renderLatexBooktabsCellHtml(captionSource) : ''
  const renderRows = (rows: LatexBooktabsRow[], tagName: 'th' | 'td') => rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const colspanAttr = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''
      return `<${tagName}${colspanAttr} class="latex-booktabs-align-${cell.align}">${cell.html}</${tagName}>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  return `<div class="message-latex-booktabs-preview"><table class="latex-booktabs-table">${captionHtml ? `<caption class="latex-booktabs-caption">${captionHtml}</caption>` : ''}${headerRows.length > 0 ? `<thead>${renderRows(headerRows, 'th')}</thead>` : ''}${bodyRows.length > 0 ? `<tbody>${renderRows(bodyRows, 'td')}</tbody>` : ''}</table></div>`
}

function buildMarkdownPreviewBlock(source: string, hintedLang?: string | null): string {
  const previewHtml = compileRichText(source) || '<p class="message-markdown-empty">空 Markdown 文档</p>'
  const sourceHtml = renderCodeBlock(source, hintedLang || 'markdown')

  return `<div class="message-markdown-shell"><div class="message-markdown-header"><span class="message-markdown-badge">Markdown 预览</span><span class="message-markdown-meta">检测到 Markdown 文档，已按富文本渲染</span></div><div class="message-markdown-preview">${previewHtml}</div><details class="message-markdown-source"><summary>查看源码</summary>${sourceHtml}</details></div>`
}

function buildLatexPreviewBlock(source: string, hintedLang?: string | null): string {
  const booktabsPreviewHtml = buildLatexBooktabsPreviewHtml(source)
  if (booktabsPreviewHtml) {
    const sourceHtml = renderCodeBlock(source, hintedLang || 'latex')
    return `<div class="message-latex-shell"><div class="message-latex-header"><span class="message-latex-badge">LaTeX 预览</span><span class="message-latex-meta">已兼容渲染三线表，可展开查看源码</span></div><div class="message-latex-preview">${booktabsPreviewHtml}</div><details class="message-latex-source"><summary>查看源码</summary>${sourceHtml}</details></div>`
  }

  const previewSource = buildLatexPreviewSource(source)
  const compiledPreviewHtml = compileRichText(previewSource)
  const previewHtml = hasRenderedLatexPreview(compiledPreviewHtml)
    ? compiledPreviewHtml
    : (buildDirectLatexPreviewHtml(source) || compiledPreviewHtml || '<p class="message-latex-empty">未检测到可预览的公式内容。</p>')
  const sourceHtml = renderCodeBlock(source, hintedLang || 'latex')

  return `<div class="message-latex-shell"><div class="message-latex-header"><span class="message-latex-badge">LaTeX 预览</span><span class="message-latex-meta">源码已保留，可展开复制</span></div><div class="message-latex-preview">${previewHtml}</div><details class="message-latex-source"><summary>查看源码</summary>${sourceHtml}</details></div>`
}

function detectCodeLanguage(code: string, hintedLang?: string | null): string {
  const normalizedHint = normalizeLanguageLabel(hintedLang)
  if (normalizedHint && normalizedHint !== 'text' && getHighlightLanguage(normalizedHint)) {
    return normalizedHint
  }

  const trimmed = code.trim()

  if (!trimmed) {
    return 'text'
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // 不是合法 JSON 时继续走启发式检测
    }
  }

  if (/<(!DOCTYPE html|html|head|body|div|span|p|a|img|main|section|article|script|style)/i.test(code)) {
    return 'html'
  }

  if (/[.#][\w-]+\s*\{[^}]*\}/.test(code) || /@(media|keyframes|import|layer|supports)/.test(code)) {
    return 'css'
  }

  if (looksLikeLatexSource(code, hintedLang)) {
    return 'latex'
  }

  if (/^(def |class |import |from |if __name__|print\()/m.test(code)) {
    return 'python'
  }

  if (/\b(function|const|let|var|=>|async|await|class|interface|type|export|import)\b/.test(code)) {
    if (/:\s*(string|number|boolean|any|void|unknown|never)\b|\binterface\b|\btype\b/.test(code)) {
      return 'typescript'
    }
    return 'javascript'
  }

  if (/\b(public |private |protected |class |interface |extends |implements |package |import java\.)/m.test(code)) {
    return 'java'
  }

  if (/#include\s*<|using namespace |std::|cout|cin|vector</.test(code)) {
    return 'cpp'
  }

  if (/#include\s*<stdio\.h>|#include\s*<stdlib\.h>|int main\(|printf\(|scanf\(/.test(code)) {
    return 'c'
  }

  if (/\b(using System;|namespace |public static void Main|Console\.WriteLine)/m.test(code)) {
    return 'csharp'
  }

  if (/^package |func |import \(|fmt\.Print/m.test(code)) {
    return 'go'
  }

  if (/\b(fn |let mut |impl |use |pub |struct |enum |match )\b/.test(code)) {
    return 'rust'
  }

  if (/^<\?php|\$[a-zA-Z_]|->|::|echo |function /.test(code)) {
    return 'php'
  }

  if (/\b(def |end\b|class |module |puts |require )\b/.test(code)) {
    return 'ruby'
  }

  if (/^#!\/bin\/(bash|sh)|^\s*(if |for |while |case |function |echo |export |cd |ls |grep )/m.test(code)) {
    return 'bash'
  }

  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|TABLE)\b/i.test(code)) {
    return 'sql'
  }

  if (/^[\w-]+:\s*$|^ {2}[\w-]+:\s/m.test(code) && !/[{}[\]]/.test(code)) {
    return 'yaml'
  }

  if (/^#{1,6}\s|^\*\*|^- |^\d+\. |^\[.+\]\(.+\)/m.test(code)) {
    return 'markdown'
  }

  return 'text'
}

function highlightCode(code: string, detectedLang: string): string {
  const highlightLanguage = getHighlightLanguage(detectedLang)
  if (!highlightLanguage) {
    return escapeHtml(code)
  }

  try {
    return hljs.highlight(code, { language: highlightLanguage, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(code)
  }
}

function renderNumberedCodeLines(code: string, detectedLang: string, highlightedLines?: Set<number> | null): string {
  const normalizedCode = code.replace(/\r\n?/g, '\n')
  const lines = normalizedCode.split('\n')
  const totalLines = Math.max(1, lines.length)
  const gutterWidth = String(totalLines).length

  return (lines.length > 0 ? lines : ['']).map((line, index) => {
    const lineNum = index + 1
    const lineHtml = line.length > 0 ? highlightCode(line, detectedLang) : '&#8203;'
    const highlighted = highlightedLines?.has(lineNum) ? ' message-code-line-highlighted' : ''
    return [
      `<span class="message-code-line${highlighted}">`,
      `<span class="message-code-line-number">${escapeHtml(String(lineNum).padStart(gutterWidth, ' '))}</span>`,
      `<span class="message-code-line-text">${lineHtml}</span>`,
      '</span>',
    ].join('')
  }).join('')
}

function buildRenderedCodeClass(detectedLang: string): string {
  const classes = ['message-code-block', 'hljs']
  if (detectedLang !== 'text') {
    classes.push(`language-${escapeHtml(detectedLang)}`)
  }
  return classes.join(' ')
}

function renderCodeBlock(code: string, hintedLang?: string | null, highlightedLines?: Set<number> | null): string {
  const detectedLang = detectCodeLanguage(code, hintedLang)
  const numberedLines = renderNumberedCodeLines(code, detectedLang, highlightedLines)
  return `<pre><code class="${buildRenderedCodeClass(detectedLang)}">${numberedLines}</code></pre>`
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  typographer: true,
})

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => {
  return self.renderToken(tokens, idx, options)
})

const defaultImageRenderer = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => {
  return self.renderToken(tokens, idx, options)
})

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  return defaultImageRenderer(tokens, idx, options, env, self)
}

md.renderer.rules.fence = (tokens, idx, _options, env) => {
  const token = tokens[idx]
  const infoString = token.info.trim()
  const hintedLang = normalizeLanguageLabel(infoString.split(/\s+/)[0])
  const highlightedLines = parseLineHighlights(infoString)
  if (hintedLang === 'markdown') {
    const targetEnv = env as MarkdownRenderEnv
    const segments = targetEnv.deferredHtmlSegments ?? []
    const index = segments.length
    segments.push({
      placeholder: createDeferredHtmlPlaceholder(index),
      html: buildMarkdownPreviewBlock(token.content, hintedLang),
    })
    targetEnv.deferredHtmlSegments = segments
    return createDeferredHtmlPlaceholder(index)
  }

  if (looksLikeLatexSource(token.content, hintedLang)) {
    const targetEnv = env as MarkdownRenderEnv
    const segments = targetEnv.deferredHtmlSegments ?? []
    const index = segments.length
    segments.push({
      placeholder: createDeferredHtmlPlaceholder(index),
      html: buildLatexPreviewBlock(token.content, hintedLang),
    })
    targetEnv.deferredHtmlSegments = segments
    return createDeferredHtmlPlaceholder(index)
  }

  const fenceRenderer = findFenceRenderer(hintedLang, token.content)
  if (fenceRenderer) {
    const targetEnv = env as MarkdownRenderEnv
    const segments = targetEnv.deferredHtmlSegments ?? []
    const index = segments.length
    const result = fenceRenderer.buildPreviewBlock({
      source: token.content,
      lang: hintedLang,
      highlightedLines,
      renderCodeBlock,
      escapeHtml,
    })
    segments.push({ placeholder: createDeferredHtmlPlaceholder(index), html: result.html })
    targetEnv.deferredHtmlSegments = segments
    return createDeferredHtmlPlaceholder(index)
  }

  return renderCodeBlock(token.content, hintedLang, highlightedLines)
}

md.renderer.rules.code_block = (tokens, idx) => {
  const token = tokens[idx]
  return renderCodeBlock(token.content)
}

function hashTextContent(text: string): string {
  let h1 = 0xdeadbeef ^ text.length
  let h2 = 0x41c6ce57 ^ text.length

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`
}

function generateCacheKey(text: string): string {
  // renderRichText 目前走同步渲染链路，这里使用同步的全文哈希指纹作为缓存键：
  // 1. 整段文本都会参与计算，避免仅按首尾片段命中缓存；
  // 2. key 长度固定，避免直接把超长原文作为 Map key。
  return `md:${text.length}:${hashTextContent(text)}`
}

function protectCodeSegments(text: string): { text: string; segments: ProtectedSegment[] } {
  const segments: ProtectedSegment[] = []

  const storeSegment = (value: string) => {
    const placeholder = `\uE000IRIS_CODE_${segments.length}\uE001`
    segments.push({ placeholder, value })
    return placeholder
  }

  let result = text.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (match, leadingNewline: string) => {
    const block = match.slice(leadingNewline.length)
    return `${leadingNewline}${storeSegment(block)}`
  })

  result = result.replace(/`[^`\n]+`/g, (match) => storeSegment(match))

  return { text: result, segments }
}

function restoreProtectedSegments(text: string, segments: ProtectedSegment[]): string {
  let result = text
  for (const segment of segments) {
    result = result.split(segment.placeholder).join(segment.value)
  }
  return result
}

function extractLatexFormulas(text: string): { text: string; formulas: LatexFormula[] } {
  const formulas: LatexFormula[] = []
  let result = text

  result = result.replace(LATEX_BLOCK_ENV_PATTERN, (_match, environment: string, formula: string) => {
    const index = formulas.length
    formulas.push({
      formula: `\\begin{${environment}}${formula.trim()}\\end{${environment}}`,
      display: true,
      placeholderType: 'block',
    })
    return createLatexPlaceholder(index, 'block')
  })

  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_match, formula: string) => {
    const index = formulas.length
    formulas.push({ formula: formula.trim(), display: true, placeholderType: 'block' })
    return createLatexPlaceholder(index, 'block')
  })

  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula: string) => {
    const index = formulas.length
    formulas.push({ formula: formula.trim(), display: true, placeholderType: 'block' })
    return createLatexPlaceholder(index, 'block')
  })

  result = result.replace(/\\\(([\s\S]+?)\\\)/g, (_match, formula: string) => {
    const index = formulas.length
    formulas.push({ formula: formula.trim(), display: false, placeholderType: 'inline' })
    return createLatexPlaceholder(index, 'inline')
  })

  result = result.replace(/(^|[\s(])\$([^$\n]+?)\$(?=[\s.,;:!?)'"\]]|$)/gm, (match, prefix: string, formula: string) => {
    if (!/[a-zA-Z\\{}^_=+\-*/<>]/.test(formula)) {
      return match
    }

    const index = formulas.length
    formulas.push({ formula: formula.trim(), display: false, placeholderType: 'inline' })
    return `${prefix}${createLatexPlaceholder(index, 'inline')}`
  })

  return { text: result, formulas }
}

function restoreLatexFormulas(html: string, formulas: LatexFormula[]): string {
  let result = html

  for (let index = 0; index < formulas.length; index += 1) {
    const item = formulas[index]
    const placeholderPattern = createLatexPlaceholderPattern(index)

    try {
      const rendered = katex.renderToString(sanitizeLatexFormula(item.formula), {
        displayMode: item.display,
        throwOnError: false,
        output: 'html',
        trust: false,
        strict: 'warn',
      })

      const wrapper = item.placeholderType === 'block'
        ? `<div class="message-katex-block">${rendered}</div>`
        : `<span class="message-katex-inline">${rendered}</span>`

      result = result.replace(placeholderPattern, wrapper)
    } catch (error) {
      const fallback = item.display ? `$$${item.formula}$$` : `$${item.formula}$`
      const errorMessage = error instanceof Error ? error.message : '公式渲染失败'
      result = result.replace(
        placeholderPattern,
        `<code class="latex-error" title="${escapeHtml(errorMessage)}">${escapeHtml(fallback)}</code>`,
      )
    }
  }

  return result
}

function detectCodeLabel(code: HTMLElement | null): string {
  const className = code?.className ?? ''
  const match = className.match(/language-([\w-]+)/)
  const normalized = normalizeLanguageLabel(match?.[1])
  return LANGUAGE_LABELS[normalized] ?? (normalized !== 'text' ? normalized.toUpperCase() : '代码片段')
}

function normalizeRenderedCodeBlock(code: HTMLElement | null) {
  if (!code) return

  const className = code.className
  const match = className.match(/language-([\w-]+)/)
  const hintedLang = normalizeLanguageLabel(match?.[1])

  if (code.classList.contains('message-code-block')) {
    code.className = buildRenderedCodeClass(hintedLang)
    return
  }

  const rawCode = code.textContent?.replace(/\r\n?/g, '\n') ?? ''
  const detectedLang = detectCodeLanguage(rawCode, hintedLang)

  code.className = buildRenderedCodeClass(detectedLang)
  code.innerHTML = renderNumberedCodeLines(rawCode, detectedLang)
}

function decorateCodeBlocks(root: ParentNode) {
  const blocks = Array.from(root.querySelectorAll('pre'))
  for (const pre of blocks) {
    if (pre.parentElement?.classList.contains('message-code-shell')) continue

    let code = pre.querySelector('code')
    if (!code) {
      code = document.createElement('code')
      code.className = buildRenderedCodeClass('text')
      code.innerHTML = renderNumberedCodeLines(pre.textContent ?? '', 'text')
      pre.textContent = ''
      pre.appendChild(code)
    } else {
      normalizeRenderedCodeBlock(code)
    }

    const shell = document.createElement('div')
    shell.className = 'message-code-shell'

    const toolbar = document.createElement('div')
    toolbar.className = 'message-code-toolbar'

    const label = document.createElement('span')
    label.className = 'message-code-label'
    label.textContent = detectCodeLabel(code)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'message-code-copy'
    button.textContent = '复制代码'
    button.setAttribute('aria-label', '复制代码')

    toolbar.append(label, button)
    pre.parentNode?.insertBefore(shell, pre)
    shell.append(toolbar, pre)
  }
}

function decorateTables(root: ParentNode) {
  const tables = Array.from(root.querySelectorAll('table'))
  for (const table of tables) {
    if (table.parentElement?.classList.contains('message-table-scroll')) continue

    const shell = document.createElement('div')
    shell.className = 'message-table-shell'

    const scroll = document.createElement('div')
    scroll.className = 'message-table-scroll'

    table.parentNode?.insertBefore(shell, table)
    shell.appendChild(scroll)
    scroll.appendChild(table)
  }
}

function decorateAnchors(root: ParentNode) {
  root.querySelectorAll<HTMLAnchorElement>('a').forEach((anchor) => {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
}

function decorateImages(root: ParentNode) {
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
  })
}

function decorateRenderedHtml(html: string): string {
  if (typeof document === 'undefined') return html

  const template = document.createElement('template')
  template.innerHTML = html

  decorateCodeBlocks(template.content)
  decorateTables(template.content)
  decorateAnchors(template.content)
  decorateImages(template.content)

  return template.innerHTML
}

function decorateAnchorsAndImages(html: string): string {
  if (typeof document === 'undefined') return html

  const template = document.createElement('template')
  template.innerHTML = html

  decorateAnchors(template.content)
  decorateImages(template.content)

  return template.innerHTML
}

function compileInlineRichText(text: string): string {
  const protectedCode = protectCodeSegments(text)
  const extractedLatex = extractLatexFormulas(protectedCode.text)
  const normalizedEmphasisText = normalizeAmbiguousInlineEmphasisSyntax(extractedLatex.text)
  const markdownSource = restoreProtectedSegments(normalizedEmphasisText, protectedCode.segments)
  const env: MarkdownRenderEnv = { deferredHtmlSegments: [] }

  let html = md.renderInline(markdownSource, env)
  html = DOMPurify.sanitize(html, DOMPURIFY_CONFIG) as string

  if (extractedLatex.formulas.length > 0) {
    html = restoreLatexFormulas(html, extractedLatex.formulas)
  }
  if (env.deferredHtmlSegments && env.deferredHtmlSegments.length > 0) {
    html = restoreDeferredHtmlSegments(html, env.deferredHtmlSegments)
  }

  return decorateAnchorsAndImages(html)
}

export function renderPlainText(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>')
}

function compileRichText(text: string): string {
  if (looksLikeStandaloneHtmlDocument(text)) {
    let html = renderCodeBlock(text, 'html')
    html = DOMPurify.sanitize(html, DOMPURIFY_CONFIG) as string
    return decorateRenderedHtml(html)
  }

  const normalizedText = shouldNormalizeLatexDocument(text) ? normalizeLatexDocumentText(text) : text
  const protectedCode = protectCodeSegments(normalizedText)
  const extractedLatex = extractLatexFormulas(protectedCode.text)
  const normalizedEmphasisText = normalizeAmbiguousInlineEmphasisSyntax(extractedLatex.text)
  const markdownSource = restoreProtectedSegments(normalizedEmphasisText, protectedCode.segments)
  const env: MarkdownRenderEnv = { deferredHtmlSegments: [] }

  let html = md.render(markdownSource, env)
  html = DOMPurify.sanitize(html, DOMPURIFY_CONFIG) as string

  if (extractedLatex.formulas.length > 0) {
    html = restoreLatexFormulas(html, extractedLatex.formulas)
  }

  if (env.deferredHtmlSegments && env.deferredHtmlSegments.length > 0) {
    html = restoreDeferredHtmlSegments(html, env.deferredHtmlSegments)
  }

  return decorateRenderedHtml(html)
}

export function renderRichText(text: string): string {
  if (!text) return ''

  const cacheKey = generateCacheKey(text)
  const cached = richTextCache.get(cacheKey)
  if (cached !== null) {
    return cached
  }

  try {
    const html = compileRichText(text)
    richTextCache.set(cacheKey, html)
    return html
  } catch (error) {
    console.error('富文本渲染失败:', error)
    return renderCodeBlock(text)
  }
}

/** 兼容旧调用名 */
export const renderMarkdown = renderRichText

export function clearRichTextCache() {
  richTextCache.clear()
}
