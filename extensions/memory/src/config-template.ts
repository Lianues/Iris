export const DEFAULT_CONFIG_TEMPLATE = `# 记忆插件配置
#
# 启用后，LLM 可通过 memory_search / memory_add / memory_update / memory_delete 工具
# 读写长期记忆，实现跨会话的信息持久化。
#
# 存储后端：SQLite + FTS5 全文检索
# 数据库文件默认存放在数据目录下的 memory.db

# 是否启用记忆
enabled: false

# 数据库路径（相对于数据目录，或绝对路径）
# dbPath: ./memory.db

# ── 自动提取（对话结束后自动从对话中提取值得记住的信息）──
autoExtract: true
# 每 N 轮对话后提取一次
extractInterval: 1

# ── 智能检索（每轮对话前自动注入相关记忆到上下文）──
autoRecall: true
# 每轮注入记忆的最大大小（KB）
maxContextBytes: 20480
# 会话级记忆注入总上限（KB）
sessionBudgetBytes: 61440

# ── 跨会话归纳（定期整理合并冗余记忆）──
consolidation:
  enabled: true
  # 两次归纳之间的最小间隔（小时）
  minHours: 24
  # 触发归纳的最少新会话数
  minSessions: 3
`;
