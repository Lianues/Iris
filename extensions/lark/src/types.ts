export interface LarkConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  showToolStatus?: boolean;
}

export type LarkScope = 'dm' | 'group';
export type LarkReceiveIdType = 'open_id' | 'chat_id';

export interface LarkSessionTarget {
  sessionId: string;
  chatKey: string;
  scope: LarkScope;
  chatId: string;
  userOpenId?: string;
  threadId?: string;
  receiveId: string;
  receiveIdType: LarkReceiveIdType;
}

export interface LarkResourceRef {
  type: 'image' | 'file' | 'audio';
  fileKey: string;
  fileName?: string;
  duration?: number;
}

export interface ParsedLarkMessage {
  session: LarkSessionTarget;
  text: string;
  messageId: string;
  chatId: string;
  threadId?: string;
  senderOpenId: string;
  messageType: string;
  mentioned: boolean;
  resources: LarkResourceRef[];
}

export interface LarkProbeResult {
  ok: boolean;
  appId?: string;
  botOpenId?: string;
  botName?: string;
  error?: string;
}

export interface LarkSendResult {
  messageId: string;
  chatId: string;
}

export interface LarkTextMessageOptions {
  text: string;
  target: Pick<LarkSessionTarget, 'receiveId' | 'receiveIdType'>;
}

export interface LarkReplyTextOptions {
  messageId: string;
  text: string;
  replyInThread?: boolean;
}

export interface LarkWebSocketStartOptions {
  handlers: Record<string, (data: unknown) => Promise<void> | void>;
  abortSignal?: AbortSignal;
  autoProbe?: boolean;
}

export interface LarkMessageEvent {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
  message: {
    message_id: string;
    create_time?: string;
    root_id?: string;
    parent_id?: string;
    thread_id?: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      name: string;
      id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
    }>;
  };
}

export function buildLarkSessionTarget(params: {
  chatId: string;
  chatType: 'p2p' | 'group';
  userOpenId?: string;
  threadId?: string;
}): LarkSessionTarget {
  if (params.chatType === 'p2p') {
    const userOpenId = String(params.userOpenId ?? '').trim();
    if (!userOpenId) {
      throw new Error('构造飞书私聊会话失败：缺少 userOpenId。');
    }
    return {
      sessionId: `lark-dm-${userOpenId}`,
      chatKey: `dm:${userOpenId}`,
      scope: 'dm',
      chatId: params.chatId,
      userOpenId,
      receiveId: userOpenId,
      receiveIdType: 'open_id',
    };
  }

  const threadId = normalizeOptionalString(params.threadId);
  const baseSessionId = `lark-group-${params.chatId}`;
  return {
    sessionId: threadId ? `${baseSessionId}-thread-${threadId}` : baseSessionId,
    chatKey: threadId ? `group:${params.chatId}:thread:${threadId}` : `group:${params.chatId}`,
    scope: 'group',
    chatId: params.chatId,
    threadId,
    receiveId: params.chatId,
    receiveIdType: 'chat_id',
  };
}

export function parseLarkSessionTarget(sessionId: string): LarkSessionTarget {
  const dmMatch = sessionId.match(/^lark-dm-(.+)$/);
  if (dmMatch) {
    const userOpenId = dmMatch[1];
    return {
      sessionId,
      chatKey: `dm:${userOpenId}`,
      scope: 'dm',
      chatId: userOpenId,
      userOpenId,
      receiveId: userOpenId,
      receiveIdType: 'open_id',
    };
  }

  const groupMatch = sessionId.match(/^lark-group-(.+?)(?:-thread-(.+))?$/);
  if (groupMatch) {
    const chatId = groupMatch[1];
    const threadId = normalizeOptionalString(groupMatch[2]);
    return {
      sessionId,
      chatKey: threadId ? `group:${chatId}:thread:${threadId}` : `group:${chatId}`,
      scope: 'group',
      chatId,
      threadId,
      receiveId: chatId,
      receiveIdType: 'chat_id',
    };
  }

  throw new Error(`无法解析飞书 sessionId: ${sessionId}`);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

export interface LarkDownloadedResource {
  buffer: Buffer;
  contentType?: string;
  fileName?: string;
}

export interface LarkUploadImageResult {
  imageKey: string;
}

export interface LarkUploadFileResult {
  fileKey: string;
}

export interface LarkSendMediaOptions {
  target: Pick<LarkSessionTarget, 'receiveId' | 'receiveIdType'>;
  replyToMessageId?: string;
  replyInThread?: boolean;
}

export interface ImageInputLike {
  mimeType: string;
  data: string;
}

export interface DocumentInputLike {
  fileName: string;
  mimeType: string;
  data: string;
}

export interface IrisModelInfoLike {
  current?: boolean;
  modelName: string;
  modelId: string;
}

export interface IrisSessionMetaLike {
  id: string;
  title?: string;
  updatedAt?: string | number | Date;
}

export interface IrisToolInvocationLike {
  id: string;
  toolName: string;
  status: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export interface IrisBackendLike {
  on(event: string, listener: (...args: any[]) => void): this;
  chat(sessionId: string, text: string, images?: ImageInputLike[], documents?: DocumentInputLike[], platform?: string): Promise<unknown>;
  isStreamEnabled(): boolean;
  approveTool?(id: string, approved: boolean): void;
  clearSession?(sessionId: string): Promise<void>;
  switchModel?(modelName: string, platform?: string): { modelName: string; modelId: string };
  listModels?(): IrisModelInfoLike[];
  listSessionMetas?(): Promise<IrisSessionMetaLike[]>;
  abortChat?(sessionId: string): void;
  undo?(sessionId: string, scope: string): Promise<{ assistantText?: string } | null>;
  redo?(sessionId: string): Promise<{ assistantText?: string } | null>;
}

export interface IrisPlatformFactoryContextLike {
  backend: IrisBackendLike;
  config?: {
    platform?: {
      lark?: Partial<LarkConfig>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
