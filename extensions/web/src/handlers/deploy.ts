import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  CloudflareSslMode,
  getCloudflareDeployContext,
  resolveCloudflareConfig,
  getCloudflareStatus,
  setCloudflareSslMode,
} from '../cloudflare'
import { readBody, sendJSON } from '../router'

// ── 配置读写通过直接 YAML I/O 实现（避免耦合 src/ 内部模块）──
import * as yaml from 'yaml'

function loadRawConfigDir(configDir: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const sections = ['llm', 'ocr', 'platform', 'storage', 'tools', 'system', 'memory', 'cloudflare', 'mcp', 'modes', 'sub_agents', 'summary', 'plugins'];
  for (const key of sections) {
    const filePath = path.join(configDir, `${key}.yaml`);
    if (fs.existsSync(filePath)) {
      try { result[key] = yaml.parse(fs.readFileSync(filePath, 'utf-8')); } catch {}
    }
  }
  return result;
}

function parsePlatformConfig(raw: any = {}): any {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const types: string[] = (() => {
    const envPlatform = process.env.IRIS_PLATFORM;
    if (envPlatform) return envPlatform.split(',').map(s => s.trim()).filter(Boolean);
    const rawType = source.type;
    if (typeof rawType === 'string') return rawType.split(',').map(s => s.trim()).filter(Boolean);
    if (Array.isArray(rawType)) return rawType.filter(t => typeof t === 'string').map(s => s.trim()).filter(Boolean);
    return ['web'];
  })();
  return {
    types,
    web: {
      port: source.web?.port ?? 8192,
      host: source.web?.host ?? '127.0.0.1',
      lastModel: source.web?.lastModel,
      authToken: source.web?.authToken,
      managementToken: source.web?.managementToken,
    },
    ...(Object.fromEntries(
      Object.entries(source).filter(([k]) => k !== 'type' && k !== 'pairing' && k !== 'web')
    )),
  };
}

const execFileAsync = promisify(execFile)
const NGINX_TARGET_PATH = '/etc/nginx/sites-available/iris'
const NGINX_LINK_PATH = '/etc/nginx/sites-enabled/iris'
const SERVICE_TARGET_PATH = '/etc/systemd/system/iris.service'
const HTPASSWD_PATH = '/etc/nginx/.htpasswd'
const CERTBOT_WEBROOT = '/var/www/certbot'

interface DeployFormOptions {
  domain: string
  port: number
  deployPath: string
  user: string
  enableHttps: boolean
  enableAuth: boolean
}

interface DeployResponseStep {
  name: string
  success: boolean
  output: string
}

interface DetectResponse {
  isLinux: boolean
  isLocal: boolean
  nginx: {
    installed: boolean
    version: string
    configDir: string
    existingConfig: boolean
  }
  systemd: {
    available: boolean
    existingService: boolean
    serviceStatus: string
  }
  sudo: {
    available: boolean
    noPassword: boolean
  }
}

interface DeployPreviewResponse {
  options: DeployFormOptions
  nginxConfig: string
  serviceConfig: string
  warnings: string[]
  errors: string[]
  recommendations: string[]
  cloudflare: Awaited<ReturnType<typeof getCloudflareDeployContext>>
}

function isRootUser(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0
}

function isLinuxHost(): boolean {
  return process.platform === 'linux'
}

function normalizeLoopback(address: string): string {
  return address.replace(/^::ffff:/, '').trim().toLowerCase()
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeLoopback(address)
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

function getHeader(req: http.IncomingMessage, key: string): string {
  const value = req.headers[key]
  if (Array.isArray(value)) return value[0]?.trim() || ''
  return typeof value === 'string' ? value.trim() : ''
}

function getClientAddress(req: http.IncomingMessage): string {
  const realIp = getHeader(req, 'x-real-ip')
  if (realIp) return realIp

  const forwardedFor = getHeader(req, 'x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || forwardedFor

  return req.socket.remoteAddress || ''
}

function readDeployToken(req: http.IncomingMessage): string {
  return getHeader(req, 'x-deploy-token')
}

function safeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  if (leftBuf.length !== rightBuf.length) return false
  return crypto.timingSafeEqual(leftBuf, rightBuf)
}

function assertDeployToken(req: http.IncomingMessage, res: http.ServerResponse, expectedToken: string): boolean {
  const presented = readDeployToken(req)
  if (!presented || !safeEqual(presented, expectedToken)) {
    sendJSON(res, 401, {
      error: '未授权：缺少或无效的部署令牌',
      code: 'DEPLOY_TOKEN_INVALID',
    })
    return false
  }
  return true
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath)
    return true
  } catch {
    return false
  }
}

