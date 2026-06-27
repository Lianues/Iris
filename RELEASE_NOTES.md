# Iris v1.0.38 Release Notes

## Telegram
- 增强 Rich Message 渲染，支持折叠 trace、官方流式输出（sendRichMessageDraft）与失败自动回退纯文本
- 支持回合执行期间 typing 状态刷新
- 支持 Rich trace 工具执行摘要展示
- undo 消息追踪从单 message id 扩展为消息组，支持长文本分片和 fallback 分片后的正确撤销
- 新增 outputFormat / streamMode 配置项

## Console
- 将立即发送快捷键从 Ctrl+S 改为 Ctrl+Enter
- 添加 Ctrl+↓ 快捷键回到查看栏最底部
- Settings 模型 ID 字段支持从 provider API 拉取可用模型列表
- 修复 Gemini thinking levels 大小写问题

## IDE
- 修复安装 Cursor 后 /ide 误启动 Cursor 的问题

## Core
- 加固 Skill resource 访问安全
