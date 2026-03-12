<template>
  <div class="overlay" @click.self="requestClose">
    <div class="settings-panel">
      <div class="settings-header">
        <div class="settings-title-group">
          <span class="settings-kicker">Control Center</span>
          <h2>设置中心</h2>
          <p>配置模型连接、系统策略与工具能力，打造你的 AI 工作台。</p>
          <p v-if="managementEnabled" class="field-hint" style="margin-top:6px">
            管理接口已启用令牌保护。当前状态：
            <strong :style="{ color: managementReady ? 'var(--success)' : 'var(--error)' }">{{ managementReady ? '已解锁' : '未解锁' }}</strong>
          </p>
        </div>
        <button class="btn-close" type="button" aria-label="关闭设置" @click="requestClose">
          <AppIcon :name="ICONS.common.close" />
        </button>
      </div>

      <div class="settings-body">
        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>模型与凭证</h3>
              <p>配置三层 LLM 路由：Primary 处理首轮对话，Secondary 处理工具后续轮次，Light 预留辅助任务。</p>
            </div>
            <span class="settings-pill">LLM</span>
          </div>

          <!-- Primary（必填） -->
          <div class="tier-block">
            <div class="tier-header" @click="tierOpen.primary = !tierOpen.primary">
              <span class="tier-arrow" :class="{ open: tierOpen.primary }">▶</span>
              <span class="tier-label">Primary</span>
              <span class="tier-desc">主对话 · 首轮</span>
            </div>
            <div v-show="tierOpen.primary" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>LLM 提供商</label>
                  <select v-model="tiers.primary.provider">
                    <option value="gemini">Gemini</option>
                    <option value="openai-compatible">OpenAI 兼容</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="claude">Claude</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>模型</label>
                  <div class="inline-field-actions">
                    <input type="text" v-model="tiers.primary.model" placeholder="例如：gemini-2.0-flash" />
                    <button class="btn-inline-action" type="button"
                            :disabled="modelCatalog.primary.loading || (managementEnabled && !managementReady)"
                            @click="fetchTierModels('primary')">
                      {{ modelCatalog.primary.loading ? '拉取中...' : '拉取列表' }}
                    </button>
                  </div>
                  <select v-if="modelCatalog.primary.options.length > 0" v-model="tiers.primary.model" class="model-list-select">
                    <option value="">选择已发现的模型（也可继续手动输入）</option>
                    <option v-for="option in modelCatalog.primary.options" :key="option.id" :value="option.id">{{ option.label }}</option>
                  </select>
                  <p class="field-hint" :class="{ 'model-fetch-error': !!modelCatalog.primary.error }">{{ tierModelHint('primary') }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API Key</label>
                  <input type="password" v-model="tiers.primary.apiKey" placeholder="输入或保留已有密钥" />
                  <p class="field-hint">{{ tierKeyHint(tiers.primary.apiKey) }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API 地址</label>
                  <input type="text" v-model="tiers.primary.baseUrl" placeholder="模型服务请求地址" />
                </div>
              </div>
            </div>
          </div>

          <!-- Secondary（可选） -->
          <div class="tier-block">
            <div class="tier-header" @click="tierOpen.secondary = !tierOpen.secondary">
              <span class="tier-arrow" :class="{ open: tierOpen.secondary }">▶</span>
              <span class="tier-label">Secondary</span>
              <span class="tier-desc">工具后续轮次</span>
              <label class="toggle-switch tier-toggle" @click.stop>
                <input type="checkbox" v-model="tierEnabled.secondary" />
                <span class="toggle-switch-ui"></span>
              </label>
            </div>
            <div v-show="tierOpen.secondary && tierEnabled.secondary" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>LLM 提供商</label>
                  <select v-model="tiers.secondary.provider">
                    <option value="gemini">Gemini</option>
                    <option value="openai-compatible">OpenAI 兼容</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="claude">Claude</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>模型</label>
                  <div class="inline-field-actions">
                    <input type="text" v-model="tiers.secondary.model" placeholder="例如：gpt-4o" />
                    <button class="btn-inline-action" type="button"
                            :disabled="modelCatalog.secondary.loading || (managementEnabled && !managementReady)"
                            @click="fetchTierModels('secondary')">
                      {{ modelCatalog.secondary.loading ? '拉取中...' : '拉取列表' }}
                    </button>
                  </div>
                  <select v-if="modelCatalog.secondary.options.length > 0" v-model="tiers.secondary.model" class="model-list-select">
                    <option value="">选择已发现的模型（也可继续手动输入）</option>
                    <option v-for="option in modelCatalog.secondary.options" :key="option.id" :value="option.id">{{ option.label }}</option>
                  </select>
                  <p class="field-hint" :class="{ 'model-fetch-error': !!modelCatalog.secondary.error }">{{ tierModelHint('secondary') }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API Key</label>
                  <input type="password" v-model="tiers.secondary.apiKey" placeholder="输入或保留已有密钥" />
                  <p class="field-hint">{{ tierKeyHint(tiers.secondary.apiKey) }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API 地址</label>
                  <input type="text" v-model="tiers.secondary.baseUrl" placeholder="模型服务请求地址" />
                </div>
              </div>
            </div>
          </div>

          <!-- Light（可选） -->
          <div class="tier-block">
            <div class="tier-header" @click="tierOpen.light = !tierOpen.light">
              <span class="tier-arrow" :class="{ open: tierOpen.light }">▶</span>
              <span class="tier-label">Light</span>
              <span class="tier-desc">辅助任务（预留）</span>
              <label class="toggle-switch tier-toggle" @click.stop>
                <input type="checkbox" v-model="tierEnabled.light" />
                <span class="toggle-switch-ui"></span>
              </label>
            </div>
            <div v-show="tierOpen.light && tierEnabled.light" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>LLM 提供商</label>
                  <select v-model="tiers.light.provider">
                    <option value="gemini">Gemini</option>
                    <option value="openai-compatible">OpenAI 兼容</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="claude">Claude</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>模型</label>
                  <div class="inline-field-actions">
                    <input type="text" v-model="tiers.light.model" placeholder="例如：gemini-2.0-flash" />
                    <button class="btn-inline-action" type="button"
                            :disabled="modelCatalog.light.loading || (managementEnabled && !managementReady)"
                            @click="fetchTierModels('light')">
                      {{ modelCatalog.light.loading ? '拉取中...' : '拉取列表' }}
                    </button>
                  </div>
                  <select v-if="modelCatalog.light.options.length > 0" v-model="tiers.light.model" class="model-list-select">
                    <option value="">选择已发现的模型（也可继续手动输入）</option>
                    <option v-for="option in modelCatalog.light.options" :key="option.id" :value="option.id">{{ option.label }}</option>
                  </select>
                  <p class="field-hint" :class="{ 'model-fetch-error': !!modelCatalog.light.error }">{{ tierModelHint('light') }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API Key</label>
                  <input type="password" v-model="tiers.light.apiKey" placeholder="输入或保留已有密钥" />
                  <p class="field-hint">{{ tierKeyHint(tiers.light.apiKey) }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API 地址</label>
                  <input type="text" v-model="tiers.light.baseUrl" placeholder="模型服务请求地址" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>系统行为</h3>
              <p>调节提示词、工具轮次与回复方式。</p>
            </div>
            <span class="settings-pill">System</span>
          </div>

          <div class="settings-grid two-columns">
            <div class="form-group full-width">
              <label>系统提示词</label>
              <textarea
                v-model="config.systemPrompt"
                rows="5"
                placeholder="输入系统提示词，定义你的默认协作风格"
              ></textarea>
            </div>

            <div class="form-group">
              <label>工具最大轮次</label>
              <input type="number" v-model.number="config.maxToolRounds" min="1" max="50" />
            </div>

            <div class="settings-switch-row">
              <div>
                <span class="switch-label">流式输出</span>
                <p class="field-hint">{{ streamHint }}</p>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="config.stream" />
                <span class="toggle-switch-ui"></span>
              </label>
            </div>

            <div class="settings-switch-row">
              <div>
                <span class="switch-label">界面主题</span>
                <p class="field-hint">{{ themeHint }}</p>
              </div>
              <div class="theme-selector">
                <button
                  v-for="opt in themeOptions"
                  :key="opt.value"
                  class="theme-option"
                  :class="{ active: currentTheme === opt.value }"
                  type="button"
                  @click="setTheme(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>MCP 服务器</h3>
              <p>连接外部 MCP 服务器，自动将其工具注入 LLM 工具列表。</p>
            </div>
            <span class="settings-pill">{{ mcpServers.length }} 个服务器</span>
          </div>

          <div v-for="(server, idx) in mcpServers" :key="idx" class="tier-block">
            <div class="tier-header" @click="server.open = !server.open">
              <span class="tier-arrow" :class="{ open: server.open }">▶</span>
              <span class="tier-label">{{ server.name || '未命名' }}</span>
              <span class="tier-desc">{{ server.transport === 'stdio' ? '本地进程' : 'HTTP' }}</span>
              <label class="toggle-switch tier-toggle" @click.stop>
                <input type="checkbox" v-model="server.enabled" />
                <span class="toggle-switch-ui"></span>
              </label>
              <button class="btn-mcp-remove" type="button" @click.stop="removeMcpServer(idx)" title="删除服务器">
                <AppIcon :name="ICONS.common.close" />
              </button>
            </div>
            <div v-show="server.open" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>服务器名称</label>
                  <input type="text" v-model="server.name" placeholder="仅字母、数字、下划线"
                         @input="sanitizeMcpName(server)" />
                </div>
                <div class="form-group">
                  <label>传输方式</label>
                  <select v-model="server.transport">
                    <option value="stdio">stdio（本地进程）</option>
                    <option value="http">HTTP（远程服务器）</option>
                  </select>
                </div>

                <template v-if="server.transport === 'stdio'">
                  <div class="form-group">
                    <label>命令</label>
                    <input type="text" v-model="server.command" placeholder="例如：npx" />
                  </div>
                  <div class="form-group">
                    <label>工作目录</label>
                    <input type="text" v-model="server.cwd" placeholder="可选" />
                  </div>
                  <div class="form-group full-width">
                    <label>参数（每行一个）</label>
                    <textarea v-model="server.args" rows="3"
                              placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"></textarea>
                  </div>
                </template>

                <template v-if="server.transport === 'http'">
                  <div class="form-group full-width">
                    <label>URL</label>
                    <input type="text" v-model="server.url" placeholder="https://mcp.example.com/mcp" />
                  </div>
                  <div class="form-group full-width">
                    <label>Authorization</label>
                    <input type="password" v-model="server.authHeader" placeholder="Bearer your-token（可选）" />
                    <p v-if="server.authHeader.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                  </div>
                </template>

                <div class="form-group">
                  <label>超时（毫秒）</label>
                  <input type="number" v-model.number="server.timeout" min="1000" max="120000" />
                </div>
              </div>
            </div>
          </div>

          <button class="btn-mcp-add" type="button" @click="addMcpServer">+ 添加 MCP 服务器</button>
        </section>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>工具状态</h3>
              <p>当前挂载到模型上下文中的可用能力。</p>
            </div>
            <span class="settings-pill">{{ tools.length }} 个工具</span>
          </div>

          <div class="tools-list">
            <span v-for="tool in tools" :key="tool" class="tool-tag">{{ tool }}</span>
            <span v-if="tools.length === 0" class="text-muted">无已注册工具</span>
          </div>
        </section>

        <!-- Cloudflare 管理 -->
        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>Cloudflare 管理</h3>
              <p>{{ cf.connected ? '管理 DNS 记录与 SSL 配置。' : '连接 Cloudflare 以管理域名和安全策略。请先在「部署生成器」页完成 Nginx 配置。' }}</p>
              <p v-if="cf.tokenSource" class="field-hint" style="margin-top:6px">
                Token 来源：{{ cf.tokenSource === 'env' ? '环境变量' : (cf.tokenSource === 'file' ? '文件' : '配置文件明文') }}
              </p>
            </div>
            <span class="settings-pill" :style="{ background: cf.connected ? 'var(--success)' : undefined }">
              {{ cf.connected ? '已连接' : '未连接' }}
            </span>
          </div>

          <!-- 未配置：引导输入 token -->
          <div v-if="!cf.connected" class="settings-grid two-columns">
            <div class="form-group full-width cf-guide-steps">
              <p class="field-hint" style="line-height:1.8">
                <strong style="color:var(--text-secondary)">快速开始：</strong><br/>
                1. 打开
                <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener"
                   style="color:var(--accent-cyan, var(--accent));text-decoration:underline">
                  Cloudflare API Tokens 页面
                </a>，点击 "Create Token"<br/>
                2. 选择 "Edit zone DNS" 模板，或自定义权限：<br/>
                <span style="padding-left:1.2em;display:inline-block">
                  Zone &gt; Zone &gt; Read，Zone &gt; DNS &gt; Edit，Zone &gt; Zone Settings &gt; Edit
                </span><br/>
                3. 将生成的 Token 粘贴到下方
              </p>
            </div>
            <div class="form-group full-width">
              <label>API Token</label>
              <input type="password" v-model="cf.tokenInput" placeholder="以 Bearer token 格式，例如 xyzABC123..." />
            </div>
            <div class="form-group full-width" style="display:flex;align-items:center;gap:12px">
              <button class="btn-save" type="button" :disabled="cf.loading" @click="handleCfSetup">
                {{ cf.loading ? '验证中...' : '连接' }}
              </button>
              <span v-if="cf.error" class="settings-status error">{{ cf.error }}</span>
            </div>
          </div>

          <!-- 已配置：zone 信息 + SSL + DNS -->
          <template v-if="cf.connected">
            <!-- 多 zone 选择器 -->
            <div v-if="cf.zones.length > 1" class="form-group">
              <label>选择域名</label>
              <select v-model="cf.activeZoneId" @change="handleZoneChange">
                <option v-for="zone in cf.zones" :key="zone.id" :value="zone.id">
                  {{ zone.name }} ({{ zone.status }})
                </option>
              </select>
            </div>

            <!-- 单 zone 卡片 -->
            <div v-else class="cf-zone-card" v-for="zone in cf.zones" :key="zone.id">
              <span class="cf-zone-name">{{ zone.name }}</span>
              <span class="cf-zone-status" :class="{ active: zone.status === 'active' }">
                {{ zone.status }}
              </span>
            </div>

            <!-- SSL 模式 -->
            <div class="settings-grid two-columns" style="margin-top:12px">
              <div class="form-group">
                <label>SSL 模式</label>
                <select v-model="cf.sslMode" @change="handleSslChange">
                  <option value="off">Off — 不加密</option>
                  <option value="flexible">Flexible — 浏览器到 CF 加密</option>
                  <option value="full">Full — 全程加密（不验证源站证书）</option>
                  <option value="strict">Full (Strict) — 全程加密 + 验证源站证书</option>
                </select>
                <p class="field-hint">{{ sslHints[cf.sslMode] || '' }}</p>
                <p v-if="cf.sslMode === 'full' || cf.sslMode === 'strict'" class="field-hint" style="margin-top:4px;color:var(--accent-cyan, var(--accent))">
                  需要 Nginx 开启 HTTPS（443 端口 + SSL 证书），否则 CF 到源站连接会失败（521/525）。
                </p>
                <p v-if="cf.sslMode === 'flexible'" class="field-hint" style="margin-top:4px;color:var(--accent-cyan, var(--accent))">
                  Nginx 只需监听 80 端口即可，无需配置 SSL 证书。
                </p>
              </div>
              <div class="form-group" style="display:flex;align-items:flex-end">
                <span v-if="cf.sslMsg" class="settings-status" :class="{ error: cf.sslError }">{{ cf.sslMsg }}</span>
              </div>
            </div>

            <!-- DNS 记录 -->
            <div style="margin-top:16px">
              <label style="display:block;margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)">DNS 记录</label>
              <div class="cf-dns-table">
                <div class="cf-dns-header">
                  <span>类型</span><span>名称</span><span>内容</span><span>代理</span><span></span>
                </div>
                <div v-if="cf.dnsLoading" class="text-muted" style="padding:8px">加载中...</div>
                <div v-else-if="cf.dnsRecords.length === 0" class="text-muted" style="padding:8px">暂无记录</div>
                <div v-for="rec in cf.dnsRecords" :key="rec.id" class="cf-dns-row">
                  <span class="cf-dns-type">{{ rec.type }}</span>
                  <span class="cf-dns-name" :title="rec.name">{{ rec.name }}</span>
                  <span class="cf-dns-content" :title="rec.content">{{ rec.content }}</span>
                  <span>{{ rec.proxied ? 'ON' : 'OFF' }}</span>
                  <button class="btn-dns-delete" type="button" @click="confirmDnsDelete(rec)" title="删除" aria-label="删除 DNS 记录">
                    <AppIcon :name="ICONS.common.close" />
                  </button>
                </div>
              </div>

              <!-- 添加 DNS 记录 -->
              <div class="cf-dns-add">
                <select v-model="cf.newDns.type" class="cf-dns-add-type">
                  <option value="A">A</option>
                  <option value="AAAA">AAAA</option>
                  <option value="CNAME">CNAME</option>
                  <option value="MX">MX</option>
                  <option value="TXT">TXT</option>
                </select>
                <input type="text" v-model="cf.newDns.name" :placeholder="dnsNamePlaceholder" class="cf-dns-add-input" />
                <input type="text" v-model="cf.newDns.content" :placeholder="dnsContentPlaceholder" class="cf-dns-add-input" />
                <label class="cf-dns-add-proxied" :title="'开启后流量经过 Cloudflare CDN 代理，获得 DDoS 防护和缓存加速'">
                  <input type="checkbox" v-model="cf.newDns.proxied" /> CDN 代理
                </label>
                <button class="btn-save" type="button" style="padding:6px 14px;font-size:0.8rem" @click="handleDnsAdd">
                  添加
                </button>
              </div>
              <span v-if="cf.dnsMsg" class="settings-status" :class="{ error: cf.dnsError }" style="display:block;margin-top:6px">
                {{ cf.dnsMsg }}
              </span>
            </div>
          </template>
        </section>

        <div class="form-actions">
          <span v-if="saving" class="settings-status">自动保存中...</span>
          <span v-else-if="statusText" class="settings-status" :class="{ error: statusError }">
            {{ statusText }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { getConfig, updateConfig, getStatus, fetchConfigModels, cfGetStatus, cfSetup, cfListDns, cfAddDns, cfRemoveDns, cfGetSsl, cfSetSsl } from '../api/client'
import type { CfDnsRecord, ConfigModelOption } from '../api/types'
import { useTheme, type ThemeMode } from '../composables/useTheme'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { loadManagementToken, subscribeManagementTokenChange } from '../utils/managementToken'

const emit = defineEmits<{ close: [] }>()

const managementEnabled = ref(false)
const managementReady = ref(false)

let unsubscribeManagementToken: (() => void) | null = null

function refreshManagementState() {
  const token = loadManagementToken().trim()
  managementReady.value = !!token
}

// ============ 主题 ============
const { theme: currentTheme, setTheme } = useTheme()

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: '暗色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
]

const themeHint = computed(() => {
  const hints: Record<ThemeMode, string> = {
    dark: '使用深色背景，适合夜间和低光环境。',
    light: '使用浅色背景，适合日间和明亮环境。',
    system: '自动跟随操作系统的主题偏好设置。',
  }
  return hints[currentTheme.value]
})

const config = reactive({
  systemPrompt: '',
  maxToolRounds: 10,
  stream: true,
})

type TierName = 'primary' | 'secondary' | 'light'

interface TierConfig {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
}

function createEmptyTier(provider = 'gemini'): TierConfig {
  return { provider, apiKey: '', model: '', baseUrl: '' }
}

const tiers = reactive({
  primary: createEmptyTier(),
  secondary: createEmptyTier(),
  light: createEmptyTier(),
})

const tierEnabled = reactive({ secondary: false, light: false })
const tierOpen = reactive({ primary: true, secondary: false, light: false })

/** 初始加载完成前抑制 provider watcher 的副作用 */
let configLoaded = false

/** Provider 默认值，与 src/config/llm.ts DEFAULTS 保持一致 */
const PROVIDER_DEFAULTS: Record<string, { model: string; baseUrl: string }> = {
  'gemini': { model: 'gemini-2.0-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  'openai-compatible': { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  'openai-responses': { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  'claude': { model: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com/v1' },
}

/** 切换 Provider 时自动填充默认值（仅在用户手动操作时生效） */
function watchTierProvider(tier: TierConfig) {
  watch(() => tier.provider, (newProvider, oldProvider) => {
    if (!configLoaded) return
    if (newProvider === oldProvider) return
    const oldDefaults = PROVIDER_DEFAULTS[oldProvider] ?? { model: '', baseUrl: '' }
    const newDefaults = PROVIDER_DEFAULTS[newProvider] ?? { model: '', baseUrl: '' }
    if (!tier.model || tier.model === oldDefaults.model) tier.model = newDefaults.model
    if (!tier.baseUrl || tier.baseUrl === oldDefaults.baseUrl) tier.baseUrl = newDefaults.baseUrl
    if (tier.apiKey.startsWith('****')) tier.apiKey = ''
  })
}
watchTierProvider(tiers.primary)
watchTierProvider(tiers.secondary)
watchTierProvider(tiers.light)

interface TierModelCatalogState {
  loading: boolean
  error: string
  options: ConfigModelOption[]
  baseUrl: string
  usedStoredApiKey: boolean
}

function createTierModelCatalogState(): TierModelCatalogState {
  return {
    loading: false,
    error: '',
    options: [],
    baseUrl: '',
    usedStoredApiKey: false,
  }
}

const modelCatalog = reactive<Record<TierName, TierModelCatalogState>>({
  primary: createTierModelCatalogState(),
  secondary: createTierModelCatalogState(),
  light: createTierModelCatalogState(),
})

function resetTierModelCatalog(tierName: TierName) {
  Object.assign(modelCatalog[tierName], createTierModelCatalogState())
}

function tierKeyHint(apiKey: string): string {
  if (!apiKey) return '未配置 API Key。'
  if (apiKey.startsWith('****')) return '已读取已保存密钥，保持不变则不会覆盖。'
  return '将使用当前输入的密钥保存配置。'
}

function tierModelHint(tierName: TierName): string {
  const state = modelCatalog[tierName]
  if (state.error) return state.error
  if (managementEnabled.value && !managementReady.value) return '管理令牌未解锁，暂时无法拉取模型列表。'
  if (state.options.length > 0) {
    return `已从 ${state.baseUrl} 拉取 ${state.options.length} 个模型${state.usedStoredApiKey ? '（使用已保存 API Key）' : ''}。也可继续手动输入。`
  }
  return '填写 API 地址与 Key 后，可拉取模型列表，也可继续手动输入模型名称。'
}

function normalizeApiKeyForLookup(apiKey: string): string | undefined {
  const trimmed = apiKey.trim()
  if (!trimmed || trimmed.startsWith('****')) return undefined
  return trimmed
}

async function fetchTierModels(tierName: TierName) {
  const tier = tiers[tierName]
  const state = modelCatalog[tierName]

  state.loading = true
  state.error = ''

  try {
    const result = await fetchConfigModels({
      tier: tierName,
      provider: tier.provider,
      baseUrl: tier.baseUrl,
      apiKey: normalizeApiKeyForLookup(tier.apiKey),
    })

    state.options = result.models
    state.baseUrl = result.baseUrl
    state.usedStoredApiKey = result.usedStoredApiKey

    if (result.models.length === 0) {
      state.error = '接口已连接，但没有返回可用模型。你仍可手动输入模型名称。'
      return
    }

    if (!tier.model) {
      tier.model = result.models[0].id
    }
  } catch (err: any) {
    state.error = '拉取失败：' + (err?.message || '未知错误')
  } finally {
    state.loading = false
  }
}

function watchTierModelCatalogInvalidation(tierName: TierName, tier: TierConfig) {
  watch([() => tier.provider, () => tier.baseUrl, () => tier.apiKey], () => {
    resetTierModelCatalog(tierName)
  })
}
watchTierModelCatalogInvalidation('primary', tiers.primary)
watchTierModelCatalogInvalidation('secondary', tiers.secondary)
watchTierModelCatalogInvalidation('light', tiers.light)

const tools = ref<string[]>([])
const statusText = ref('')
const statusError = ref(false)
const saving = ref(false)
const dirty = ref(false)

// ============ MCP ============
interface MCPServerEntry {
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string       // 每行一个参数，保存时转为 string[]
  cwd: string
  url: string
  authHeader: string  // Authorization header 值
  timeout: number
  enabled: boolean
  open: boolean       // UI 展开状态
}

const mcpServers = reactive<MCPServerEntry[]>([])
/** 加载时记录的原始服务器名，用于保存时识别被删除的服务器 */
const mcpOriginalNames = ref<string[]>([])

function addMcpServer() {
  mcpServers.push({
    name: '', transport: 'stdio', command: '', args: '', cwd: '',
    url: '', authHeader: '', timeout: 30000, enabled: true, open: true,
  })
}

function removeMcpServer(idx: number) {
  mcpServers.splice(idx, 1)
}

function sanitizeMcpName(server: MCPServerEntry) {
  server.name = server.name.replace(/[^a-zA-Z0-9_]/g, '_')
}

function buildMCPPayload(): { payload: any; currentNames: string[] } {
  const servers: Record<string, any> = {}
  // 被删除的服务器发送 null（deepMerge 会删除该键）
  for (const name of mcpOriginalNames.value) {
    if (!mcpServers.some(s => s.name === name)) {
      servers[name] = null
    }
  }
  const currentNames: string[] = []
  for (const s of mcpServers) {
    if (!s.name.trim()) continue
    currentNames.push(s.name)
    const entry: any = {
      transport: s.transport,
      enabled: s.enabled,
      timeout: s.timeout || 30000,
    }
    if (s.transport === 'stdio') {
      entry.command = s.command
      entry.args = s.args.split('\n').map((a: string) => a.trim()).filter(Boolean)
      entry.cwd = s.cwd || null  // 空值发 null 让 deepMerge 删除旧值
      entry.url = null
      entry.headers = null
    } else {
      entry.url = s.url
      entry.command = null
      entry.args = null
      entry.cwd = null
      if (s.authHeader && !s.authHeader.startsWith('****')) {
        entry.headers = { Authorization: s.authHeader }
      } else if (!s.authHeader) {
        entry.headers = null
      }
    }
    servers[s.name] = entry
  }

  return {
    payload: Object.keys(servers).length > 0 ? { servers } : null,
    currentNames,
  }
}

// ============ Cloudflare ============
const cf = reactive({
  connected: false,
  configured: false,
  loading: false,
  tokenInput: '',
  error: '',
  zones: [] as { id: string; name: string; status: string }[],
  activeZoneId: null as string | null,
  tokenSource: null as 'inline' | 'env' | 'file' | null,
  // SSL
  sslMode: 'full',
  sslMsg: '',
  sslError: false,
  // DNS
  dnsRecords: [] as CfDnsRecord[],
  dnsLoading: false,
  dnsMsg: '',
  dnsError: false,
  newDns: { type: 'A', name: '', content: '', proxied: true },
})


const streamHint = computed(() => {
  return config.stream
    ? '回复会实时逐字显示，更适合长内容阅读。'
    : '回复会完整生成后一次性返回，更适合稳定复制。'
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    void requestClose()
  }
}

async function requestClose() {
  if (saving.value) return

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  if (dirty.value) {
    await handleSave()
    if (dirty.value || saving.value) return
  }

  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  refreshManagementState()
  unsubscribeManagementToken = subscribeManagementTokenChange(refreshManagementState)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  unsubscribeManagementToken?.()
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
})

// ============ 自动保存 ============
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutoSave() {
  if (!configLoaded) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  dirty.value = true
  autoSaveTimer = setTimeout(() => {
    if (saving.value) {
      scheduleAutoSave()
      return
    }
    handleSave()
  }, 1000)
}

watch(
  [
    () => config.systemPrompt,
    () => config.maxToolRounds,
    () => config.stream,
    () => JSON.stringify(tiers),
    () => JSON.stringify(tierEnabled),
    // 排除 open（纯 UI 状态）
    () => JSON.stringify(mcpServers, (key, value) => key === 'open' ? undefined : value),
  ],
  scheduleAutoSave,
)

/** 从服务端数据加载单个层级配置 */
function loadTierFromData(tier: TierConfig, data: any) {
  if (!data) return
  // 先设 apiKey/model/baseUrl，最后设 provider —— 因为 provider 的 watcher 会检查这些字段
  tier.apiKey = data.apiKey || ''
  tier.model = data.model || ''
  tier.baseUrl = data.baseUrl || ''
  tier.provider = data.provider || 'gemini'
}

onMounted(async () => {
  try {
    refreshManagementState()
    const data = await getConfig()
    const llm = data.llm || {}

    // 支持三层格式和旧扁平格式
    if (llm.primary) {
      loadTierFromData(tiers.primary, llm.primary)
      if (llm.secondary) {
        loadTierFromData(tiers.secondary, llm.secondary)
        tierEnabled.secondary = true
        tierOpen.secondary = true
      }
      if (llm.light) {
        loadTierFromData(tiers.light, llm.light)
        tierEnabled.light = true
        tierOpen.light = true
      }
    } else if (llm.provider) {
      // 旧扁平格式兼容
      loadTierFromData(tiers.primary, llm)
    }

    config.systemPrompt = data.system?.systemPrompt || ''
    config.maxToolRounds = data.system?.maxToolRounds ?? 10
    config.stream = data.system?.stream ?? true

    // MCP
    if (data.mcp?.servers && typeof data.mcp.servers === 'object') {
      mcpOriginalNames.value = Object.keys(data.mcp.servers)
      for (const [name, cfg] of Object.entries(data.mcp.servers) as [string, any][]) {
        mcpServers.push({
          name,
          transport: cfg.transport || 'stdio',
          command: cfg.command || '',
          args: Array.isArray(cfg.args) ? cfg.args.join('\n') : '',
          cwd: cfg.cwd || '',
          url: cfg.url || '',
          authHeader: cfg.headers?.Authorization || '',
          timeout: cfg.timeout ?? 30000,
          enabled: cfg.enabled !== false,
          open: false,
        })
      }
    }

    // 等待 provider watcher 的异步回调执行完毕后再启用副作用
    await nextTick()
    configLoaded = true
    dirty.value = false
  } catch (err: any) {
    configLoaded = true
    statusText.value = '加载配置失败: ' + (err?.message || '未知错误')
    statusError.value = true
    dirty.value = false
  }

  try {
    const status = await getStatus()
    tools.value = status.tools || []
    managementEnabled.value = !!status.managementProtected
  } catch {
    tools.value = []
  }
})

/** 构建单个层级的保存 payload（跳过脱敏 apiKey） */
function buildTierPayload(tier: TierConfig): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: tier.provider,
    model: tier.model,
    baseUrl: tier.baseUrl,
  }
  if (tier.apiKey && !tier.apiKey.startsWith('****')) {
    payload.apiKey = tier.apiKey
  }
  return payload
}

async function handleSave() {
  if (saving.value) return

  saving.value = true
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  statusText.value = ''
  statusError.value = false

  try {
    const llmPayload: Record<string, unknown> = {
      primary: buildTierPayload(tiers.primary),
      // 禁用时显式发送 null，让 deepMerge 删除旧值
      secondary: tierEnabled.secondary ? buildTierPayload(tiers.secondary) : null,
      light: tierEnabled.light ? buildTierPayload(tiers.light) : null,
    }

    const { payload: mcpPayload, currentNames } = buildMCPPayload()
    const payload: Record<string, any> = {
      llm: llmPayload,
      system: {
        systemPrompt: config.systemPrompt,
        maxToolRounds: config.maxToolRounds,
        stream: config.stream,
      },
    }
    if (mcpPayload !== null) {
      payload.mcp = mcpPayload
    }
    const result = await updateConfig(payload)

    if (result.ok) {
      statusText.value = result.restartRequired ? '已保存，需要重启生效' : '已保存并生效'
      statusError.value = false
      mcpOriginalNames.value = currentNames
      dirty.value = false
      // 热重载后刷新工具列表（MCP 开关会影响工具数量）
      try {
        const st = await getStatus()
        tools.value = st.tools || []
      } catch { /* 静默 */ }
    } else {
      statusText.value = '保存失败: ' + (result.error || '未知错误')
      statusError.value = true
      dirty.value = true
    }
  } catch (err: any) {
    statusText.value = '保存失败: ' + err.message
    statusError.value = true
    dirty.value = true
  } finally {
    saving.value = false
  }
}

// ============ Cloudflare 辅助 ============

const sslHints: Record<string, string> = {
  off: '所有连接均不加密，不推荐使用。',
  flexible: '浏览器到 Cloudflare 加密，Cloudflare 到源站不加密。适合源站无证书时临时使用。',
  full: '全程 HTTPS，但不验证源站证书。适合自签名证书场景。',
  strict: '全程 HTTPS 且验证源站证书合法性。推荐生产环境使用。',
}

const dnsNamePlaceholder = computed(() => {
  const m: Record<string, string> = {
    A: '例如：www 或 @ (根域名)',
    AAAA: '例如：www 或 @ (根域名)',
    CNAME: '例如：blog',
    MX: '例如：@ (根域名)',
    TXT: '例如：@ (根域名)',
  }
  return m[cf.newDns.type] || '子域名或 @'
})

const dnsContentPlaceholder = computed(() => {
  const m: Record<string, string> = {
    A: '例如：1.2.3.4 (IPv4 地址)',
    AAAA: '例如：2001:db8::1 (IPv6 地址)',
    CNAME: '例如：example.com',
    MX: '例如：mail.example.com',
    TXT: '例如：v=spf1 include:...',
  }
  return m[cf.newDns.type] || '记录值'
})

// ============ Cloudflare 方法 ============

async function loadCfStatus() {
  try {
    const status = await cfGetStatus()
    cf.configured = status.configured
    cf.error = status.error || ''
    cf.connected = status.connected
    cf.zones = status.zones || []
    cf.activeZoneId = status.activeZoneId
    cf.tokenSource = status.tokenSource || null

    // 多 zone 且未指定时，自动选第一个
    if (!cf.activeZoneId && cf.zones.length > 0) {
      cf.activeZoneId = cf.zones[0].id
    }

    if (status.connected) {
      await Promise.all([loadCfDns(), loadCfSsl()])
    }
  } catch (err: any) {
    cf.connected = false
    cf.error = err?.message || '加载 Cloudflare 状态失败'
  }
}

async function loadCfDns() {
  cf.dnsLoading = true
  try {
    const result = await cfListDns(cf.activeZoneId)
    cf.dnsRecords = result.records || []
  } catch (err: any) {
    cf.dnsMsg = '加载 DNS 记录失败: ' + err.message
    cf.dnsError = true
  } finally {
    cf.dnsLoading = false
  }
}

async function loadCfSsl() {
  try {
    const result = await cfGetSsl(cf.activeZoneId)
    cf.sslMode = result.mode || 'full'
  } catch { /* 静默 */ }
}

async function handleCfSetup() {
  if (!cf.tokenInput.trim()) { cf.error = '请输入 Token'; return }
  cf.loading = true
  cf.error = ''
  try {
    const result = await cfSetup(cf.tokenInput.trim())
    if (result.ok) {
      cf.tokenInput = ''
      await loadCfStatus()
    } else {
      cf.error = result.error || '连接失败'
    }
  } catch (err: any) {
    cf.error = err.message
  } finally {
    cf.loading = false
  }
}

async function handleSslChange() {
  cf.sslMsg = ''
  cf.sslError = false
  try {
    await cfSetSsl(cf.sslMode, cf.activeZoneId)
    cf.sslMsg = 'SSL 模式已更新'
  } catch (err: any) {
    cf.sslMsg = '更新失败: ' + err.message
    cf.sslError = true
  }
}

async function handleDnsAdd() {
  if (!cf.newDns.name || !cf.newDns.content) { cf.dnsMsg = '名称和内容不能为空'; cf.dnsError = true; return }
  cf.dnsMsg = ''
  cf.dnsError = false
  try {
    await cfAddDns({ ...cf.newDns }, cf.activeZoneId)
    cf.newDns.name = ''
    cf.newDns.content = ''
    cf.dnsMsg = '添加成功'
    await loadCfDns()
  } catch (err: any) {
    cf.dnsMsg = '添加失败: ' + err.message
    cf.dnsError = true
  }
}

function confirmDnsDelete(rec: CfDnsRecord) {
  if (!confirm(`确认删除 DNS 记录？\n\n${rec.type}  ${rec.name}  →  ${rec.content}`)) return
  handleDnsDelete(rec.id)
}

async function handleDnsDelete(id: string) {
  cf.dnsMsg = ''
  cf.dnsError = false
  try {
    await cfRemoveDns(id, cf.activeZoneId)
    cf.dnsRecords = cf.dnsRecords.filter(r => r.id !== id)
    cf.dnsMsg = '已删除'
  } catch (err: any) {
    cf.dnsMsg = '删除失败: ' + err.message
    cf.dnsError = true
  }
}

async function handleZoneChange() {
  // 多 zone 场景下切换 zone 后重新加载 DNS 和 SSL
  await Promise.all([loadCfDns(), loadCfSsl()])
}

// 初始化加载 CF 状态
onMounted(() => loadCfStatus())
</script>
