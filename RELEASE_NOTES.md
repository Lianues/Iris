# Iris v1.0.42 Release Notes

## Windows TUI 启动修复
- 修复通过 npm 全局安装后，Console 扩展在 Bun 1.3.11 编译产物中无法解析 `@opentui/core`、导致 TUI 启动失败的问题
- 锁定 Console、根项目及扩展锁文件中的 OpenTUI/React 运行时版本，避免发布构建被浮动依赖升级破坏

## 发布校验
- 构建阶段拒绝 Console 等扩展使用 `*` 或 `latest` 作为 external 运行时依赖版本
- 新增仓库外临时目录中的编译 Bun 加载检查，验证每项依赖确实来自扩展自己的 `node_modules`
- 新校验会阻止仓库根依赖向上回退掩盖发布包缺失或不兼容依赖
