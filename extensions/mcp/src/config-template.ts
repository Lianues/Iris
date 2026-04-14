/**
 * MCP 默认配置模板
 *
 * 通过 ctx.ensureConfigFile('mcp.yaml', ...) 在首次运行时释放到用户配置目录。
 * 文件已存在时不覆盖。
 */

export const DEFAULT_MCP_CONFIG_TEMPLATE = `# MCP 服务器配置
# 连接外部 MCP 服务器，自动将其工具注入 LLM 工具列表
# 启动时后台异步连接，不阻塞启动
#
# 每个服务器支持以下字段：
#   transport  - 传输方式: stdio | sse | streamable-http
#   enabled    - 是否启用（默认 true）
#   timeout    - 连接/listTools 超时，单位 ms（默认 30000）
#
# stdio 模式专用：
#   command    - 要执行的命令
#   args       - 命令参数数组
#   env        - 额外环境变量
#   cwd        - 工作目录
#
# sse / streamable-http 模式专用：
#   url        - MCP 服务器 URL
#   headers    - 自定义 HTTP 请求头

# servers:
#   # stdio 传输示例（本地进程）
#   filesystem:
#     transport: stdio
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
#     timeout: 30000
#     enabled: true
#
#   # HTTP 传输示例（远程服务器）
#   remote_tools:
#     transport: streamable-http
#     url: https://mcp.example.com/mcp
#     headers:
#       Authorization: Bearer your-token
#     timeout: 30000
#
#   # 企微官方文档 MCP（智能表格 + 文档 CRUD，8 个工具）
#   # 在企微管理后台创建智能机器人后，MCP 端点页面可获取 apikey
#   wecom-doc:
#     transport: streamable-http
#     url: "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=your-mcp-apikey"
`;
