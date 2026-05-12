# Agent 配置覆盖目录

> 模板/运行时路径说明：仓库/安装包中的 `data/agents.example/` 只作为首次初始化模板。默认会复制到 `~/.iris/agents/`；除非用户设置了 `IRIS_DATA_DIR`，此时会复制到 `IRIS_DATA_DIR/agents/`。之后 Iris 实际读取和写入的是用户运行时目录中的 Agent 配置；请在用户目录中修改配置。

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
