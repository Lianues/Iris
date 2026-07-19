# Iris v1.0.41 Release Notes

## TUI 设置体验
- 重构模型列表拉取与选择浮层，支持搜索、取消加载、长模型名称截断及当前模型定位
- 修复设置页底部栏高度、宽度和快捷键提示计算，避免说明、状态和快捷键相互覆盖或被终端边缘裁切
- 根据当前行和编辑状态动态显示可用快捷键，模型 ID 行可直接使用 `F` 拉取 Provider 模型列表

## Prompt Cache 配置
- 在 TUI 设置中加入 Prompt Cache 开关，并按模型独立写回配置
- Claude 使用关闭、自动断点、显式断点三态策略，自动与手动断点保持互斥
- OpenAI Compatible 与 Responses 渠道为 GPT-5.6+ 支持新的缓存参数、30 分钟 TTL 和稳定 cache key
- Provider 或模型切换时重新判定缓存能力，保留兼容设置并清理不适用字段

## IDE 启动
- 修复同时安装 VS Code 与 Cursor 时 `/ide` 错误优先启动 Cursor 的问题
- 加强 Windows、macOS 与 Linux 上的 VS Code 命令识别、候选排序和安装提示
- 新增 IDE 默认命令与 VS Code 安装器的回归测试

## 稳定性与测试
- 覆盖 Claude 缓存模式、GPT-5.6+ Chat Completions/Responses 缓存、Provider 切换和设置持久化边界
- 覆盖模型选择器布局、底部栏显示和多 IDE 共存场景
