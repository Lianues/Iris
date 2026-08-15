# Iris v1.0.43 Release Notes

## Skill 体系增强
- 新增 Claude Code Skill 适配层，提升对 Claude Code 风格 Skill 的兼容能力
- 新增 Skill 细粒度权限控制（skill-permissions），支持按 Skill 独立授权
- 引入 Skill 参数暂存（staging）与内容展开（content expansion）机制，`invoke_skill`、`execute_skill_script` 等内置工具全面重构
- 覆盖 Claude Code 兼容、Skill 斜杠命令直连、上下文修饰与参数解析回归测试

## LLM 工具调用协议与容错
- 新增 Tagged JSON 工具协议适配，OpenAI Compatible 渠道可稳定解析标签化工具调用
- 新增工具意图防护（tool intent guard），拦截并纠偏模型输出中的伪工具调用意图
- 增强原生工具调用容错恢复：流式截断、参数 JSON 损坏等异常自动重试，协议错误可回喂模型
- Backend 在 tagged/native 协议下检测到仅返回工具计划时自动注入纠偏并丢弃伪完成文本

## Backend 队列与工具权限
- 优化 Backend 消息队列化调度，多消息并发场景下顺序与中止语义更稳定
- 工具后台执行权限管控增强：sub_agent 继承完整工具配置、可见工具与父级求交集，禁止用全局配置放大未授权写权限
- bash/shell 命令模式记忆与安全校验统一，remote-exec wrapper 安全性加强
- RequestLogger 支持运行时动态重载，日志配置变更无需重启

## Console TUI 与扩展 SDK
- 新增剪贴板附件支持，可直接粘贴图片/文件作为多模态输入
- 新增排队消息交接（queued message handoff），忙碌回合中的新消息自动顺延
- 优化进度列表、设置视图、底部面板与键盘交互体验
- Extension SDK 暴露更多工具注册、平台交互与消息 API

## 稳定性与测试
- 完整测试套件通过：156 个测试文件、1304 个测试