function formatCommandError(error: unknown): string {
  if (error && typeof error === 'object') {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const detail = [err.stderr, err.stdout, err.message]
      .map((item) => (item || '').trim())
      .filter(Boolean)[0]
    if (detail) return detail
  }
  return error instanceof Error ? error.message : String(error)
}

async function runCommand(
  command: string,
  args: string[],
  options: { sudo?: boolean; allowFailure?: boolean; cwd?: string } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const useSudo = !!options.sudo && !isRootUser()
  const executable = useSudo ? 'sudo' : command
  const executableArgs = useSudo ? ['-n', command, ...args] : args

  try {
    const { stdout = '', stderr = '' } = await execFileAsync(executable, executableArgs, {
      cwd: options.cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true, stdout, stderr, exitCode: 0 }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number }
    const result = {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || formatCommandError(error),
      exitCode: typeof err.code === 'number' ? err.code : 1,
    }
    if (options.allowFailure) {
      return result
    }
    throw new Error(result.stderr.trim() || result.stdout.trim() || '命令执行失败')
  }
}

async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand('which', [command], { allowFailure: true })
  return result.ok
}

async function detectNginxVersion(): Promise<string> {
  const result = await runCommand('nginx', ['-v'], { allowFailure: true })
  const output = `${result.stdout}\n${result.stderr}`
  const match = output.match(/nginx\/([^\s]+)/)
  return match?.[1] || ''
}

async function detectServiceStatus(): Promise<string> {
  const result = await runCommand('systemctl', ['is-active', 'iris'], { allowFailure: true })
  return (result.stdout || result.stderr).trim() || 'unknown'
}

async function detectSudoState(): Promise<{ available: boolean; noPassword: boolean }> {
  if (!isLinuxHost()) {
    return { available: false, noPassword: false }
  }

  if (isRootUser()) {
    return { available: true, noPassword: true }
  }

  const available = await commandExists('sudo')
  if (!available) {
    return { available: false, noPassword: false }
  }

  const result = await runCommand('sudo', ['-n', 'true'], { allowFailure: true })
  return {
    available: true,
    noPassword: result.ok,
  }
}

function normalizeDeployPath(value: string): string {
  return value.trim().replace(/\\/g, '/')
}

function normalizeOptions(raw: unknown): DeployFormOptions {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const portValue = typeof source.port === 'number' ? source.port : Number(source.port)
  return {
    domain: typeof source.domain === 'string' ? source.domain.trim() : '',
    port: Number.isFinite(portValue) ? Math.trunc(portValue) : 8192,
    deployPath: normalizeDeployPath(typeof source.deployPath === 'string' ? source.deployPath : process.cwd()),
    user: typeof source.user === 'string' ? source.user.trim() : '',
    enableHttps: !!source.enableHttps,
    enableAuth: !!source.enableAuth,
  }
}

