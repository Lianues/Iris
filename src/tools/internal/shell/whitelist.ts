/**
 * Shell 命令白名单 —— Windows 平台 (PowerShell)
 *
 * 四层分类：
 *   1. DENY_PATTERNS  —— 绝对禁止的危险模式（正则匹配）
 *   2. SAFE_COMMANDS   —— 静态只读/安全命令白名单（涵盖 PowerShell cmdlets + 常用开发工具）
 *   3. RUNTIME_SAFE_COMMANDS —— 运行时动态白名单（安装依赖后 LLM 评估自动添加）
 *   4. 其余 → 'unknown'，交由 AI 分类器判定
 */

import type { CommandSafetyConfig, StaticClassification } from './types';

// ============ 第一层：绝对禁止 ============

/**
 * 无论任何上下文都拒绝执行的危险模式。
 * 匹配到就立即返回 deny，不进后续判定。
 */
const DENY_PATTERNS: RegExp[] = [
  // ---- 系统破坏 ----
  /\bformat\b.*\b[a-zA-Z]:/i,                     // format C:
  /\b(shutdown|restart-computer|stop-computer)\b/i,// 系统关机/重启

  // ---- 下载执行组合（远程代码执行） ----
  /\bcurl\b.*\|\s*(ba)?sh\b/i,                     // curl | bash
  /\bwget\b.*\|\s*(ba)?sh\b/i,                     // wget | bash
  /Invoke-WebRequest\b.*\|.*Invoke-Expression\b/i, // iwr | iex
  /\biwr\b.*\|.*\biex\b/i,                         // 别名形式
  /\b(certutil|bitsadmin)\b.*(-urlcache|-download)/i, // Windows 特有下载器

  // ---- 动态代码执行 ----
  /\bInvoke-Expression\b/i,                        // iex（等同 eval）
  /\biex\b/i,                                      // iex 别名
  /\beval\b/i,                                     // eval

  // ---- 注册表高危操作 ----
  /\bRemove-Item\b.*\bHKLM:/i,                     // 删除注册表机器根键
  /\breg\s+delete\b.*\bHKLM/i,                     // reg delete HKLM

  // ---- 危险删除 ----
  /\bRemove-Item\b.*-Recurse.*-Force.*[\\\/]\s*$/i, // Remove-Item -Recurse -Force \
  /\brd\s+\/s\s+\/q\s+[a-zA-Z]:\\/i,              // rd /s /q C:\
  /\bdel\s+\/[fFsS].*[a-zA-Z]:\\\**/i,            // del /f C:\*

  // ---- 进程注入/提权 ----
  /Start-Process\b.*-Verb\s+RunAs/i,               // UAC 提权
  /\bInvoke-WmiMethod\b.*Win32_Process.*Create/i,  // WMI 进程创建
];

// ============ 第二层：安全白名单 ============

/**
 * 安全命令白名单。
 * key 统一小写，匹配时对第一个 token 做 toLowerCase()。
 *
 * 涵盖范围：
 *   - Windows 原生命令（cmd.exe 内建 + system32）
 *   - PowerShell 内建 cmdlets
 *   - 常用开发工具的只读子命令
 */
