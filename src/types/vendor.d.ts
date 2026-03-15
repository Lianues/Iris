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