function buildNginxConfig(options: DeployFormOptions): string {
  const authBlock = options.enableAuth
    ? [
        '    auth_basic "Iris";',
        `    auth_basic_user_file ${HTPASSWD_PATH};`,
        '',
      ].join('\n')
    : ''

  const sharedProxy = [
    '        proxy_http_version 1.1;',
    '',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
  ].join('\n')

  const sseBlock = [
    '    # SSE 专用：/api/chat',
    '    location /api/chat {',
    `        proxy_pass http://127.0.0.1:${options.port};`,
    '',
    '        proxy_buffering off;',
    '        proxy_cache off;',
    '        chunked_transfer_encoding off;',
    '',
    '        proxy_read_timeout 300s;',
    '        proxy_send_timeout 300s;',
    '',
    "        proxy_set_header Connection '';",
    sharedProxy,
    '    }',
  ].join('\n')

  const webBlock = [
    '    location / {',
    `        proxy_pass http://127.0.0.1:${options.port};`,
    sharedProxy,
    '',
    '        proxy_set_header Upgrade $http_upgrade;',
    '        proxy_set_header Connection "upgrade";',
    '    }',
  ].join('\n')

  if (!options.enableHttps) {
    return [
      '# ==========================================',
      '#  Iris Nginx 配置（HTTP-only）',
      '# ==========================================',
      '',
      'server {',
      '    listen 80;',
      '    listen [::]:80;',
      `    server_name ${options.domain};`,
      '',
      '    location /.well-known/acme-challenge/ {',
      `        root ${CERTBOT_WEBROOT};`,
      '    }',
      '',
      authBlock,
      sseBlock,
      '',
      webBlock,
      '}',
      '',
    ].join('\n')
  }

  return [
    '# ==========================================',
    '#  Iris Nginx 配置（HTTPS）',
    '# ==========================================',
    '',
    'server {',
    '    listen 80;',
    '    listen [::]:80;',
    `    server_name ${options.domain};`,
    '',
    '    location /.well-known/acme-challenge/ {',
    `        root ${CERTBOT_WEBROOT};`,
    '    }',
    '',
    '    location / {',
    '        return 301 https://$host$request_uri;',
    '    }',
    '}',
    '',
    'server {',
    '    listen 443 ssl http2;',
    '    listen [::]:443 ssl http2;',
    `    server_name ${options.domain};`,
    '',
    `    ssl_certificate     /etc/letsencrypt/live/${options.domain}/fullchain.pem;`,
    `    ssl_certificate_key /etc/letsencrypt/live/${options.domain}/privkey.pem;`,
    '',
    '    ssl_protocols TLSv1.2 TLSv1.3;',
    '    ssl_ciphers HIGH:!aNULL:!MD5;',
    '    ssl_prefer_server_ciphers on;',
    '    ssl_session_cache shared:SSL:10m;',
    '    ssl_session_timeout 10m;',
    '',
    '    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;',
    '    add_header X-Frame-Options DENY always;',
    '    add_header X-Content-Type-Options nosniff always;',
    '    add_header X-XSS-Protection "1; mode=block" always;',
    '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    '',
    authBlock,
    sseBlock,
    '',
    webBlock,
    '}',
    '',
  ].join('\n')
}