const SAFE_COMMANDS: Record<string, CommandSafetyConfig> = {
  // =========================================================================
  // Windows 原生命令（cmd.exe 内建 + system32）
  // =========================================================================
  'dir': { safe: true },
  'type': { safe: true },
  'more': { safe: true },
  'find': { safe: true },         // Windows find（文本搜索，不是 POSIX find）
  'findstr': { safe: true },
  'where': { safe: true },
  'where.exe': { safe: true },
  'echo': { safe: true },
  'set': {
    // set 无参数或 set VAR 只是显示；set VAR=value 修改环境变量
    isDangerous: (args) => args.some(a => a.includes('=')),
  },
  'ver': { safe: true },
  'date': { safe: true },         // 不带 /T 也只是显示
  'time': { safe: true },
  'hostname': {
    isDangerous: (args) => args.some(a => /^[\/\-]s/i.test(a)),  // hostname /S 修改主机名
  },
  'whoami': { safe: true },
  'systeminfo': { safe: true },
  'tasklist': { safe: true },
  'netstat': { safe: true },
  'ipconfig': {
    isDangerous: (args) => args.some(a => /^\/(release|renew|flushdns|registerdns)/i.test(a)),
  },
  'ping': { safe: true },
  'tracert': { safe: true },
  'nslookup': { safe: true },
  'getmac': { safe: true },
  'route': {
    isDangerous: (args) => {
      const verb = args.find(a => /^(add|delete|change)$/i.test(a));
      return !!verb;
    },
  },
  'tree': { safe: true },
  'fc': { safe: true },           // 文件比较
  'comp': { safe: true },         // 文件比较
  'sort': { safe: true },
  'clip': { safe: true },         // 复制到剪贴板（只读管道末端）
  'certutil': {
    // certutil -hashfile 安全；-urlcache 已在 deny 里
    safeSubcommands: ['-hashfile', '-dump', '-verify', '-store'],
  },
  'arp': {
    // arp -a/-g 查看 ARP 表安全；arp -s/-d 修改条目危险
    isDangerous: (args) => args.some(a => /^[\-\/][sd]/i.test(a)),
  },
  'pathping': { safe: true },      // 路由追踪 + 丢包统计
  'nbtstat': { safe: true },       // NetBIOS 统计
  'wmic': {
    // wmic 只读查询安全；call/create/delete 危险
    safeSubcommands: [
      'os get', 'cpu get', 'memorychip get', 'diskdrive get',
      'logicaldisk get', 'nic get', 'process list', 'service list',
      'bios get', 'baseboard get', 'computersystem get',
      'qfe list',  // 已安装补丁
    ],
  },
  'sc': {
    // sc query/queryex 只读；sc config/start/stop/delete 危险
    safeSubcommands: ['query', 'queryex', 'qc', 'qdescription', 'qfailure', 'sdshow'],
  },
  'reg': {
    // reg query 只读；reg add/delete/import/export 危险（delete HKLM 已在 deny 里）
    safeSubcommands: ['query'],
  },
  'assoc': { safe: true },         // 显示文件关联
  'ftype': { safe: true },         // 显示文件类型关联
  'chcp': { safe: true },          // 显示/设置代码页（无参数时只读）
  'title': { safe: true },         // 设置窗口标题（无害）
  'color': { safe: true },         // 设置控制台颜色（无害）
  'mode': { safe: true },          // 显示设备状态
  'vol': { safe: true },           // 显示卷标
  'label': {
    // label 无参数时显示卷标（安全）；有参数时修改卷标（危险）
    isDangerous: (args) => args.length > 0 && !args.every(a => a.startsWith('/')),
  },
  'driverquery': { safe: true },   // 列出已安装驱动
  'openfiles': {
    safeSubcommands: ['/query'],
  },
  'schtasks': {
    // schtasks /query 只读；/create /delete /change /run /end 危险
    safeSubcommands: ['/query'],
  },
  'powercfg': {
    // powercfg /list /query /requests /energy /batteryreport 只读
    safeSubcommands: ['/list', '/l', '/query', '/q', '/requests', '/energy', '/batteryreport', '/systempowerreport', '/availablesleepstates', '/a'],
  },

  // =========================================================================
  // PowerShell Cmdlets —— 文件系统（只读）
  // =========================================================================
  'get-childitem': { safe: true },
  'get-content': { safe: true },
  'get-item': { safe: true },
  'get-itemproperty': { safe: true },
  'get-itempropertyvalue': { safe: true },
  'test-path': { safe: true },
  'resolve-path': { safe: true },
  'convert-path': { safe: true },
  'split-path': { safe: true },
  'join-path': { safe: true },
  'get-filehash': { safe: true },
  'get-acl': { safe: true },
  'format-hex': { safe: true },
  'get-clipboard': { safe: true },  // 读取剪贴板内容

  // =========================================================================
  // PowerShell Cmdlets —— 导航
  // =========================================================================
  'set-location': { safe: true },
  'push-location': { safe: true },
  'pop-location': { safe: true },
  'get-location': { safe: true },

  // =========================================================================
  // PowerShell Cmdlets —— 搜索/过滤
  // =========================================================================
  'select-string': { safe: true },
  'compare-object': { safe: true },

  // =========================================================================
  // PowerShell Cmdlets —— 数据转换（纯函数，无副作用）
  // =========================================================================
  'convertto-json': { safe: true },
  'convertfrom-json': { safe: true },
  'convertto-csv': { safe: true },
  'convertfrom-csv': { safe: true },
  'convertto-xml': { safe: true },
  'convertto-html': { safe: true },
  'convertfrom-stringdata': { safe: true },
  'convertfrom-securestring': { safe: true },

  // =========================================================================
  // PowerShell Cmdlets —— 系统信息
  // =========================================================================
  'get-process': { safe: true },
  'get-service': { safe: true },
  'get-command': { safe: true },
  'get-module': { safe: true },
  'get-help': { safe: true },
  'get-alias': { safe: true },
  'get-history': { safe: true },
  'get-host': { safe: true },
  'get-computerinfo': { safe: true },
  'get-date': { safe: true },
  'get-culture': { safe: true },
  'get-timezone': { safe: true },
  'get-uptime': { safe: true },
  'get-variable': { safe: true },
  'get-psdrive': { safe: true },
  'get-psprovider': { safe: true },
  'get-hotfix': { safe: true },
  'get-random': { safe: true },
  'get-unique': { safe: true },
  'get-member': { safe: true },
  'get-error': { safe: true },       // 查看最近错误详情（PS 7+）
  'get-typedata': { safe: true },
  'get-formatdata': { safe: true },
  'get-tracesource': { safe: true },
  'get-verb': { safe: true },        // 列出 PS 标准动词
  'get-psreadlineoption': { safe: true },
  'get-executionpolicy': { safe: true },
  'get-cimclass': { safe: true },    // CIM 类元数据查询
  'get-ciminstance': { safe: true }, // CIM 实例查询（只读 WMI 查询）
  'get-counter': { safe: true },     // 性能计数器

  // =========================================================================
  // PowerShell Cmdlets —— 网络信息（只读）
  // =========================================================================
  'get-netadapter': { safe: true },
  'get-netipaddress': { safe: true },
  'get-netipconfiguration': { safe: true },
  'get-netroute': { safe: true },
  'get-dnsclient': { safe: true },
  'get-dnsclientcache': { safe: true },

  // PowerShell Cmdlets —— 防火墙/网络安全（只读）
  'get-netfirewallrule': { safe: true },
  'get-netfirewallprofile': { safe: true },

  // =========================================================================
  // PowerShell Cmdlets —— 事件日志（只读）
  // =========================================================================
  'get-eventlog': { safe: true },
  'get-winevent': { safe: true },

  // =========================================================================
  // PowerShell Cmdlets —— 管道处理（安全的过滤/格式化）
  // =========================================================================
  'select-object': { safe: true },
  'sort-object': { safe: true },
  'group-object': { safe: true },
  'where-object': { safe: true },
  'foreach-object': { safe: true },
  'measure-object': { safe: true },
  'format-table': { safe: true },
  'format-list': { safe: true },
  'format-wide': { safe: true },
  'format-custom': { safe: true },
  'out-string': { safe: true },
  'out-host': { safe: true },
  'write-output': { safe: true },
  'write-host': { safe: true },
  'join-string': { safe: true },
  'start-sleep': { safe: true },
  'tee-object': { safe: true },      // 管道分流（输出到管道 + 变量/文件，但作为管道中间件本身安全）
  'out-null': { safe: true },        // 丢弃输出
  'out-default': { safe: true },
  'write-verbose': { safe: true },
  'write-warning': { safe: true },
  'write-debug': { safe: true },

  // =========================================================================
  // PowerShell 别名 → 同义映射
  // =========================================================================
  'ls': { safe: true },           // → Get-ChildItem
  'cat': { safe: true },          // → Get-Content
  'gc': { safe: true },           // → Get-Content
  'gci': { safe: true },          // → Get-ChildItem
  'gi': { safe: true },           // → Get-Item
  'sl': { safe: true },           // → Set-Location
  'cd': { safe: true },           // → Set-Location
  'pwd': { safe: true },          // → Get-Location
  'gl': { safe: true },           // → Get-Location
  'ps': { safe: true },           // → Get-Process
  'gps': { safe: true },          // → Get-Process
  'gsv': { safe: true },          // → Get-Service
  'gcm': { safe: true },          // → Get-Command
  'gv': { safe: true },           // → Get-Variable
  'sls': { safe: true },          // → Select-String
  'select': { safe: true },       // → Select-Object
  'measure': { safe: true },      // → Measure-Object
  'ft': { safe: true },           // → Format-Table
  'fl': { safe: true },           // → Format-List
  'fw': { safe: true },           // → Format-Wide
  'oh': { safe: true },           // → Out-Host
  'h': { safe: true },            // → Get-History
  'history': { safe: true },      // → Get-History
  'help': { safe: true },         // → Get-Help
  'man': { safe: true },          // → Get-Help
  'cls': { safe: true },          // → Clear-Host
  'clear': { safe: true },        // → Clear-Host

  // 更多 PS 别名
  'chdir': { safe: true },        // → Set-Location
  'pushd': { safe: true },        // → Push-Location
  'popd': { safe: true },         // → Pop-Location
  'gp': { safe: true },           // → Get-ItemProperty
  '%': { safe: true },            // → ForEach-Object
  '?': { safe: true },            // → Where-Object

  // =========================================================================
  // 开发工具 —— 只读子命令
  // =========================================================================
  'git': {
    safeSubcommands: [
      'status', 'log', 'diff', 'show', 'branch', 'tag',
      'remote', 'config', 'rev-parse', 'ls-files', 'ls-tree',
      'blame', 'shortlog', 'describe', 'stash list', 'reflog',
      'rev-list', 'cat-file', 'name-rev', 'for-each-ref',
    ],
  },
  'gh': {
    safeSubcommands: [
      'issue list', 'issue view', 'pr list', 'pr view', 'pr checks',
      'repo view', 'status', 'run list', 'run view',
    ],
  },
  'npm': {
    safeSubcommands: [
      'list', 'ls', 'view', 'info', 'show', 'outdated', 'audit',
      'config list', 'config get', 'why', 'explain', 'prefix',
      'root', 'bin', 'pack --dry-run', 'version',
    ],
  },
  'yarn': {
    safeSubcommands: ['list', 'info', 'why', 'config list', 'versions'],
  },
  'pnpm': {
    safeSubcommands: ['list', 'ls', 'why', 'config list', 'outdated', 'audit'],
  },
  'pip': {
    safeSubcommands: ['list', 'show', 'freeze', 'check'],
  },
  'python': {
    safeSubcommands: ['--version', '-c "import sys; print(sys.version)"'],
  },
  'node': {
    safeSubcommands: ['--version', '-v', '-e', '-p'],
  },
  'cargo': {
    safeSubcommands: ['metadata', 'tree', 'version', 'check'],
  },
  'go': {
    safeSubcommands: ['list', 'version', 'env', 'doc', 'vet'],
  },
  'dotnet': {
    safeSubcommands: [
      'list', '--info', '--list-sdks', '--list-runtimes', '--version',
    ],
  },
  'docker': {
    safeSubcommands: [
      'ps', 'images', 'info', 'version', 'inspect',
      'logs', 'stats', 'top', 'port', 'network ls',
      'volume ls', 'container ls',
    ],
  },

  // 更多开发工具
  'bun': {
    safeSubcommands: ['--version', 'pm ls', 'pm cache'],
  },
  'deno': {
    safeSubcommands: ['--version', 'info', 'doc', 'lint', 'check', 'types'],
  },
  'rustc': {
    safeSubcommands: ['--version', '--print'],
  },
  'rustup': {
    safeSubcommands: ['show', 'which', 'check', 'component list', 'target list', 'toolchain list'],
  },
  'java': {
    safeSubcommands: ['-version', '--version'],
  },
  'javac': {
    safeSubcommands: ['-version', '--version'],
  },
  'mvn': {
    safeSubcommands: ['--version', '-v', 'dependency:tree', 'dependency:list', 'help:effective-pom'],
  },
  'gradle': {
    safeSubcommands: ['--version', 'dependencies', 'tasks', 'properties', 'projects'],
  },
  'kubectl': {
    safeSubcommands: [
      'get', 'describe', 'logs', 'top', 'cluster-info', 'version',
      'api-resources', 'api-versions', 'config view', 'config current-context',
    ],
  },
  'terraform': {
    safeSubcommands: ['version', 'show', 'state list', 'state show', 'output', 'providers', 'validate', 'fmt -check'],
  },
  'az': {
    safeSubcommands: ['--version', 'account show', 'account list', 'group list', 'resource list'],
  },
  'gcloud': {
    safeSubcommands: ['--version', 'info', 'config list', 'auth list', 'projects list', 'compute instances list'],
  },
};

