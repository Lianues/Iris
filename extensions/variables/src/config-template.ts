export const DEFAULT_CONFIG_TEMPLATE = `# 变量管理扩展配置
#
# 启用后，LLM 可通过 manage_variables 工具读写全局/Agent/会话变量。
# 变量存储复用 Iris extension SDK 的 globalStore，数据会自动持久化。
#
# 默认关闭：关闭时不会注册 manage_variables 工具，也不会暴露给模型。

# 是否启用全局变量功能
# true  = 注册 manage_variables 工具
# false = 不注册工具
enabled: false
`;
