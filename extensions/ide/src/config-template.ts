export const DEFAULT_IDE_CONFIG_TEMPLATE = `# Iris IDE 集成配置
#
# MVP 说明：
# - Iris 会扫描 <IRIS_DATA_DIR>/ide/*.lock（默认 ~/.iris/ide/*.lock）来发现 IDE 插件会话。
# - 可通过 /ide install 安装 Iris VS Code 扩展；扩展激活后会写入该 lockfile。
# - 如果设置了自定义 IRIS_DATA_DIR，请同步配置 VS Code 的 irisIde.dataDir 设置。
# - compatibility.claudeCodeLockfiles 仅用于本地实验，会额外扫描 ~/.claude/ide/*.lock；不建议作为长期协议。

enabled: true

# 启动时如果只发现一个匹配当前 cwd 的 IDE，是否自动连接。
autoConnect: false

# 可选：覆盖 lockfile 目录。相对路径会基于 Iris dataDir 解析。
# lockDir: ide

context:
  # 每轮 LLM 调用时把 IDE 当前选区/当前文件作为 system context 注入。
  enabled: true
  # 选区文本最大注入字符数，超出会截断。
  maxSelectedChars: 12000
  # 没有选区时，是否注入当前打开文件路径（不会读取整文件）。
  includeOpenedFile: true

compatibility:
  # 实验性兼容 Claude Code 插件 lockfile 目录 ~/.claude/ide。
  claudeCodeLockfiles: false
`;
