/**
 * config-template.ts
 *
 * 两个默认配置文件：
 *   1. remote_exec.yaml          —— 主配置（启用 / 默认服务器 / switch 工具开关）
 *   2. remote_exec_servers.yaml  —— 服务器清单（YAML，走 Extension SDK 配置接口）
 */

export const DEFAULT_REMOTE_EXEC_YAML = `# remote-exec 配置
#
# 让 AI 像在远端机器上原生运行本项目一样使用工具：
# AI 调用 list_files / read_file / write_file / shell ... 时，
# 后台自动翻译成等价的远端操作，并把结果整理回工具原有的 JSON 形态。
# AI 全程无感。
#
# 目标服务器写在同目录下的 remote_exec_servers.yaml 中。

# 是否启用本扩展（false 时所有工具静默走本地）
enabled: false

# 默认活动服务器（启动时使用）：
#   local        本机执行（不走 SSH）
#   <服务器别名> 对应 remote_exec_servers.yaml 中 servers.<别名>
defaultEnvironment: local

# 是否向 AI 暴露 switch_server 工具，让 AI 自主切换服务器
# 关闭后只能由配置文件手动指定 defaultEnvironment
exposeSwitchTool: true

# 远端工作目录（cwd）：所有翻译后的命令默认在此目录下执行。
# 留空则使用登录用户的 home。可在 servers 配置里按服务器单独覆写。
remoteWorkdir: ~

ssh:
  reuseConnection: true
  connectTimeoutMs: 10000
  keepAliveSec: 30
  commandTimeoutMs: 0
  # 远端进程退出后，等待 stdout/stderr 排空的最长时间（毫秒）
  # 解决 nohup/& 启动后台进程时 SSH channel 不自然关闭、工具调用挂起的问题
  # 默认 200，正常命令几乎无感；设为 0 会退化为旧行为，不推荐
  postExitDrainMs: 200
`;

export const DEFAULT_REMOTE_EXEC_SERVERS_YAML = `# remote-exec 服务器清单
#
# 推荐 YAML 格式，走 Iris Extension SDK 配置接口：
#   - 插件首次启动会通过 ctx.ensureConfigFile() 释放本文件
#   - 插件读取时通过 ctx.readConfigSection('remote_exec_servers')
#   - 修改后支持配置热重载
#
# servers 是一个 map：key 是服务器名/别名，value 是 SSH 连接信息。
# AI 会通过 switch_server 工具看到这些服务器名。
#
# 字段：
#   hostName      实际主机名 / IP（必填）
#   port          SSH 端口（默认 22）
#   user          登录用户名
#   identityFile  私钥文件绝对路径
#   password      明文密码（与 identityFile 二选一；建议优先用密钥）
#   workdir       该服务器上的默认工作目录（覆盖 remote_exec.yaml 的 remoteWorkdir）
#   os            服务器操作系统（AI 可见，用于选择正确命令语法）: linux / windows / macos
#   description   AI 可见的服务器描述（switch_server 工具会展示）
#   transport     auto（默认）/ sftp / bash
#                 auto = 文件精确操作优先 SFTP，扫描/搜索/shell 走 bash
#                 sftp = 文件精确操作强制 SFTP（失败时报错）
#                 bash = 强制纯 bash，适配无 SFTP 的极简环境

servers:
  # cqa1:
  #   hostName: connect.cqa1.seetacloud.com
  #   port: 32768
  #   user: root
  #   identityFile: C:\\Users\\Lianues\\.ssh\\id_rsa
  #   workdir: /root/projects/myapp
  #   os: linux
  #   transport: auto
  #   description: GPU 训练机（A100 x 2）

  # nginx-prod:
  #   hostName: 203.0.113.1
  #   user: root
  #   identityFile: C:\\Users\\Lianues\\.ssh\\id_rsa_nginx_server
  #   workdir: /etc/nginx
  #   os: linux
  #   description: 生产环境 Nginx 节点

  # quick-pwd:
  #   hostName: 203.0.113.1
  #   user: lianuesss
  #   password: your_password_here
  #   transport: auto
  #   os: linux
  #   description: 临时账号（密码登录）
`;


