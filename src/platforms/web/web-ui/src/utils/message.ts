import type { Message } from '../api/types'

export function hasToolParts(msg: Message): boolean {
  return msg.parts.some(p => p.type === 'function_call' || p.type === 'function_response')
}
