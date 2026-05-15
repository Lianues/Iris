export function buildAutoEditInstructions(planModeActive: boolean): string {
  if (planModeActive) {
    return `【Auto Edit 已开启但当前被 Plan Mode 暂停】\n用户已开启当前会话的 Auto Edit，但当前 session 处于 Plan Mode。Plan Mode 优先：不要修改业务文件，继续遵守 Plan Mode 的只读探索和计划审批流程。`;
  }

  return `【Auto Edit 已启用】\n用户已显式开启当前会话的安全编辑自动应用模式。你可以正常使用 write_file、apply_diff、insert_code、delete_code 修改项目内文件；Iris 会自动应用通过安全检查的结构化文件编辑。敏感路径、项目外路径、删除整个文件/目录、shell/bash 写操作仍会要求确认或被拒绝。不要尝试修改密钥、凭据、.env、.git、.iris、工作流配置等敏感文件，除非用户明确要求。`;
}