// ============ 第三层：运行时动态白名单 ============

/**
 * 运行时动态白名单（内存中，重启后清空）。
 *
 * 当 shell 执行安装命令（pip install、npm install -g 等）成功后，
 * 由 learn.ts 中的 LLM 评估器分析新安装的 CLI 工具，
 * 将安全的子命令写入此 Map。
 *
 * 查找优先级：DENY_PATTERNS > SAFE_COMMANDS > RUNTIME_SAFE_COMMANDS > unknown
 */
const RUNTIME_SAFE_COMMANDS = new Map<string, CommandSafetyConfig>();

/**
 * 向运行时白名单添加一条命令配置。
 * key 会被统一转为小写。
 */
export function addToRuntimeWhitelist(command: string, config: CommandSafetyConfig): void {
  RUNTIME_SAFE_COMMANDS.set(command.toLowerCase(), config);
}

/**
 * 获取运行时白名单当前条目数（用于日志/调试）。
 */
export function getRuntimeWhitelistSize(): number {
  return RUNTIME_SAFE_COMMANDS.size;
}

/**
 * 清空运行时白名单（用于测试）。
 */
export function clearRuntimeWhitelist(): void {
  RUNTIME_SAFE_COMMANDS.clear();
}

// ============ 分类函数 ============

/**
 * 对 shell 命令做静态安全分类。
 *
 * @returns 'allow' 白名单放行 | 'deny' 黑名单拒绝 | 'unknown' 需要分类器判定
 */
