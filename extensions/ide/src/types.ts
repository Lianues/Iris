import type { Disposable } from 'irises-extension-sdk';
import type { ToolDiffPreviewResponseLike } from 'irises-extension-sdk/plugin';

export type IdeTransport = 'sse' | 'ws';
export type IdeConnectionState = 'disconnected' | 'detecting' | 'connecting' | 'connected' | 'error';

export interface IdeContextConfig {
  enabled: boolean;
  maxSelectedChars: number;
  includeOpenedFile: boolean;
}

export interface IdeCompatibilityConfig {
  claudeCodeLockfiles: boolean;
}

export interface IdeConfig {
  enabled: boolean;
  autoConnect: boolean;
  lockDir?: string;
  context: IdeContextConfig;
  compatibility: IdeCompatibilityConfig;
}

export interface IdeLockfileContent {
  workspaceFolders?: string[];
  pid?: number;
  ideName?: string;
  transport?: IdeTransport;
  runningInWindows?: boolean;
  authToken?: string;
}

export interface DetectedIde {
  id: string;
  name: string;
  port: number;
  url: string;
  transport: IdeTransport;
  workspaceFolders: string[];
  isValid: boolean;
  lockfilePath: string;
  pid?: number;
  authToken?: string;
  runningInWindows?: boolean;
}

export interface IdeSelection {
  filePath?: string;
  text?: string;
  lineStart?: number;
  lineEnd?: number;
  lineCount: number;
}

export interface IdeAtMentioned {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface IdeStatusSnapshot {
  state: IdeConnectionState;
  current?: DetectedIde;
  detected: DetectedIde[];
  selection?: IdeSelection;
  openedFile?: string;
  error?: string;
}

export interface IdeManagerService {
  detect(): Promise<DetectedIde[]>;
  list(): DetectedIde[];
  current(): DetectedIde | undefined;
  status(): IdeStatusSnapshot;
  connect(target?: string): Promise<DetectedIde>;
  disconnect(): Promise<void>;
  callRpc(method: string, params?: Record<string, unknown>): Promise<unknown>;
  openDiffPreview(preview: ToolDiffPreviewResponseLike, index?: number): Promise<boolean>;
  getSelection(): IdeSelection | undefined;
  getOpenedFile(): string | undefined;
  getContextText(): string | undefined;
  onDidChange(listener: () => void): Disposable;
  onAtMentioned(listener: (payload: IdeAtMentioned) => void): Disposable;
}

export const IDE_MANAGER_SERVICE_ID = 'ide.manager';
