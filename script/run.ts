/**
 * 统一启动入口
 *
 * 规则：
 * - bun run dev / bun run start：优先使用 Bun 运行时
 * - npm run dev / npm run start：默认使用 Node.js + tsx
 * - 若当前配置包含 console 平台，则自动切换到 Bun 运行时
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig } from '../src/config'

type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown'

function detectPackageManager(): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? ''

  if (userAgent.startsWith('bun/')) return 'bun'
  if (userAgent.startsWith('npm/')) return 'npm'
  if (userAgent.startsWith('pnpm/')) return 'pnpm'
  if (userAgent.startsWith('yarn/')) return 'yarn'
  if (typeof (globalThis as any).Bun !== 'undefined') return 'bun'

  return 'unknown'
}

function isCommandNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * 查找本地 tsx 可执行文件路径。
 * Windows 上 spawn('tsx') 不搜索 node_modules/.bin，
 * 需要用完整路径或改用 node --import tsx。
 */
function findLocalTsx(): string | null {
  const candidates = [
    resolve('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
    resolve('node_modules', '.bin', 'tsx'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function runShell(command: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { stdio: 'inherit', env: process.env, shell: true })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) { process.kill(process.pid, signal); return }
      resolve(code ?? 1)
    })
  })
}

function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
        return
      }
      resolve(code ?? 1)
    })
  })
}

async function main() {
  const forwardedArgs = process.argv.slice(2)
  const config = loadConfig()
  const packageManager = detectPackageManager()
  const hasConsolePlatform = config.platform.types.includes('console')

  // 只有在配置了 console 平台时才必须使用 Bun 运行时（OpenTUI 依赖 Bun 的终端 API）。
  const preferBunRuntime = hasConsolePlatform

  if (preferBunRuntime) {
    if (packageManager !== 'bun') {
      console.log('[Iris] 检测到 console 平台，已自动切换到 Bun 运行时。')
    }

    try {
      process.exit(await runCommand('bun', ['src/index.ts', ...forwardedArgs]))
      return
    } catch (error) {
      if (!isCommandNotFound(error)) {
        throw error
      }

      if (hasConsolePlatform) {
        console.error(
          '[Iris] 当前配置包含 console 平台，但未找到 Bun 运行时。\n'
          + '  - 请先安装 Bun：https://bun.sh/\n'
          + '  - 安装后可直接使用：bun run dev\n'
          + '  - 或改用其他平台（如 web）',
        )
        process.exit(1)
        return
      }

      console.warn('[Iris] 未找到 Bun，已回退到 Node.js 运行时。')
    }
  }

  // 优先使用本地 tsx 可执行文件（解决 Windows portable Node 找不到 tsx 的问题）
  const localTsx = findLocalTsx()
  if (localTsx) {
    // Windows 的 .cmd 文件必须通过 shell 执行
    process.exit(await runShell(`"${localTsx}" src/index.ts ${forwardedArgs.map(a => `"${a}"`).join(' ')}`))
  } else {
    // 回退：用当前 node 进程 + tsx loader
    process.exit(await runCommand(process.execPath, ['--import', 'tsx', 'src/index.ts', ...forwardedArgs]))
  }
}

main().catch((error) => {
  console.error('启动失败:', error)
  process.exit(1)
})