export function classifyCommand(command: string): StaticClassification {
  const trimmed = command.trim();
  if (!trimmed) return 'deny';

  // 1. 检查绝对禁止模式
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(trimmed)) return 'deny';
  }

  // 2. 对多语句命令（; && ||），逐段检查
  //    只要有一段是 unknown 或 deny，整条命令就不是 allow
  const statements = splitStatements(trimmed);
  let allAllow = true;

  for (const stmt of statements) {
    const result = classifySingleStatement(stmt.trim());
    if (result === 'deny') return 'deny';
    if (result === 'unknown') allAllow = false;
  }

  return allAllow ? 'allow' : 'unknown';
}

/**
 * 简单切分多语句：按 ; && || | 以及换行分割。
 * 管道 | 右侧的命令依然需要安全检查（管道也可以接危险命令）。
 */
function splitStatements(command: string): string[] {
  return command
    .split(/\s*(?:;|&&|\|\||\||\r?\n)\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 对单条语句做白名单判定。
 */
function classifySingleStatement(stmt: string): StaticClassification {
  // 检查是否有文件重定向（> >> 2> 等）—— 重定向意味着写文件
  if (/(?:^|[^\-])(?:>>?|2>>?)\s*[^&]/.test(stmt)) {
    return 'unknown';
  }

  // 提取第一个 token（命令名）
  const tokens = stmt.split(/\s+/);
  const firstToken = tokens[0];
  if (!firstToken) return 'unknown';

  const lowerToken = firstToken.toLowerCase();
  // 去掉 .exe 后缀
  const normalizedToken = lowerToken.replace(/\.exe$/, '');

  // 查找顺序：静态白名单 > 运行时白名单
  const config = SAFE_COMMANDS[normalizedToken]
    ?? RUNTIME_SAFE_COMMANDS.get(normalizedToken);
  if (!config) return 'unknown';

  // 无条件安全
  if (config.safe) return 'allow';

  const restArgs = tokens.slice(1);

  // 自定义危险检查
  if (config.isDangerous) {
    return config.isDangerous(restArgs) ? 'unknown' : 'allow';
  }

  // 子命令匹配
  if (config.safeSubcommands) {
    const rest = stmt.slice(firstToken.length).trim();

    // 无子命令 = 该命令本身安全（如 hostname 单独执行）
    if (!rest && config.safeSubcommands.length === 0) return 'allow';

    for (const sub of config.safeSubcommands) {
      if (rest.toLowerCase().startsWith(sub.toLowerCase())) {
        return 'allow';
      }
    }
    return 'unknown';
  }

  // 安全 flag 匹配
  if (config.safeFlags) {
    const allFlagsSafe = restArgs.every(arg => {
      // 非 flag 参数（不以 - 或 / 开头的）视为值参数，通过
      if (!arg.startsWith('-') && !arg.startsWith('/')) return true;
      return config.safeFlags!.some(f => arg.toLowerCase().startsWith(f.toLowerCase()));
    });
    return allFlagsSafe ? 'allow' : 'unknown';
  }

  return 'allow';
}

/**
 * 导出 deny 理由（供 handler 使用）。
 */
export function getDenyReason(command: string): string | null {
  const trimmed = command.trim();
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `命令匹配危险模式: ${pattern.source}`;
    }
  }
  return null;
}
