# Iris v1.0.28 Release Notes

* Console：移除 Auto Edit 的 `Ctrl+E` 快捷键及相关提示，减少与终端/输入区快捷键的冲突。
* Apply Diff / Console：为 `apply_diff` 的 hunk header 增加显式标记，并优化紧凑 diff 预览的布局、换行与截断显示。
* Apply Diff：工具结果中暴露修正后的 hunk header 与 fallback 信息，便于定位补丁实际应用位置，并覆盖 remote-exec 场景。
* Build：扩展构建前自动同步本地 `extension-sdk`，减少 `file:` 依赖未更新导致的扩展构建问题。
* Console：恢复“立即发送”行为；生成中使用 `Ctrl+S` 会中断当前回复，并立即优先发送新输入。
* 格式适配层：移除 Claude、OpenAI Compatible、OpenAI Responses 中针对尾部 reminder 文本的兼容处理，简化 `tool result` / `function_call_output` 编码逻辑。
* MCP：内嵌扩展改为打包 `@modelcontextprotocol/sdk`，降低安装版 / 编译版在运行时解析 external 依赖失败的概率。
* 发行包：缩减内嵌扩展白名单，精简默认随包分发的扩展集合。
* Milestone：为重载会话增加归档兜底修复；当 `afterHistoryIndex` 过早或完成态快照只存在于工具响应历史中时，会自动恢复到正确的回合末尾，避免里程碑面板重载后错位。
