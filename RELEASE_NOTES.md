# Iris v1.0.40 Release Notes

## Compact 与 Token 统计
- 修复 TUI `/compact` 的 token 统计语义：`summaryTokens` 仅表示摘要消息自身，`afterTokens` 表示 compact 后完整、净化的主模型请求上下文
- 新增最终 LLM 请求净化边界，`diffPreview`、`durationMs`、usage 等本地 UI/持久化元数据不再进入主模型请求或 preflight token 估算
- 保留真实 `functionResponse.response`、多模态结果以及完整的 `functionCall` / `functionResponse` 配对；巨大真实工具结果仍会正常触发 compact
- 修复巨大本地 `diffPreview` 误触发 `in-turn-threshold` compact 的问题

## Summary 输出预算
- 新增 `summary.maxOutputTokens`，默认值为 `16384`
- 已知总结模型 `contextWindow` 时，summary 输出硬上限自动收紧到窗口的 20%
- 模型静态 `requestBody` 可进一步收紧上限，但不能抬高 compact 专用 ceiling
- 流式、非流式、分块摘要和合并摘要统一使用单次请求级输出限制，并附加约 75% 的软长度目标

## Console 与 Session 恢复
- 摘要卡片显示摘要自身 token，状态栏 `ctx` 显示 compact 后完整请求 token
- 新增 `compactedContextTokenCount` 持久化字段，session 重载后可恢复正确的上下文统计
- summary 后若已有模型回复，优先恢复最新 Provider usage；旧 transcript 会按当前 system prompt、工具声明和有效历史重建估算
- 完成本地 Backend、远程 IPC Backend 与多 Agent IPC 路由兼容

## 稳定性与测试
- 加强连续 compact、overflow recovery、notification turn、undo/redo/rewind 及 token cache 失效语义
- 新增 fresh 巨大 `diffPreview`、真实大工具结果、summary 输出 ceiling、Console usage 隔离、session 重载和 IPC 回归测试
- 完整测试套件通过：126 个测试文件、1111 个测试
