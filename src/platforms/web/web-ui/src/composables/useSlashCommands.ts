/**
 * 斜杠命令注册与执行
 *
 * 提供命令匹配、自动补全列表和命令执行逻辑。
 */

import type { Ref } from 'vue'
import type { ChatDocumentAttachment, ChatImageAttachment, Message } from '../api/types'
import { useSessions } from './useSessions'
import * as api from '../api/client'

export interface SlashCommand {
  name: string
  description: string
  usage: string
  hasArg: boolean
}

const commands: SlashCommand[] = [
  { name: '/new', description: '创建新会话', usage: '/new', hasArg: false },
  { name: '/undo', description: '撤销上一条消息', usage: '/undo', hasArg: false },
  { name: '/redo', description: '重做上一条撤销', usage: '/redo', hasArg: false },
  { name: '/model', description: '切换模型', usage: '/model <name>', hasArg: true },
  { name: '/sh', description: '执行 shell 命令', usage: '/sh <command>', hasArg: true },
]

/** 返回匹配给定前缀的命令列表 */
function matchingCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return []
  const lower = input.toLowerCase().split(/\s/)[0]
  return commands.filter(cmd => cmd.name.startsWith(lower))
}

/** 判断是否为斜杠命令 */
function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/')
}

interface CommandContext {
  sendMessage: (text: string, images?: ChatImageAttachment[], documents?: ChatDocumentAttachment[]) => void
  undoLastMessage: () => Promise<void>
  redoLastMessage: () => Promise<void>
  currentSessionId: Ref<string | null>
  messages: Ref<Message[]>
}

async function executeCommand(text: string, ctx: CommandContext) {
  const trimmed = text.trim()
  const spaceIndex = trimmed.indexOf(' ')
  const cmd = spaceIndex === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIndex).toLowerCase()
  const arg = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim()

  const { newChat } = useSessions()

  switch (cmd) {
    case '/new':
      newChat()
      break

    case '/undo':
      await ctx.undoLastMessage()
      break

    case '/redo':
      await ctx.redoLastMessage()
      break

    case '/model':
      if (!arg) {
        ctx.messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: '用法: /model <模型名称>' }],
        })
        return
      }
      try {
        const info = await api.switchModel(arg)
        ctx.messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: `模型已切换为: ${info.modelName ?? info.modelId}` }],
        })
      } catch (err) {
        ctx.messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: `切换模型失败: ${err instanceof Error ? err.message : String(err)}` }],
        })
      }
      break

    case '/sh':
      if (!arg) {
        ctx.messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: '用法: /sh <命令>' }],
        })
        return
      }
      try {
        const result = await api.runShellCommand(arg)
        ctx.messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: `\`\`\`\n$ ${arg}\n${result.output}\n\`\`\`\ncwd: ${result.cwd}` }],
        })
      } catch (err) {
        ctx.messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: `命令执行失败: ${err instanceof Error ? err.message : String(err)}` }],
        })
      }
      break

    default:
      ctx.messages.value.push({
        role: 'model',
        parts: [{ type: 'text', text: `未知命令: ${cmd}` }],
      })
  }
}

export function useSlashCommands() {
  return {
    commands,
    matchingCommands,
    isSlashCommand,
    executeCommand,
  }
}
