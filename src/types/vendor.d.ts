/**
 * 第三方库的类型声明补充
 */

declare module 'marked' {
  export interface MarkedStatic {
    lexer(markdown: string): unknown[];
  }

  export const marked: MarkedStatic;
}

declare module 'cli-highlight' {
  export interface HighlightOptions {
    language?: string;
    ignoreIllegals?: boolean;
  }

  export function highlight(code: string, options?: HighlightOptions): string;
}

declare module '@larksuiteoapi/node-sdk' {
  export const AppType: { SelfBuild: unknown };
  export const LoggerLevel: { info: unknown };

  export class Client {
    constructor(options: Record<string, unknown>);
    request(args: { method: string; url: string; data?: unknown }): Promise<any>;
    im: {
      message: {
        patch(args: {
          path: Record<string, unknown>;
          data: Record<string, unknown>;
        }): Promise<any>;
        create(args: {
          params?: Record<string, unknown>;
          data: Record<string, unknown>;
        }): Promise<any>;
        reply(args: {
          path: Record<string, unknown>;
          data: Record<string, unknown>;
        }): Promise<any>;
      };
    };
  }

  export class EventDispatcher {
    constructor(options: Record<string, unknown>);
    register(handlers: Record<string, (data: unknown) => Promise<void> | void>): void;
  }

  export class WSClient {
    constructor(options: Record<string, unknown>);
    start(args: { eventDispatcher: EventDispatcher }): Promise<void> | void;
    close(args?: { force?: boolean }): void;
  }
}
