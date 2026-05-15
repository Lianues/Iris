# Iris v1.0.25 Release Notes

* 合并 dev 分支的新功能与修复
* 新增 Auto Edit 自动编辑能力，支持安全结构化文件编辑自动应用
* 新增 DeepSeek Provider 与模型配置体验优化
* 新增 F6 应用内复制模式，并支持输入框 Ctrl+C 智能清空
* 新增文本输入 Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做
* 统一 diff 预览由后端生成，改善 remote/session cwd 场景下的 diff 展示
* 修复 Web milestone 进度服务集成，确保 Web 端进度读取和实时更新走 milestone extension service
* 保留并完善 milestone / variables 扩展化架构
* 新增 /callme git attribution 开关
* 新增 config / mcp / models / cron CLI 能力与相关测试
* 优化 shell 命令记忆规则、Plan Mode 提示词和扩展启停生命周期
