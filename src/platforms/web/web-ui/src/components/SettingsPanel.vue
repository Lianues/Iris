<template>
  <div
    class="overlay"
    @pointerdown.self="handleOverlayPointerDown"
    @pointerup.self="handleOverlayPointerUp"
    @pointercancel.self="resetOverlayCloseIntent"
  >
    <div class="settings-panel" @pointerdown="resetOverlayCloseIntent">
      <div class="settings-header">
        <div class="settings-title-group">
          <span class="settings-kicker">Control Center</span>
          <h2>设置中心</h2>
          <p>配置模型连接、系统策略与工具能力，打造你的 AI 工作台。</p>
          <p v-if="accessProtectionEnabled || accessCredentialHint" class="field-hint" style="margin-top:6px">
            Web 访问保护状态：
            <strong :style="{ color: accessLocked ? 'var(--error)' : 'var(--success)' }">{{ accessStatusText }}</strong>
            <span v-if="accessCredentialHint"> · {{ accessCredentialHint }}</span>
          </p>
        </div>
        <button class="btn-close" type="button" aria-label="关闭设置" @click="requestClose">
          <AppIcon :name="ICONS.common.close" />
        </button>
      </div>

      <div class="settings-body">
        <!-- Agent 配置 header -->
        <Transition name="agent-card">
          <div v-if="editingAgent" key="agent-header" class="agent-config-header">
            <button class="agent-back-btn" type="button" @click="switchEditingAgent(null)">
              <span class="agent-back-arrow">←</span> 返回主配置
            </button>
            <div class="agent-config-title">
              <h3>{{ editingAgent }}</h3>
              <p>配置此 Agent 的独立模型、工具和系统设置。修改会自动保存到 Agent 专属配置。</p>
            </div>
          </div>
        </Transition>

        <div class="settings-section-group">
          <p v-if="!editingAgent" class="section-group-intro">Iris 采用「主模型 + 子代理」协作模式：你在下方注册模型连接，然后为子代理绑定模型。主 AI 遇到复杂任务时会自动委派给对应子代理。</p>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>模型与凭证</h3>
              <p>在这里添加你的 LLM 模型连接。每个模型需要一个名称、提供商、模型 ID 和 API Key。你可以注册多个模型，通过 /model 命令随时切换。</p>
            </div>
            <span class="settings-pill">模型池</span>
          </div>

          <div class="settings-grid two-columns" style="margin-bottom:16px">
            <div class="form-group">
              <label>默认模型</label>
              <AppSelect
                v-model="defaultModelName"
                :options="defaultModelOptions"
                :disabled="defaultModelOptions.length === 0"
                placeholder="请先填写模型名称"
              />
              <p class="field-hint">Iris 启动后默认使用的模型。对话中 /model 加名称可切换。</p>
            </div>
            <div class="form-group" style="display:flex;align-items:flex-end;justify-content:flex-end">
              <button class="btn-save" type="button" @click="addModelEntry">新增模型</button>
            </div>
          </div>

          <div v-for="(entry, index) in modelEntries" :key="entry.uid" class="tier-block">
            <div class="tier-header" @click="entry.open = !entry.open">
              <span class="tier-arrow" :class="{ open: entry.open }"></span>
              <span class="tier-label">{{ entry.modelName || `未命名模型 ${index + 1}` }}</span>
              <span class="tier-desc">{{ providerLabel(entry.provider) }} · {{ entry.modelId || '未填写模型 ID' }}</span>
              <span v-if="defaultModelName === entry.modelName && entry.modelName" class="settings-pill" style="margin-left:auto">默认</span>
              <button
                class="btn-inline-action"
                type="button"
                style="margin-left:8px"
                :disabled="modelEntries.length <= 1"
                @click.stop="removeModelEntry(index)"
              >
                删除
              </button>
            </div>
            <div v-show="entry.open" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>模型名称</label>
                  <input type="text" v-model="entry.modelName" placeholder="例如：gemini_flash" />
                  <p class="field-hint">给模型起个简短别名，对话中用 /model 加这个名称来切换。</p>
                </div>
                <div class="form-group">
                  <label>LLM 提供商</label>
                  <AppSelect
                    v-model="entry.provider"
                    :options="llmProviderOptions"
                    @change="handleModelProviderChange(entry)"
                  />
                </div>
                <div class="form-group">
                  <label>模型 ID</label>
                  <div class="inline-field-actions">
                    <input type="text" v-model="entry.modelId" placeholder="例如：gpt-4o 或 gemini-2.0-flash" />
                    <button
                      class="btn-inline-action"
                      type="button"
                      :disabled="entry.modelCatalog.loading || accessLocked"
                      @click="fetchModelOptions(index)"
                    >
                      {{ entry.modelCatalog.loading ? '拉取中...' : '拉取列表' }}
                    </button>
                  </div>
                  <AppSelect
                    v-if="entry.modelCatalog.options.length > 0"
                    v-model="entry.modelId"
                    class="model-list-select"
                    :options="buildModelCatalogSelectOptions(entry.modelCatalog.options)"
                  />
                  <p class="field-hint" :class="{ 'model-fetch-error': !!entry.modelCatalog.error }">{{ modelCatalogHint(entry) }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API Key</label>
                  <input type="password" v-model="entry.apiKey" placeholder="输入或保留已有密钥" />
                  <p class="field-hint">{{ modelKeyHint(entry) }}</p>
                </div>
                <div class="form-group full-width">
                  <label>API 地址</label>
                  <input type="text" v-model="entry.baseUrl" placeholder="模型服务请求地址" />
                </div>
                <div class="form-group">
                  <label>上下文窗口</label>
                  <input type="number" :value="entry.contextWindow" :placeholder="contextWindowPlaceholder(entry) || '留空使用提供商默认值'" min="1" @input="handleStringNumberInput(entry, 'contextWindow', $event)" />
                  <p class="field-hint">模型上下文窗口大小（token 数）。留空自动使用提供商默认值。</p>
                </div>
                <div class="form-group">
                  <label>视觉能力</label>
                  <AppSelect v-model="entry.supportsVision" :options="visionOptions" />
                  <p class="field-hint">声明模型是否支持图片输入。「自动」时由提供商判断。</p>
                </div>
                <details class="advanced-section full-width">
                  <summary>高级请求选项</summary>
                  <div class="advanced-content">
                    <div class="form-group full-width">
                      <label>自定义请求头</label>
                      <textarea v-model="entry.headers" rows="2" placeholder='{"X-Custom": "value"}'></textarea>
                      <p class="field-hint">附加到每次 API 请求的 HTTP 头，同名时覆盖默认值。</p>
                    </div>
                    <div class="form-group full-width">
                      <label>自定义请求体</label>
                      <textarea v-model="entry.requestBody" rows="2" placeholder='{"temperature": 0.7}'></textarea>
                      <p class="field-hint">额外的请求参数，如 temperature、top_p 等，会合并到每次请求中。</p>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </section>

          <p class="section-group-connector">模型池中的模型可被下方子代理引用 ↓</p>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>子代理类型</h3>
              <p>子代理是主 AI 的"专职助手"。主 AI 遇到复杂任务时，会自动把子任务委派给合适类型的子代理执行。每种子代理有独立的角色、工具权限和模型。</p>
            </div>
            <span class="settings-pill">{{ subAgentEntries.length }} 个类型</span>
          </div>

          <div v-for="(entry, idx) in subAgentEntries" :key="entry.uid" class="tier-block">
            <div class="tier-header" @click="entry.open = !entry.open">
              <span class="tier-arrow" :class="{ open: entry.open }"></span>
              <span class="tier-label">{{ entry.name || '未命名' }}</span>
              <span class="tier-desc">{{ entry.description || '无描述' }} · 模型: {{ entry.modelName || '跟随活动模型' }}</span>
              <button class="btn-mcp-remove" type="button" @click.stop="removeSubAgentEntry(idx)" title="删除子代理类型">
                <AppIcon :name="ICONS.common.close" />
              </button>
            </div>
            <div v-show="entry.open" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>类型名称</label>
                  <input type="text" v-model="entry.name" placeholder="例如：general-purpose" />
                  <p class="field-hint">主 AI 通过这个名称识别子代理类型，建议英文短横线命名。</p>
                </div>
                <div class="form-group">
                  <label>使用模型</label>
                  <AppSelect v-model="entry.modelName" :options="subAgentModelOptions" />
                </div>
                <div class="form-group full-width">
                  <label>描述</label>
                  <input type="text" v-model="entry.description" placeholder="面向主 LLM 的用途说明" />
                  <p class="field-hint">这段描述会展示给主 AI，帮助它判断什么时候使用这个子代理。</p>
                </div>
                <div class="form-group full-width">
                  <label>系统提示词</label>
                  <textarea v-model="entry.systemPrompt" rows="4" placeholder="子代理的系统提示词"></textarea>
                  <p class="field-hint">定义子代理的角色和行为准则。</p>
                </div>
                <div class="form-group">
                  <label>工具策略</label>
                  <AppSelect v-model="entry.toolMode" :options="subAgentToolModeOptions" />
                  <p class="field-hint">控制子代理能使用哪些工具。</p>
                </div>
                <div class="form-group">
                  <label>最大工具轮次</label>
                  <input
                    type="number"
                    :value="entry.maxToolRoundsInput"
                    min="1"
                    max="999"
                    @input="handleSubAgentMaxToolRoundsInput(entry, $event)"
                    @blur="syncSubAgentMaxToolRoundsInput(entry)"
                  />
                  <p class="field-hint">子代理连续使用工具的上限。到达后停止并返回结果。</p>
                </div>
                <div class="form-group full-width" v-if="entry.toolMode !== 'all'">
                  <label>{{ entry.toolMode === 'allowed' ? '工具白名单' : '工具黑名单' }}（每行一个）</label>
                  <textarea v-model="entry.toolList" rows="3" placeholder="read_file&#10;shell&#10;..."></textarea>
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">并行调度</span>
                    <p class="field-hint">开启后主 AI 可同时派出多个此类型子代理并行工作，适合互不依赖的子任务。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="entry.parallel" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div v-if="subAgentEntries.length === 0" class="empty-state-block">
            <p>还没有配置任何子代理类型。子代理可以帮助主 AI 并行处理复杂任务。</p>
            <button class="btn-save" type="button" @click="loadBuiltinSubAgentDefaults">加载内置默认配置</button>
          </div>

          <button class="btn-mcp-add" type="button" @click="addSubAgentEntry">+ 新增子代理类型</button>
        </section>
        </div>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>系统行为</h3>
              <p>控制 Iris 的基础行为：系统提示词定义默认角色与风格；工具轮次限制连续调用工具的最大次数；流式输出决定回复是逐字显示还是一次性返回。</p>
            </div>
            <span class="settings-pill">基础</span>
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
              <input
                type="number"
                :value="maxToolRoundsInput"
                min="1"
                max="50"
                @input="handleMaxToolRoundsInput"
                @blur="syncMaxToolRoundsInput"
              />
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
              <p>MCP 让你连接外部工具服务器。连接后，服务器提供的工具会自动出现在 AI 的能力列表中。</p>
            </div>
            <span class="settings-pill">{{ mcpServers.length }} 个服务器</span>
          </div>

          <div v-for="(server, idx) in mcpServers" :key="idx" class="tier-block">
            <div class="tier-header" @click="server.open = !server.open">
              <span class="tier-arrow" :class="{ open: server.open }"></span>
              <span class="tier-label">{{ server.name || '未命名' }}</span>
              <span class="tier-desc">{{ transportLabel(server.transport) }}</span>
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
                  <input
                    type="text" v-model="server.name" placeholder="仅字母、数字、下划线"
                    @input="sanitizeMcpName(server)"
                  />
                </div>
                <div class="form-group">
                  <label>传输方式</label>
                  <AppSelect
                    v-model="server.transport"
                    :options="mcpTransportOptions"
                  />
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
                    <textarea
                      v-model="server.args" rows="3"
                      placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"
                    ></textarea>
                  </div>
                </template>

                <template v-if="server.transport !== 'stdio'">
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
                  <input
                    type="number"
                    :value="server.timeoutInput"
                    min="1000"
                    max="120000"
                    @input="handleMcpTimeoutInput(server, $event)"
                    @blur="syncMcpTimeoutInput(server)"
                  />
                </div>
              </div>
            </div>
          </div>

          <button class="btn-mcp-add" type="button" @click="addMcpServer">+ 添加 MCP 服务器</button>
        </section>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>模式</h3>
              <p>模式让你为不同场景预设一套提示词和工具策略。例如 code 模式可限制只用代码相关工具。对话中 /mode 切换即生效。</p>
            </div>
            <span class="settings-pill">{{ modeEntries.length }} 个模式</span>
          </div>

          <div v-for="(entry, idx) in modeEntries" :key="entry.uid" class="tier-block">
            <div class="tier-header" @click="entry.open = !entry.open">
              <span class="tier-arrow" :class="{ open: entry.open }"></span>
              <span class="tier-label">{{ entry.name || '未命名' }}</span>
              <span class="tier-desc">{{ entry.description || '无描述' }}</span>
              <button class="btn-mcp-remove" type="button" @click.stop="removeModeEntry(idx)" title="删除模式">
                <AppIcon :name="ICONS.common.close" />
              </button>
            </div>
            <div v-show="entry.open" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group full-width">
                  <label>模式名称</label>
                  <input type="text" v-model="entry.name" placeholder="例如：code" />
                  <p class="field-hint">名称「normal」为保留名称，不可使用。</p>
                </div>
                <div class="form-group full-width">
                  <label>描述（可选）</label>
                  <input type="text" v-model="entry.description" placeholder="模式用途说明" />
                </div>
                <div class="form-group full-width">
                  <label>系统提示词（可选）</label>
                  <textarea v-model="entry.systemPrompt" rows="4" placeholder="覆盖默认系统提示词"></textarea>
                </div>
                <div class="form-group">
                  <label>工具策略</label>
                  <AppSelect v-model="entry.toolMode" :options="modeToolModeOptions" />
                </div>
                <div class="form-group full-width" v-if="entry.toolMode !== 'all'">
                  <label>{{ entry.toolMode === 'include' ? '工具白名单' : '工具黑名单' }}（每行一个）</label>
                  <textarea v-model="entry.toolList" rows="3" placeholder="read_file&#10;memory_search&#10;..."></textarea>
                </div>
              </div>
            </div>
          </div>

          <button class="btn-mcp-add" type="button" @click="addModeEntry">+ 新增模式</button>
        </section>

        <!-- Plugins -->
        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>插件</h3>
              <p>管理已安装的插件。插件可以扩展工具、模式和钩子。</p>
            </div>
            <span class="settings-pill">{{ pluginEntries.length }} 个插件</span>
          </div>

          <div v-for="(entry, idx) in pluginEntries" :key="entry.uid" class="tier-block">
            <div class="tier-header" @click="entry.open = !entry.open">
              <span class="tier-arrow" :class="{ open: entry.open }"></span>
              <span class="tier-label">{{ entry.name || '未命名' }}</span>
              <span class="tier-desc">{{ entry.type }}</span>
              <label class="toggle-switch" @click.stop>
                <input type="checkbox" v-model="entry.enabled" />
                <span class="toggle-slider"></span>
              </label>
              <button class="btn-mcp-remove" type="button" @click.stop="removePluginEntry(idx)" title="删除插件">
                <AppIcon :name="ICONS.common.close" />
              </button>
            </div>
            <div v-show="entry.open" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group full-width">
                  <label>插件名称</label>
                  <input type="text" v-model="entry.name" placeholder="插件名称" />
                  <p class="field-hint">本地插件对应 ~/.iris/plugins/ 下的目录名，npm 插件对应包名后缀（iris-plugin-xxx）。</p>
                </div>
                <div class="form-group">
                  <label>类型</label>
                  <select v-model="entry.type">
                    <option value="local">本地 (local)</option>
                    <option value="npm">npm</option>
                  </select>
                </div>
                <div class="form-group full-width">
                  <label>配置 (JSON)</label>
                  <textarea v-model="entry.config" rows="4" placeholder='{"apiKey": "..."}' />
                  <p class="field-hint">可选的插件配置参数，会覆盖插件自身的 config.yaml。</p>
                </div>
              </div>
            </div>
          </div>

          <button class="btn-mcp-add" type="button" @click="addPluginEntry">+ 新增插件</button>
        </section>

        <!-- Computer Use -->
        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>Computer Use</h3>
              <p>启用浏览器或桌面自动化能力，让 AI 可以操作屏幕完成复杂任务。</p>
              <p class="field-hint" style="margin-top:4px;color:var(--warning, orange)">修改后需要重启才能生效。</p>
            </div>
            <span class="settings-pill">{{ computerUse.enabled ? '已启用' : '已关闭' }}</span>
          </div>

          <div class="settings-switch-row">
            <div>
              <span class="switch-label">启用 Computer Use</span>
              <p class="field-hint">开启后 AI 将能使用浏览器或桌面截图与操作工具。</p>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="computerUse.enabled" />
              <span class="toggle-switch-ui"></span>
            </label>
          </div>

          <template v-if="computerUse.enabled">
            <div class="settings-grid two-columns" style="margin-top:12px">
              <div class="form-group">
                <label>执行环境</label>
                <AppSelect v-model="computerUse.environment" :options="cuEnvironmentOptions" />
                <p class="field-hint">browser 使用 Playwright 浏览器；screen 使用系统桌面截图与鼠标键盘。</p>
              </div>
              <div class="form-group">
                <label>截图格式</label>
                <AppSelect v-model="computerUse.screenshotFormat" :options="cuScreenshotFormatOptions" />
              </div>
              <div class="form-group">
                <label>视口宽度</label>
                <input type="number" :value="computerUse.screenWidth" placeholder="1440" min="100" @input="handleStringNumberInput(computerUse, 'screenWidth', $event)" />
              </div>
              <div class="form-group">
                <label>视口高度</label>
                <input type="number" :value="computerUse.screenHeight" placeholder="900" min="100" @input="handleStringNumberInput(computerUse, 'screenHeight', $event)" />
              </div>
              <div class="form-group">
                <label>截图质量</label>
                <input type="number" :value="computerUse.screenshotQuality" placeholder="仅 JPEG 格式有效 (1-100)" min="1" max="100" @input="handleStringNumberInput(computerUse, 'screenshotQuality', $event)" />
              </div>
              <div class="form-group">
                <label>保留截图轮次</label>
                <input type="number" :value="computerUse.maxRecentScreenshots" placeholder="3" min="1" @input="handleStringNumberInput(computerUse, 'maxRecentScreenshots', $event)" />
              </div>
              <div class="form-group">
                <label>操作后延迟（ms）</label>
                <input type="number" :value="computerUse.postActionDelay" placeholder="无延迟" min="0" @input="handleStringNumberInput(computerUse, 'postActionDelay', $event)" />
              </div>
            </div>

            <!-- browser 环境特有字段 -->
            <template v-if="computerUse.environment === 'browser'">
              <label class="settings-sub-label" style="margin-top:16px">浏览器环境设置</label>
              <div class="settings-grid two-columns">
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">无头模式</span>
                    <p class="field-hint">不弹出浏览器窗口，在后台运行。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="computerUse.headless" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">高亮鼠标指针</span>
                    <p class="field-hint">在截图中标记鼠标位置。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="computerUse.highlightMouse" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
                <div class="form-group full-width">
                  <label>初始 URL</label>
                  <input type="text" v-model="computerUse.initialUrl" placeholder="https://example.com" />
                  <p class="field-hint">浏览器启动时打开的页面。</p>
                </div>
                <div class="form-group full-width">
                  <label>搜索引擎 URL</label>
                  <input type="text" v-model="computerUse.searchEngineUrl" placeholder="https://www.google.com/search?q=" />
                </div>
              </div>
            </template>

            <!-- screen 环境特有字段 -->
            <template v-if="computerUse.environment === 'screen'">
              <label class="settings-sub-label" style="margin-top:16px">桌面环境设置</label>
              <div class="settings-grid two-columns">
                <div class="form-group full-width">
                  <label>目标窗口标题</label>
                  <input type="text" v-model="computerUse.targetWindow" placeholder="子字符串匹配（可选）" />
                  <p class="field-hint">指定后仅截取包含该标题的窗口。</p>
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">后台模式</span>
                    <p class="field-hint">不将窗口置于前台。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="computerUse.backgroundMode" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
              </div>
            </template>

            <!-- 环境工具策略 -->
            <div class="tier-block" style="margin-top:16px">
              <div class="tier-header" @click="cuToolPolicyOpen = !cuToolPolicyOpen">
                <span class="tier-arrow" :class="{ open: cuToolPolicyOpen }"></span>
                <span class="tier-label">环境工具策略</span>
                <span class="tier-desc">控制不同环境下可用的工具</span>
              </div>
              <div v-show="cuToolPolicyOpen" class="tier-body">
                <div v-for="envKey in cuEnvToolKeys" :key="envKey.key" style="margin-bottom:16px">
                  <label class="settings-sub-label">{{ envKey.label }}</label>
                  <div class="settings-grid two-columns">
                    <div class="form-group">
                      <label>工具策略</label>
                      <AppSelect v-model="computerUse[envKey.modeKey]" :options="cuToolModeOptions" />
                    </div>
                    <div class="form-group full-width" v-if="computerUse[envKey.modeKey] !== 'all'">
                      <label>{{ computerUse[envKey.modeKey] === 'include' ? '工具白名单' : '工具黑名单' }}（每行一个）</label>
                      <textarea v-model="computerUse[envKey.listKey]" rows="3" placeholder="computer_screenshot&#10;computer_click&#10;..."></textarea>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </section>

        <!-- 平台配置 -->
        <section v-if="!editingAgent" class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>平台配置</h3>
              <p>配置 Iris 运行在哪些平台上，以及各平台的连接凭证。</p>
              <p class="field-hint" style="margin-top:4px;color:var(--warning, orange)">修改后需要重启才能生效。</p>
            </div>
            <span class="settings-pill">{{ platformConfig.types.length }} 个平台</span>
          </div>

          <div class="form-group" style="margin-bottom:16px">
            <label>启动平台</label>
            <div class="platform-checkbox-group">
              <label v-for="pt in platformTypeOptions" :key="pt.value" class="platform-checkbox">
                <input type="checkbox" :value="pt.value" v-model="platformConfig.types" />
                {{ pt.label }}
              </label>
            </div>
            <p class="field-hint">勾选后对应平台会在启动时激活。</p>
          </div>

          <!-- Web -->
          <div class="tier-block">
            <div class="tier-header" @click="platformOpen.web = !platformOpen.web">
              <span class="tier-arrow" :class="{ open: platformOpen.web }"></span>
              <span class="tier-label">Web</span>
              <span class="tier-desc">Web GUI 端口、鉴权</span>
            </div>
            <div v-show="platformOpen.web" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>端口</label>
                  <input type="number" :value="platformConfig.web.port" placeholder="3000" min="1" max="65535" @input="handleStringNumberInput(platformConfig.web, 'port', $event)" />
                </div>
                <div class="form-group">
                  <label>主机</label>
                  <input type="text" v-model="platformConfig.web.host" placeholder="0.0.0.0" />
                </div>
                <div class="form-group full-width">
                  <label>API 访问令牌</label>
                  <input type="password" v-model="platformConfig.web.authToken" placeholder="可选" />
                  <p v-if="platformConfig.web.authToken.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                </div>
                <div class="form-group full-width">
                  <label>管理令牌</label>
                  <input type="password" v-model="platformConfig.web.managementToken" placeholder="可选" />
                  <p v-if="platformConfig.web.managementToken.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Discord -->
          <div class="tier-block">
            <div class="tier-header" @click="platformOpen.discord = !platformOpen.discord">
              <span class="tier-arrow" :class="{ open: platformOpen.discord }"></span>
              <span class="tier-label">Discord</span>
              <span class="tier-desc">Discord Bot</span>
            </div>
            <div v-show="platformOpen.discord" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group full-width">
                  <label>Bot Token</label>
                  <input type="password" v-model="platformConfig.discord.token" placeholder="Discord Bot Token" />
                  <p v-if="platformConfig.discord.token.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Telegram -->
          <div class="tier-block">
            <div class="tier-header" @click="platformOpen.telegram = !platformOpen.telegram">
              <span class="tier-arrow" :class="{ open: platformOpen.telegram }"></span>
              <span class="tier-label">Telegram</span>
              <span class="tier-desc">Telegram Bot</span>
            </div>
            <div v-show="platformOpen.telegram" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group full-width">
                  <label>Bot Token</label>
                  <input type="password" v-model="platformConfig.telegram.token" placeholder="Telegram Bot Token" />
                  <p v-if="platformConfig.telegram.token.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">展示工具状态</span>
                    <p class="field-hint">在消息中显示工具调用状态。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="platformConfig.telegram.showToolStatus" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">群聊需 @ 触发</span>
                    <p class="field-hint">在群组中必须 @ 机器人才会回复。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="platformConfig.telegram.groupMentionRequired" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- 企业微信 -->
          <div class="tier-block">
            <div class="tier-header" @click="platformOpen.wxwork = !platformOpen.wxwork">
              <span class="tier-arrow" :class="{ open: platformOpen.wxwork }"></span>
              <span class="tier-label">企业微信</span>
              <span class="tier-desc">企业微信机器人</span>
            </div>
            <div v-show="platformOpen.wxwork" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>Bot ID</label>
                  <input type="text" v-model="platformConfig.wxwork.botId" placeholder="企业微信机器人 ID" />
                </div>
                <div class="form-group">
                  <label>Secret</label>
                  <input type="password" v-model="platformConfig.wxwork.secret" placeholder="企业微信 Secret" />
                  <p v-if="platformConfig.wxwork.secret.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">展示工具状态</span>
                    <p class="field-hint">在消息中显示工具调用状态。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="platformConfig.wxwork.showToolStatus" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- 飞书 -->
          <div class="tier-block">
            <div class="tier-header" @click="platformOpen.lark = !platformOpen.lark">
              <span class="tier-arrow" :class="{ open: platformOpen.lark }"></span>
              <span class="tier-label">飞书</span>
              <span class="tier-desc">飞书机器人</span>
            </div>
            <div v-show="platformOpen.lark" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group">
                  <label>App ID</label>
                  <input type="text" v-model="platformConfig.lark.appId" placeholder="飞书应用 App ID" />
                </div>
                <div class="form-group">
                  <label>App Secret</label>
                  <input type="password" v-model="platformConfig.lark.appSecret" placeholder="飞书应用 App Secret" />
                  <p v-if="platformConfig.lark.appSecret.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                </div>
                <div class="form-group">
                  <label>Verification Token</label>
                  <input type="text" v-model="platformConfig.lark.verificationToken" placeholder="事件回调验证 Token（可选）" />
                </div>
                <div class="form-group">
                  <label>Encrypt Key</label>
                  <input type="text" v-model="platformConfig.lark.encryptKey" placeholder="事件回调加密 Key（可选）" />
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">展示工具状态</span>
                    <p class="field-hint">在消息中显示工具调用状态。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="platformConfig.lark.showToolStatus" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- QQ -->
          <div class="tier-block">
            <div class="tier-header" @click="platformOpen.qq = !platformOpen.qq">
              <span class="tier-arrow" :class="{ open: platformOpen.qq }"></span>
              <span class="tier-label">QQ</span>
              <span class="tier-desc">QQ 机器人（OneBot）</span>
            </div>
            <div v-show="platformOpen.qq" class="tier-body">
              <div class="settings-grid two-columns">
                <div class="form-group full-width">
                  <label>WebSocket URL</label>
                  <input type="text" v-model="platformConfig.qq.wsUrl" placeholder="ws://127.0.0.1:8080" />
                </div>
                <div class="form-group">
                  <label>Access Token</label>
                  <input type="password" v-model="platformConfig.qq.accessToken" placeholder="OneBot Access Token（可选）" />
                  <p v-if="platformConfig.qq.accessToken.startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                </div>
                <div class="form-group">
                  <label>Self ID</label>
                  <input type="text" v-model="platformConfig.qq.selfId" placeholder="机器人 QQ 号" />
                </div>
                <div class="form-group">
                  <label>群聊模式</label>
                  <AppSelect v-model="platformConfig.qq.groupMode" :options="qqGroupModeOptions" />
                  <p class="field-hint">at=需要@触发，all=所有消息触发，off=不响应群聊。</p>
                </div>
                <div class="settings-switch-row">
                  <div>
                    <span class="switch-label">展示工具状态</span>
                    <p class="field-hint">在消息中显示工具调用状态。</p>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="platformConfig.qq.showToolStatus" />
                    <span class="toggle-switch-ui"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>工具状态</h3>
              <p>当前 AI 可使用的所有工具（含内置和 MCP 提供的）。点击可切换启用/禁用。</p>
            </div>
            <span class="settings-pill">{{ tools.length - disabledTools.size }} / {{ tools.length }} 启用</span>
          </div>

          <div class="tools-list">
            <span
              v-for="tool in tools"
              :key="tool"
              class="tool-tag"
              :class="{ disabled: disabledTools.has(tool) }"
              @click="toggleTool(tool)"
            >{{ tool }}</span>
            <span v-if="tools.length === 0" class="text-muted">无已注册工具</span>
          </div>
        </section>

        <!-- 多 Agent 管理 -->
        <section v-if="!editingAgent" class="settings-section">
          <div class="settings-section-head">
            <div>
              <h3>多 Agent 管理</h3>
              <p>配置和管理多个独立的 AI Agent，每个 Agent 拥有独立的模型、工具和会话。</p>
            </div>
            <span v-if="agentStatus.agents.length > 0" class="settings-pill">{{ agentStatus.agents.length }} 个 Agent</span>
          </div>

          <div v-if="!agentStatus.exists" class="settings-agent-empty">
            <p>未找到 Agent 配置文件。</p>
            <p class="text-muted" style="margin-bottom:12px">配置文件路径：<code>{{ agentStatus.manifestPath }}</code></p>
            <button class="btn-primary" type="button" @click="handleInitAgentManifest">初始化多 Agent 系统</button>
          </div>

          <template v-else>
            <div class="form-row">
              <label class="form-label">多 Agent 模式</label>
              <div class="form-field">
                <label class="toggle-switch">
                  <input type="checkbox" :checked="agentStatus.enabled" @change="handleToggleAgent">
                  <span class="toggle-track"></span>
                </label>
                <span class="form-hint">{{ agentStatus.enabled ? '已启用 — 重启后生效' : '未启用' }}</span>
              </div>
            </div>

            <div v-if="agentStatus.agents.length > 0" class="settings-agent-list">
              <div class="settings-agent-list-label">已定义的 Agent</div>
              <div
                v-for="agent in agentStatus.agents"
                :key="agent.name"
                class="settings-agent-card"
              >
                <div class="settings-agent-card-icon">
                  <AppIcon :name="ICONS.sidebar.chat" />
                </div>
                <div class="settings-agent-card-copy">
                  <strong>{{ agent.name }}</strong>
                  <span v-if="agent.description" class="text-muted">{{ agent.description }}</span>
                </div>
                <div class="settings-agent-card-actions">
                  <button class="btn-small" type="button" @click="switchEditingAgent(agent.name)">编辑配置</button>
                  <button class="btn-small btn-danger" type="button" @click="handleDeleteAgent(agent.name)">删除</button>
                </div>
              </div>
            </div>

            <div v-else class="settings-agent-empty">
              <p class="text-muted">尚未定义任何 Agent，点击下方按钮添加。</p>
            </div>

            <!-- 添加 Agent -->
            <div class="agent-add-form">
              <input v-model="newAgentName" type="text" placeholder="Agent 名称（英文、数字、下划线）" class="agent-add-input" />
              <input v-model="newAgentDesc" type="text" placeholder="描述（可选）" class="agent-add-input" />
              <button class="btn-primary" type="button" :disabled="!newAgentName.trim()" @click="handleCreateAgent">添加 Agent</button>
            </div>
            <p class="field-hint">添加后可点击「编辑配置」为 Agent 设置独立的模型、工具、系统提示等。</p>
          </template>
        </section>

        <!-- 危险区域 -->
        <section v-if="!editingAgent" class="settings-section settings-danger-zone">
          <div class="settings-section-head">
            <div>
              <h3>危险区域</h3>
              <p>不可逆操作，请谨慎使用。</p>
            </div>
          </div>

          <div class="settings-danger-item">
            <div class="settings-danger-info">
              <strong>重置所有配置</strong>
              <span>将所有配置文件恢复为默认模板。当前的 API 密钥、模型、MCP 等设置将丢失。</span>
            </div>
            <button
              class="settings-danger-btn"
              type="button"
              :disabled="resetPending"
              @click="handleResetConfig"
            >
              {{ resetPending ? '重置中...' : '重置配置' }}
            </button>
          </div>

        </section>

        <!-- Cloudflare 管理 -->
        <section v-if="!editingAgent" class="settings-section">
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
                <strong style="color:var(--text-secondary)">快速开始：</strong><br />
                1. 打开
                <a
                  href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener"
                  style="color:var(--accent-cyan, var(--accent));text-decoration:underline"
                >
                  Cloudflare API Tokens 页面
                </a>，点击 "Create Token"<br />
                2. 选择 "Edit zone DNS" 模板，或自定义权限：<br />
                <span style="padding-left:1.2em;display:inline-block">
                  Zone &gt; Zone &gt; Read，Zone &gt; DNS &gt; Edit，Zone &gt; Zone Settings &gt; Edit
                </span><br />
                3. 将生成的 Token 粘贴到下方
              </p>
            </div>
            <div class="form-group full-width">
              <label>API Token</label>
              <input type="password" v-model="cf.tokenInput" placeholder="以 Bearer token 格式，例如 xyzABC123..." />
            </div>
            <div class="form-group full-width" style="display:flex;align-items:center;gap:12px">
              <button class="btn-save" type="button" :disabled="cf.loading || accessLocked" @click="handleCfSetup">
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
              <AppSelect
                v-model="cf.activeZoneId"
                :options="buildZoneSelectOptions(cf.zones)"
                :disabled="cf.sslSaving || accessLocked"
                @change="handleZoneChange"
              />
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
                <AppSelect
                  v-model="cf.sslMode"
                  :options="cloudflareSslOptions"
                  :disabled="cf.sslLoading || cf.sslSaving || accessLocked"
                  @change="handleSslChange"
                />
                <p class="field-hint">{{ cf.sslSaving ? '正在保存 SSL 模式...' : (cf.sslLoading ? '正在读取当前 SSL 模式...' : (sslHints[cf.sslMode] || '')) }}</p>
                <p v-if="!cf.sslLoading && (cf.sslMode === 'full' || cf.sslMode === 'strict')" class="field-hint" style="margin-top:4px;color:var(--accent-cyan, var(--accent))">
                  需要 Nginx 开启 HTTPS（443 端口 + SSL 证书），否则 CF 到源站连接会失败（521/525）。
                </p>
                <p v-if="!cf.sslLoading && cf.sslMode === 'flexible'" class="field-hint" style="margin-top:4px;color:var(--accent-cyan, var(--accent))">
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
                  <button class="btn-dns-delete" type="button" :disabled="accessLocked || cf.dnsSaving || cf.dnsDeletingId === rec.id" @click="confirmDnsDelete(rec)" title="删除" aria-label="删除 DNS 记录">
                    <AppIcon :name="ICONS.common.close" />
                  </button>
                </div>
              </div>

              <!-- 添加 DNS 记录 -->
              <div class="cf-dns-add">
                <AppSelect
                  v-model="cf.newDns.type"
                  class="cf-dns-add-type"
                  size="sm"
                  :options="dnsTypeOptions"
                />
                <input type="text" v-model="cf.newDns.name" :placeholder="dnsNamePlaceholder" class="cf-dns-add-input" />
                <input type="text" v-model="cf.newDns.content" :placeholder="dnsContentPlaceholder" class="cf-dns-add-input" />
                <label class="cf-dns-add-proxied" :title="'开启后流量经过 Cloudflare CDN 代理，获得 DDoS 防护和缓存加速'">
                  <input type="checkbox" v-model="cf.newDns.proxied" :disabled="!dnsProxySupported" /> CDN 代理
                </label>
                <button class="btn-save" type="button" :disabled="accessLocked || cf.dnsSaving || !!cf.dnsDeletingId || cf.dnsLoading" style="padding:6px 14px;font-size:0.8rem" @click="handleDnsAdd">
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
import { ref, reactive, Transition } from 'vue'
import AppIcon from './AppIcon.vue'
import AppSelect from './AppSelect.vue'
import { ICONS } from '../constants/icons'
import { useSettingsPanel } from '../features/settings/useSettingsPanel'

const llmProviderOptions = [
  { value: 'gemini', label: 'Gemini', description: 'Google AI Studio / Vertex AI' },
  { value: 'openai-compatible', label: 'OpenAI 兼容', description: '任何兼容 OpenAI Chat Completions 的 API' },
  { value: 'openai-responses', label: 'OpenAI Responses', description: 'OpenAI Responses API 格式' },
  { value: 'claude', label: 'Claude', description: 'Anthropic 官方 API' },
]

const mcpTransportOptions = [
  { value: 'stdio', label: 'stdio', description: '本地进程调用' },
  { value: 'sse', label: 'sse', description: '远程事件流' },
  { value: 'streamable-http', label: 'streamable-http', description: '远程 HTTP 连接' },
]

const cloudflareSslOptions = [
  { value: 'unknown', label: 'Unknown', description: '无法读取当前状态', disabled: true },
  { value: 'off', label: 'Off', description: '不加密' },
  { value: 'flexible', label: 'Flexible', description: '浏览器到 Cloudflare 加密' },
  { value: 'full', label: 'Full', description: '全程加密，不验证源站证书' },
  { value: 'strict', label: 'Full (Strict)', description: '全程加密，并验证源站证书' },
]

const dnsTypeOptions = [
  { value: 'A', label: 'A', description: 'IPv4' },
  { value: 'AAAA', label: 'AAAA', description: 'IPv6' },
  { value: 'CNAME', label: 'CNAME', description: '别名' },
  { value: 'MX', label: 'MX', description: '邮件' },
  { value: 'TXT', label: 'TXT', description: '文本' },
]

const subAgentToolModeOptions = [
  { value: 'all', label: '全部工具', description: '不限制工具使用' },
  { value: 'allowed', label: '白名单', description: '仅允许指定工具' },
  { value: 'excluded', label: '黑名单', description: '排除指定工具' },
]

const modeToolModeOptions = [
  { value: 'all', label: '全部工具', description: '不限制工具使用' },
  { value: 'include', label: '白名单', description: '仅允许指定工具' },
  { value: 'exclude', label: '黑名单', description: '排除指定工具' },
]

const visionOptions = [
  { value: 'auto', label: '自动', description: '由提供商判断' },
  { value: 'yes', label: '支持', description: '显式声明支持图片输入' },
  { value: 'no', label: '不支持', description: '显式声明不支持图片输入' },
]

const cuEnvironmentOptions = [
  { value: 'browser', label: 'Browser', description: '使用 Playwright 浏览器' },
  { value: 'screen', label: 'Screen', description: '使用系统桌面截图与鼠标键盘' },
]

const cuScreenshotFormatOptions = [
  { value: 'png', label: 'PNG', description: '无损格式' },
  { value: 'jpeg', label: 'JPEG', description: '有损压缩，体积更小' },
]

const cuToolModeOptions = [
  { value: 'all', label: '全部工具', description: '不限制' },
  { value: 'include', label: '白名单', description: '仅允许指定工具' },
  { value: 'exclude', label: '黑名单', description: '排除指定工具' },
]

const cuEnvToolKeys = [
  { key: 'browser', label: 'Browser 环境', modeKey: 'envToolBrowserMode' as const, listKey: 'envToolBrowserList' as const },
  { key: 'screen', label: 'Screen 环境', modeKey: 'envToolScreenMode' as const, listKey: 'envToolScreenList' as const },
  { key: 'background', label: 'Background 环境', modeKey: 'envToolBackgroundMode' as const, listKey: 'envToolBackgroundList' as const },
]

const cuToolPolicyOpen = ref(false)

const platformTypeOptions = [
  { value: 'console', label: 'Console' },
  { value: 'web', label: 'Web' },
  { value: 'discord', label: 'Discord' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'wxwork', label: '企业微信' },
  { value: 'lark', label: '飞书' },
  { value: 'qq', label: 'QQ' },
]

const platformOpen = reactive({
  web: false,
  discord: false,
  telegram: false,
  wxwork: false,
  lark: false,
  qq: false,
})

const qqGroupModeOptions = [
  { value: 'at', label: '@ 触发', description: '群聊中需要 @ 机器人' },
  { value: 'all', label: '全部消息', description: '响应群内所有消息' },
  { value: 'off', label: '关闭', description: '不响应群聊消息' },
]

function buildModelCatalogSelectOptions(options: Array<{ id: string; label: string }>) {
  return [
    {
      value: '',
      label: '选择已发现的模型',
      description: '也可继续手动输入模型 ID',
    },
    ...options.map((option) => ({
      value: option.id,
      label: option.label,
    })),
  ]
}

function buildZoneSelectOptions(zones: Array<{ id: string; name: string; status: string }>) {
  return zones.map((zone) => ({
    value: zone.id,
    label: zone.name,
    description: zone.status,
  }))
}

const emit = defineEmits<{ close: [] }>()

const {
  currentTheme,
  setTheme,
  themeOptions,
  themeHint,
  accessProtectionEnabled,
  accessLocked,
  accessStatusText,
  accessCredentialHint,
  config,
  maxToolRoundsInput,
  handleMaxToolRoundsInput,
  syncMaxToolRoundsInput,
  defaultModelName,
  defaultModelOptions,
  modelEntries,
  providerLabel,
  addModelEntry,
  removeModelEntry,
  transportLabel,
  handleModelProviderChange,
  fetchModelOptions,
  modelCatalogHint,
  modelKeyHint,
  tools,
  disabledTools,
  toggleTool,
  statusText,
  statusError,
  saving,
  mcpServers,
  addMcpServer,
  removeMcpServer,
  syncMcpTimeoutInput,
  handleMcpTimeoutInput,
  sanitizeMcpName,
  subAgentEntries,
  subAgentModelOptions,
  addSubAgentEntry,
  removeSubAgentEntry,
  loadBuiltinSubAgentDefaults,
  handleSubAgentMaxToolRoundsInput,
  syncSubAgentMaxToolRoundsInput,
  modeEntries,
  addModeEntry,
  removeModeEntry,
  pluginEntries,
  addPluginEntry,
  removePluginEntry,
  computerUse,
  platformConfig,
  contextWindowPlaceholder,
  handleStringNumberInput,
  cf,
  streamHint,
  resetOverlayCloseIntent,
  handleOverlayPointerDown,
  handleOverlayPointerUp,
  requestClose,
  sslHints,
  dnsNamePlaceholder,
  dnsContentPlaceholder,
  dnsProxySupported,
  handleCfSetup,
  handleSslChange,
  handleDnsAdd,
  confirmDnsDelete,
  handleZoneChange,
  handleResetConfig,
  resetPending,
  agentStatus,
  handleToggleAgent,
  editingAgent,
  switchEditingAgent,
  handleInitAgentManifest,
  newAgentName,
  newAgentDesc,
  handleCreateAgent,
  handleDeleteAgent,
} = useSettingsPanel({
  onClose: () => emit('close'),
})
</script>
