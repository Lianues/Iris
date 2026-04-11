# Iris v1.0.3 Release Notes

> 自 v1.0.2 以来共 225 个提交

## 🏗️ 架构

* **扩展系统大迁移**：Console、Telegram、Web、Memory、QQ、Discord、微信、企业微信、飞书、Computer Use 全部从内置模块迁移为独立扩展（extension），实现完全解耦
* **Extension SDK**：提取 `irises-extension-sdk` 共享包，统一类型定义、工具函数与插件 API，消除宿主与扩展间 500+ 行重复代码
* **IPC 进程间通信**：新增 IrisHost / IrisCore 架构，支持 `attach` 跨进程模式连接远程实例
* **多端互联 (Net)**：直连 / 中继传输层 + TUI 远程连接 + 局域网自动发现 + 设置界面
* **ServiceRegistry & ConfigContributionRegistry**：插件可注册服务和向 Settings 注入自定义配置 Tab

## ✨ 新特性

* **定时任务 (Cron)**：新增定时任务调度插件，支持后台 ToolLoop 执行、条件表达式触发、按任务配置工具策略、自定义提示词/轮次
* **流式工具执行**：LLM 输出过程中提前启动工具执行（Streaming Tool Executor），工具参数类型容错 + Schema 校验兜底
* **异步子代理**：后台任务执行 + 前端可观测性（StatusBar braille 动画 / 通知汇总 / token 计数）；子工具嵌套显示在父工具内部
* **Shell 安全分类器**：AI 驱动的命令安全分类器 + 自动学习机制；审批增加 Tab 策略页（始终允许 / 始终询问）
* **Bash 工具**：新增 `bash` 工具支持 Linux / macOS，与 `shell`(PowerShell) 实现全面跨平台适配
* **GlobalStore**：跨插件共享键值存储 + 持久化；新增 `manage_variables` 工具供 AI 读写
* **跨 Agent 委派**：`delegate_to_agent` 工具 + CrossAgentTaskBoard 任务板 + 多 Agent 共享 MCPManager
* **Memory 重构**：记忆系统重构（召回可靠性改进、user 无条件注入、泛化提示词）+ `/memory` TUI 列表视图
* **invoke_skill 工具**：支持参数替换、上下文修改和 fork 执行模式
* **日志增强**：AsyncLocalStorage 驱动的 Agent 上下文标识；流式/非流式请求错误均记录到日志

## 📱 平台

* **Discord 增强**：typing 指示器 + 流式编辑 + 对码门禁 + 身份标识 + 文件发送工具；斜杠命令 `/new` `/compact` `/model`；支持图片消息输入 + 回复 Bot 消息触发对话
* **Computer Use**：`get_screenshot` 添加 `save_path` 可选参数；Playwright 未安装时自动安装 + 友好错误提示
* **Telegram**：定时任务通知按聊天定向投递，不再广播所有聊天

## 🖥️ Console / TUI

* **工具详情页 (Ctrl+T)**：查看历史与实时工具执行记录，支持列表 → 详情两级视图
* **Agent 列表视图**：Agent 切换重构为列表选择视图
* **扩展管理 (/extension)**：TUI 命令实现扩展管理 + 运行时热重载
* **Settings 增强**：全局审批开关、日志/深度/模式/异步子代理等配置项；插件可注入自定义 Tab
* **思考强度指示器**：显示 thinking 强度 + shell 工具名青色高亮
* **Sub-agent 实时状态**：执行时显示子工具摘要 / LLM 文本预览
* **Unicode 兼容**：修复 cmd / PowerShell 下字符畸变与 CJK 重叠

## 🔧 工具 / API 变更

* `write_file`、`insert_code`、`delete_code` 从数组参数改为单文件参数（Breaking Change）
* Sub-agent 支持全局与单类型的 `enabled` / `stream` 配置
* 工具执行统一为 ToolExecutionHandle 双向通道方案
* Console 平台新增 `expandSubAgentTools` 配置项

## 🐳 Docker

* 全面修复 Docker 构建与运行时问题（共 7 个修复提交）：Dockerfile 构建失败、entrypoint 平台配置冲突、共享宿主机配置目录、computer-use 镜像 Playwright 安装与用户兼容

## 🐛 Bug 修复

* 修复 Gemini 3 工具调用二次请求失败（callId/id 映射 + 空 text part 过滤）
* 修复流式工具调用提前输出时机，使 StreamingToolExecutor 真正生效
* 修复连续串行工具调用时前面的工具被后面覆盖的显示问题
* 修复异步子代理工具结果显示在 thinking 上方的问题
* 修复 undo/redo 在 notification turn 期间的并发写入保护
* 修复 MCP 工具在 Gemini 上 400 的问题（删除 `$schema` 字段）
* 修复 Windows 平台 `bun install` EPERM 时自动回退 npm
* 修复多 Agent 模式下 console 平台 stdin 重复监听
* 修复 LayeredConfigManager 分层重构后 settings UI 数据断裂
* 修复重试成功后 GeneratingTimer 持续显示 retrying
* 修复其他小Bug等等
