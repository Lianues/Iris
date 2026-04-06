# Agent 配置覆盖目录

此目录下的文件会覆盖全局配置（~/.iris/configs/）中的同名文件。
留空表示完全继承全局配置。

可覆盖的文件：
- `system.yaml` — 系统提示词、工具轮次等个性化参数
- `tools.yaml` — 工具权限配置
- `summary.yaml` — 上下文压缩提示词
- `mcp.yaml` — MCP 服务器配置
- `modes.yaml` — 自定义模式
- `sub_agents.yaml` — 子代理配置

以下文件属于全局独占，不应放在此目录下：
- `llm.yaml`
- `ocr.yaml`
- `storage.yaml`
