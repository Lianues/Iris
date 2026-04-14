# Iris v1.0.11 Release Notes
* 插件扩展自动发现：所有 plugin 类型的 extension 现在与 platform 一样自动发现注册，无需在 plugins.yaml 中手动声明
* plugins.yaml 变为可选覆盖配置，仅在需要禁用插件、调整优先级或传递 config 时使用
* 扩展管理面板拆分为「下载平台」「下载插件」「管理平台」「管理插件」四个分类入口
* 修复自动发现模式下扩展状态判定逻辑，未在 plugins.yaml 中声明的插件默认视为启用
* 新增 sillytavern 扩展（SillyTavern 提示词引擎）到扩展索引
