# Iris v1.0.20 Release Notes

* **build**：修复内嵌扩展（cron / remote-connect / remote-exec 等）启动时报 `extension "xxx" 缺少运行时依赖` 的问题。`script/build.ts` 现在会清理目标 `package.json` 中所有不在 `embedded.json` `external` 列表中的依赖声明，避免与 bundle 后的 dist/index.mjs 不一致。
* **remote-exec**：服务器配置新增 `os` 字段，`switch_environment` 工具描述会展示该环境的操作系统（如 `OS=linux`），帮助 AI 选择正确的命令语法。
* **ci**：拆分 `build:compile` 命令到独立步骤，避免 `&&` 链中参数透传丢失；修复 `tsx` 直接调用问题，统一改用 `npx tsx`；发布脚本新增详细日志便于排查产物问题。