function buildServiceConfig(options: DeployFormOptions): string {
  return [
    '# ==========================================',
    '#  Iris systemd 服务文件',
    '# ==========================================',
    '',
    '[Unit]',
    'Description=Iris AI Chat Service',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${options.deployPath}`,
    `ExecStart=${path.posix.join(options.deployPath, 'bin', 'iris')} serve`,
    `User=${options.user}`,
    `Group=${options.user}`,
    'Environment=NODE_ENV=production',
    `Environment=IRIS_DATA_DIR=${path.posix.join(options.deployPath, '.iris')}`,
    'Restart=on-failure',
    'RestartSec=5',
    'StandardOutput=journal',
    'StandardError=journal',
    'NoNewPrivileges=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    `ReadWritePaths=${path.posix.join(options.deployPath, '.iris')}`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n')
}

async function buildPreview(configDir: string, rawOptions: unknown): Promise<DeployPreviewResponse> {
  const options = normalizeOptions(rawOptions)
  const effectiveDomain = options.domain || 'chat.example.com'
  const previewOptions: DeployFormOptions = {
    ...options,
    domain: effectiveDomain,
  }

  const errors: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []

  if (!options.domain) {
    errors.push('请填写域名后再部署')
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    errors.push('后端端口必须在 1-65535 之间')
  }

  if (!options.deployPath) {
    errors.push('请填写部署路径')
  } else if (!options.deployPath.startsWith('/')) {
    errors.push('部署路径必须是 Linux 绝对路径')
  }

  if (!options.user) {
    errors.push('请填写运行用户')
  }

  if (isLinuxHost()) {
    if (options.user) {
      const userExists = await runCommand('id', ['-u', options.user], { allowFailure: true })
      if (!userExists.ok) {
        errors.push(`未检测到运行用户 ${options.user}，请先创建该用户`)
      }
    }

    if (options.deployPath) {
      const deployPathExists = await pathExists(options.deployPath)
      if (!deployPathExists) {
        errors.push(`部署路径不存在：${options.deployPath}`)
      } else {
        const binaryEntrypoint = path.join(options.deployPath, 'bin', 'iris')
        if (!(await pathExists(binaryEntrypoint))) {
          warnings.push(`未检测到 ${binaryEntrypoint}，请确认已解压 GitHub Release 或完成二进制构建`)
        }
      }
    }

    if (options.enableHttps && options.domain) {
      const fullchain = `/etc/letsencrypt/live/${effectiveDomain}/fullchain.pem`
      const privkey = `/etc/letsencrypt/live/${effectiveDomain}/privkey.pem`
      if (!(await pathExists(fullchain)) || !(await pathExists(privkey))) {
        errors.push(`未检测到 ${effectiveDomain} 的 HTTPS 证书。请先以 HTTP-only 模式部署并申请证书，再启用 HTTPS。`)
      }
    }

    if (options.enableAuth && !(await pathExists(HTPASSWD_PATH))) {
      errors.push(`已启用密码保护，但未找到 ${HTPASSWD_PATH}`)
    }
  }

  const cloudflare = await getCloudflareDeployContext(configDir, options.domain || null)
  if (cloudflare?.connected) {
    if (!options.enableHttps && (cloudflare.sslMode === 'full' || cloudflare.sslMode === 'strict')) {
      warnings.push('当前 Cloudflare SSL 为 Full/Strict，而源站计划使用 HTTP-only。部署后请同步为 Flexible，避免 521/525 错误。')
    }

    if (options.enableHttps && cloudflare.sslMode === 'flexible') {
      recommendations.push('源站启用 HTTPS 后，建议将 Cloudflare SSL 切换到 Full (Strict)。')
    }

    if (options.enableHttps && cloudflare.domainRecordProxied === false) {
      recommendations.push('当前域名记录未开启 Cloudflare 代理，如需 CDN/防护可在 Cloudflare 管理中开启。')
    }
  }

  if (!options.enableHttps) {
    recommendations.push('HTTP-only 模式适合首次上线和 Cloudflare Flexible；拿到证书后建议重新部署为 HTTPS。')
  }

  if (options.enableAuth) {
    recommendations.push('启用 Basic Auth 后，请妥善保管 /etc/nginx/.htpasswd 中的账号信息。')
  }

  return {
    options: previewOptions,
    nginxConfig: buildNginxConfig(previewOptions),
    serviceConfig: buildServiceConfig(previewOptions),
    warnings,
    errors,
    recommendations,
    cloudflare,
  }
}

async function writeInstalledFile(targetPath: string, content: string): Promise<void> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'iris-deploy-'))
  const tempFile = path.join(tempDir, path.basename(targetPath))
  try {
    await fs.promises.writeFile(tempFile, content, 'utf-8')
    await runCommand('install', ['-m', '644', tempFile, targetPath], { sudo: true })
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function runDeployStep(steps: DeployResponseStep[], name: string, action: () => Promise<string | void>): Promise<void> {
  try {
    const output = await action()
    steps.push({
      name,
      success: true,
      output: typeof output === 'string' && output.trim() ? output.trim() : '完成',
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    steps.push({ name, success: false, output: detail })
    throw error
  }
}

async function ensureEnvironmentReady(req: http.IncomingMessage, target: 'nginx' | 'service'): Promise<{ detect: DetectResponse; error?: string }> {
  const detect = await detectEnvironment(req)
  if (!detect.isLinux) return { detect, error: '仅支持 Linux 系统部署' }
  if (!detect.isLocal) return { detect, error: '仅允许本地访问部署接口' }
  if (!detect.sudo.available || !detect.sudo.noPassword) return { detect, error: '当前环境未配置免密 sudo，无法执行一键部署' }
  if (target === 'nginx' && !detect.nginx.installed) return { detect, error: '未检测到 Nginx，请先安装' }
  if (target === 'service' && !detect.systemd.available) return { detect, error: '当前系统未提供可用的 systemd' }
  return { detect }
}

async function detectEnvironment(req: http.IncomingMessage): Promise<DetectResponse> {
  const isLinux = isLinuxHost()
  const clientAddress = getClientAddress(req)
  const isLocal = isLoopbackAddress(clientAddress)

  let nginxInstalled = false
  let nginxVersion = ''
  let systemdAvailable = false
  let systemdStatus = ''

  if (isLinux) {
    nginxInstalled = await commandExists('nginx')
    if (nginxInstalled) {
      nginxVersion = await detectNginxVersion()
    }

    const systemctlExists = await commandExists('systemctl')
    systemdAvailable = systemctlExists && await pathExists('/run/systemd/system')
    if (systemdAvailable) {
      systemdStatus = await detectServiceStatus()
    }
  }

  return {
    isLinux,
    isLocal,
    nginx: {
      installed: nginxInstalled,
      version: nginxVersion,
      configDir: '/etc/nginx/sites-available',
      existingConfig: await pathExists(NGINX_TARGET_PATH) || await pathExists(NGINX_LINK_PATH),
    },
    systemd: {
      available: systemdAvailable,
      existingService: await pathExists(SERVICE_TARGET_PATH),
      serviceStatus: systemdStatus,
    },
    sudo: await detectSudoState(),
  }
}

function loadPlatformWebState(configDir: string): { host: string; port: number } {
  const raw = loadRawConfigDir(configDir) as Record<string, unknown>
  const parsed = parsePlatformConfig(raw.platform)
  return {
    host: parsed.web.host,
    port: parsed.web.port,
  }
}

function getDefaultDeployUser(): string {
  return process.env.SUDO_USER || process.env.USER || os.userInfo().username || 'iris'
}

async function resolveCloudflareSyncTarget(configDir: string, requestedZoneId?: string | null): Promise<{ token: string; zoneId: string }> {
  const resolved = resolveCloudflareConfig(configDir)
  if (!resolved.token) {
    throw new Error(resolved.error || '未配置 Cloudflare API Token')
  }

  const status = await getCloudflareStatus(configDir, requestedZoneId)
  if (!status.connected || !status.activeZoneId) {
    throw new Error(status.error || 'Cloudflare 未连接或未选择可用 Zone')
  }

  return {
    token: resolved.token,
    zoneId: status.activeZoneId,
  }
}

export function createDeployHandlers(configDir: string, getDeployToken: () => string) {
  return {
    async getState(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const web = loadPlatformWebState(configDir)
        const defaults: DeployFormOptions = {
          domain: '',
          port: web.port,
          deployPath: normalizeDeployPath(process.cwd()),
          user: getDefaultDeployUser(),
          enableHttps: true,
          enableAuth: false,
        }
        const cloudflare = await getCloudflareDeployContext(configDir, null)
        sendJSON(res, 200, { web, defaults, cloudflare })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        sendJSON(res, 500, { error: detail })
      }
    },

    async detect(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const result = await detectEnvironment(req)
        sendJSON(res, 200, result)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        sendJSON(res, 500, { error: detail })
      }
    },

    async preview(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req)
        const result = await buildPreview(configDir, body.options)
        sendJSON(res, 200, result)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        sendJSON(res, 500, { error: detail })
      }
    },

    async deployNginx(req: http.IncomingMessage, res: http.ServerResponse) {
      if (!assertDeployToken(req, res, getDeployToken())) return

      const steps: DeployResponseStep[] = []
      try {
        const { error } = await ensureEnvironmentReady(req, 'nginx')
        if (error) {
          sendJSON(res, 400, { ok: false, steps, error })
          return
        }

        const body = await readBody(req)
        const preview = await buildPreview(configDir, body.options)
        if (preview.errors.length > 0) {
          sendJSON(res, 400, { ok: false, steps, error: preview.errors[0] })
          return
        }

        await runDeployStep(steps, '写入 Nginx 配置', async () => {
          await runCommand('install', ['-d', CERTBOT_WEBROOT], { sudo: true })
          await writeInstalledFile(NGINX_TARGET_PATH, preview.nginxConfig)
          await runCommand('ln', ['-sfn', NGINX_TARGET_PATH, NGINX_LINK_PATH], { sudo: true })
          return `已写入 ${NGINX_TARGET_PATH}`
        })

        await runDeployStep(steps, '校验 Nginx 配置', async () => {
          const result = await runCommand('nginx', ['-t'], { sudo: true })
          return (result.stdout || result.stderr).trim() || 'nginx -t 通过'
        })

        await runDeployStep(steps, '重启 Nginx', async () => {
          const result = await runCommand('systemctl', ['restart', 'nginx'], { sudo: true })
          return (result.stdout || result.stderr).trim() || 'nginx 已重启'
        })

        sendJSON(res, 200, { ok: true, steps })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        sendJSON(res, 200, { ok: false, steps, error: detail })
      }
    },

    async deployService(req: http.IncomingMessage, res: http.ServerResponse) {
      if (!assertDeployToken(req, res, getDeployToken())) return

      const steps: DeployResponseStep[] = []
      try {
        const { error } = await ensureEnvironmentReady(req, 'service')
        if (error) {
          sendJSON(res, 400, { ok: false, steps, error })
          return
        }

        const body = await readBody(req)
        const preview = await buildPreview(configDir, body.options)
        if (preview.errors.length > 0) {
          sendJSON(res, 400, { ok: false, steps, error: preview.errors[0] })
          return
        }

        await runDeployStep(steps, '写入 systemd 服务文件', async () => {
          await writeInstalledFile(SERVICE_TARGET_PATH, preview.serviceConfig)
          return `已写入 ${SERVICE_TARGET_PATH}`
        })

        await runDeployStep(steps, '重新加载 systemd', async () => {
          const result = await runCommand('systemctl', ['daemon-reload'], { sudo: true })
          return (result.stdout || result.stderr).trim() || 'systemd 配置已重新加载'
        })

        await runDeployStep(steps, '启用服务', async () => {
          const result = await runCommand('systemctl', ['enable', 'iris'], { sudo: true })
          return (result.stdout || result.stderr).trim() || '服务已启用'
        })

        await runDeployStep(steps, '重启服务', async () => {
          const result = await runCommand('systemctl', ['restart', 'iris'], { sudo: true })
          return (result.stdout || result.stderr).trim() || '服务已重启'
        })

        await runDeployStep(steps, '检查服务状态', async () => {
          const result = await runCommand('systemctl', ['--no-pager', '--full', 'status', 'iris'], { sudo: true })
          return (result.stdout || result.stderr).trim() || '服务状态正常'
        })

        sendJSON(res, 200, { ok: true, steps })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        sendJSON(res, 200, { ok: false, steps, error: detail })
      }
    },

    async syncCloudflare(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req)
        const mode = typeof body.mode === 'string' ? body.mode.trim() : ''
        if (mode !== 'flexible' && mode !== 'full' && mode !== 'strict') {
          sendJSON(res, 400, { ok: false, error: '无效的 Cloudflare SSL 模式' })
          return
        }

        const zoneIdInput = typeof body.zoneId === 'string' ? body.zoneId.trim() : ''
        const { token, zoneId } = await resolveCloudflareSyncTarget(configDir, zoneIdInput || null)
        const appliedMode: CloudflareSslMode = await setCloudflareSslMode(token, zoneId, mode)
        sendJSON(res, 200, { ok: true, mode: appliedMode })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        sendJSON(res, 500, { ok: false, error: detail })
      }
    },
  }
}
