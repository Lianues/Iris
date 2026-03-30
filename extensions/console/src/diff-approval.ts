import type { ToolInvocation } from '@irises/extension-sdk';

const CONSOLE_DIFF_APPROVAL_VIEW_TOOLS = new Set([
  'apply_diff',
  'write_file',
  'insert_code',
  'delete_code',
  'search_in_files',
]);

export function supportsConsoleDiffApprovalViewSetting(toolName: string): boolean {
  return CONSOLE_DIFF_APPROVAL_VIEW_TOOLS.has(toolName);
}

export function shouldUseConsoleDiffApprovalView(
  invocation: Pick<ToolInvocation, 'toolName' | 'args'> | null | undefined,
  showApprovalView?: boolean,
): boolean {
  if (!invocation || showApprovalView === false) return false;
  if (!supportsConsoleDiffApprovalViewSetting(invocation.toolName)) return false;
  if (invocation.toolName === 'search_in_files') {
    return ((invocation.args.mode as string | undefined) ?? 'search') === 'replace';
  }
  return true;
}

export function getConsoleDiffApprovalViewDescription(toolName: string): string {
  switch (toolName) {
    case 'search_in_files':
      return '空格切换。仅在 replace 模式需要手动确认时生效。';
    case 'insert_code':
      return '空格切换。insert_code 需要手动确认时，打开 diff 审批页。';
    case 'delete_code':
      return '空格切换。delete_code 需要手动确认时，打开 diff 审批页。';
    case 'write_file':
      return '空格切换。write_file 需要手动确认时，打开 diff 审批页。';
    case 'apply_diff':
      return '空格切换。apply_diff 需要手动确认时，打开 diff 审批页。';
    default:
      return '空格切换。需要手动确认时，打开 diff 审批页。';
  }
}
