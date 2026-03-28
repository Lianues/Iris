import { createExtensionLogger } from '@irises/extension-sdk';
import {
  buildLarkSessionTarget,
  type LarkMessageEvent,
  type LarkResourceRef,
  type ParsedLarkMessage,
} from './types';

const logger = createExtensionLogger('LarkExtension', 'LarkMessageHandler');

interface LarkMessageEnvelope {
  event?: LarkMessageEvent;
}

export class LarkMessageHandler {
  constructor(private botOpenId?: string) {}

  setBotOpenId(botOpenId: string | undefined): void {
    this.botOpenId = botOpenId;
  }

  parseIncomingMessage(payload: unknown): ParsedLarkMessage | null {
    const event = unwrapLarkMessageEvent(payload);
    if (!event?.message) return null;

    const senderOpenId = String(event.sender?.sender_id?.open_id ?? '').trim();
    if (senderOpenId && this.botOpenId && senderOpenId === this.botOpenId) {
      logger.debug('忽略飞书机器人自身发送的消息');
      return null;
    }

    const extracted = extractLarkMessageContent(event.message);
    if (!extracted.text && extracted.resources.length === 0) return null;

    const mentioned = isBotMentioned(event, this.botOpenId);
    return {
      session: buildLarkSessionTarget({
        chatId: event.message.chat_id,
        chatType: event.message.chat_type,
        userOpenId: senderOpenId,
        threadId: event.message.thread_id,
      }),
      text: stripLarkBotMention(extracted.text),
      messageId: event.message.message_id,
      chatId: event.message.chat_id,
      threadId: event.message.thread_id,
      senderOpenId,
      messageType: event.message.message_type,
      mentioned,
      resources: extracted.resources,
    };
  }
}

export function unwrapLarkMessageEvent(payload: unknown): LarkMessageEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const envelope = payload as LarkMessageEnvelope;
  const event = envelope.event ?? payload;
  if (!event || typeof event !== 'object') return null;
  return event as LarkMessageEvent;
}

export function extractLarkMessageContent(message: {
  message_type?: string;
  content?: string;
}): { text: string; resources: LarkResourceRef[] } {
  const type = String(message.message_type ?? '').trim();
  const content = safeJsonParse(message.content);
  if (!content) return { text: '', resources: [] };

  if (type === 'text') {
    return { text: normalizeLarkText(content.text), resources: [] };
  }

  if (type === 'post') {
    return extractLarkPostContent(content);
  }

  if (type === 'image') {
    return extractLarkImageContent(content);
  }

  if (type === 'file') {
    return extractLarkFileContent(content);
  }

  if (type === 'audio') {
    return extractLarkAudioContent(content);
  }

  return { text: '', resources: [] };
}

export function extractLarkText(message: {
  message_type?: string;
  content?: string;
}): string {
  return extractLarkMessageContent(message).text;
}

export function stripLarkBotMention(text: string): string {
  return text
    .replace(/<at\s+user_id="[^"]+">[^<]*<\/at>/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isBotMentioned(event: LarkMessageEvent, botOpenId?: string): boolean {
  if (!botOpenId) return false;
  return (event.message.mentions ?? []).some((mention) => mention.id?.open_id === botOpenId);
}

function normalizeLarkText(text: unknown): string {
  return stripLarkBotMention(String(text ?? '').trim());
}

function extractLarkPostContent(content: any): { text: string; resources: LarkResourceRef[] } {
  const languageBlocks = Object.values(content ?? {}).filter((value) => value && typeof value === 'object');
  const paragraphs: string[] = [];
  const resources: LarkResourceRef[] = [];

  for (const block of languageBlocks) {
    const rows = Array.isArray((block as any).content) ? (block as any).content : [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const line = row
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          if ((item as any).tag === 'img' && (item as any).image_key) {
            resources.push({ type: 'image', fileKey: String((item as any).image_key) });
            return `![image](${String((item as any).image_key)})`;
          }
          if ((item as any).tag === 'media' && (item as any).file_key) {
            resources.push({ type: 'file', fileKey: String((item as any).file_key) });
            return `<file key="${String((item as any).file_key)}"/>`;
          }
          return String((item as any).text ?? (item as any).tag ?? '').trim();
        })
        .filter(Boolean)
        .join(' ')
        .trim();

      if (line) paragraphs.push(line);
    }
  }

  return {
    text: stripLarkBotMention(paragraphs.join('\n').trim()),
    resources,
  };
}

function extractLarkImageContent(content: any): { text: string; resources: LarkResourceRef[] } {
  const imageKey = String(content.image_key ?? '').trim();
  if (!imageKey) {
    return { text: '[image]', resources: [] };
  }
  return {
    text: `![image](${imageKey})`,
    resources: [{ type: 'image', fileKey: imageKey }],
  };
}

function extractLarkFileContent(content: any): { text: string; resources: LarkResourceRef[] } {
  const fileKey = String(content.file_key ?? '').trim();
  const fileName = String(content.file_name ?? '').trim() || undefined;
  if (!fileKey) {
    return { text: '[file]', resources: [] };
  }
  return {
    text: fileName ? `<file key="${fileKey}" name="${fileName}"/>` : `<file key="${fileKey}"/>`,
    resources: [{ type: 'file', fileKey, fileName }],
  };
}

function extractLarkAudioContent(content: any): { text: string; resources: LarkResourceRef[] } {
  const fileKey = String(content.file_key ?? '').trim();
  const duration = typeof content.duration === 'number' ? content.duration : undefined;
  if (!fileKey) {
    return { text: '[audio]', resources: [] };
  }

  const durationText = duration != null ? ` duration="${formatAudioDuration(duration)}"` : '';
  return {
    text: `<audio key="${fileKey}"${durationText}/>`,
    resources: [{ type: 'audio', fileKey, duration }],
  };
}

function formatAudioDuration(duration: number): string {
  const totalSeconds = Math.max(0, Math.floor(duration / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function safeJsonParse(content: string | undefined): Record<string, any> | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, any>;
  } catch {
    return null;
  }
}
