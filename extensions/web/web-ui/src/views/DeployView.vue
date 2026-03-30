<template>
  <div class="deploy-page">
    <!-- 左侧表单 -->
    <div class="deploy-form">
      <span class="deploy-kicker">Delivery Studio</span>
      <h2 class="deploy-title">部署配置生成器</h2>
      <p class="deploy-desc">填写参数，由后端统一生成 nginx 和 systemd 配置文件</p>
      <div class="deploy-badges">
        <span class="deploy-badge">{{ detectLoaded ? (canDeploy ? '环境就绪' : '环境待处理') : '环境检测中' }}</span>
        <span class="deploy-badge subtle">{{ activeTab === 'nginx' ? 'Nginx 配置' : 'Service 配置' }}</span>
      </div>

      <div v-if="managementNotice" class="deploy-guide" style="margin-top:12px">
        <h4>管理接口认证</h4>
        <p>{{ managementNotice }}</p>
      </div>

      <!-- 环境检测面板 -->
      <div class="deploy-detect" v-if="detectLoaded">
        <h3 class="detect-title">环境检测</h3>
        <div class="detect-item" :class="detect.isLinux ? 'detect-ok' : 'detect-fail'">
          <AppIcon :name="detect.isLinux ? ICONS.status.ok : ICONS.status.fail" class="detect-icon" />
          <span>Linux 系统{{ detect.isLinux ? '' : '（当前非 Linux）' }}</span>
        </div>
        <div class="detect-item" :class="detect.isLocal ? 'detect-ok' : 'detect-warn'">
          <AppIcon :name="detect.isLocal ? ICONS.status.ok : ICONS.status.warn" class="detect-icon" />
          <span>本地访问{{ detect.isLocal ? '' : '（当前为远程访问）' }}</span>
        </div>
        <div class="detect-item" :class="detect.nginx.installed ? 'detect-ok' : 'detect-fail'">
          <AppIcon :name="detect.nginx.installed ? ICONS.status.ok : ICONS.status.fail" class="detect-icon" />
          <span>Nginx {{ detect.nginx.installed ? `v${detect.nginx.version}` : '未安装' }}</span>
          <span v-if="detect.nginx.existingConfig" class="detect-extra">（已有配置）</span>
        </div>
        <div class="detect-item" :class="detect.systemd.available ? 'detect-ok' : 'detect-fail'">
          <AppIcon :name="detect.systemd.available ? ICONS.status.ok : ICONS.status.fail" class="detect-icon" />
          <span>Systemd {{ detect.systemd.available ? '可用' : '不可用' }}</span>
          <span v-if="detect.systemd.existingService" class="detect-extra">
            （服务状态: {{ detect.systemd.serviceStatus }}）
          </span>
        </div>
        <div class="detect-item" :class="sudoClass">
          <AppIcon :name="detect.sudo.available ? (detect.sudo.noPassword ? ICONS.status.ok : ICONS.status.warn) : ICONS.status.fail" class="detect-icon" />
          <span>
            sudo {{ !detect.sudo.available ? '未安装' : (detect.sudo.noPassword ? '免密可用' : '需要密码') }}
          </span>
        </div>
      </div>
      <div class="deploy-detect" v-else-if="detectError">
        <h3 class="detect-title">环境检测</h3>
        <div class="detect-item detect-fail">
          <AppIcon :name="ICONS.status.fail" class="detect-icon" />
          <span>检测失败: {{ detectError }}</span>
        </div>
      </div>
      <div class="deploy-detect" v-else>
        <h3 class="detect-title">环境检测</h3>
        <div class="detect-item detect-warn">
          <AppIcon :name="ICONS.status.loading" class="detect-icon" />
          <span>正在检测...</span>
        </div>
      </div>

      <!-- 前置引导 -->
      <div v-if="!detect.nginx.installed && detectLoaded && detect.isLinux" class="deploy-guide">
        <h4>Nginx 未安装？</h4>
        <p>在服务器上运行以下命令安装：</p>
        <code class="deploy-guide-cmd">sudo apt update && sudo apt install -y nginx</code>
        <p style="margin-top:6px">安装后刷新本页以重新检测。</p>
      </div>

      <div class="form-group">
        <label>域名 *</label>
        <input type="text" v-model="form.domain" placeholder="chat.example.com" />
        <p class="field-hint">已解析到服务器 IP 的域名。留空时会使用示例域名生成预览，但不会允许部署。</p>
      </div>

      <div class="form-group">
        <label>后端端口</label>
        <input
          type="number"
          :value="portInput"
          placeholder="8192"
          @input="handlePortInput"
          @blur="syncPortInput"
        />
        <p class="field-hint">Iris 后端监听的端口，对应 config.yaml 中 web.port 的值。{{ runtimeHint }}</p>
      </div>

      <div class="form-group">
        <label>部署路径</label>
        <input type="text" v-model="form.deployPath" placeholder="/opt/iris" />
        <p class="field-hint">项目文件在服务器上的绝对路径，systemd 服务将从此目录启动。</p>
      </div>

      <div class="form-group">
        <label>运行用户</label>
        <input type="text" v-model="form.user" placeholder="iris" />
        <p class="field-hint">
          systemd 服务运行的 Linux 用户。
          如未创建，可运行 <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">sudo useradd -r -s /bin/false iris</code>
        </p>
      </div>

      <div class="form-group inline">
        <input type="checkbox" id="enableHttps" v-model="form.enableHttps" />
        <label for="enableHttps">启用 HTTPS</label>
      </div>
      <p v-if="form.enableHttps" class="field-hint" style="margin-top:-8px;margin-bottom:12px">
        需要先用 Certbot 申请证书：
        <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">
          sudo certbot certonly --webroot -w /var/www/certbot -d {{ previewDomain }}
        </code>
        <br />如使用 Cloudflare 代理，可在 CF 侧开启 SSL 而这里关闭 HTTPS。
      </p>

      <div class="form-group inline">
        <input type="checkbox" id="enableAuth" v-model="form.enableAuth" />
        <label for="enableAuth">启用密码保护（HTTP Basic Auth）</label>
      </div>
      <p v-if="form.enableAuth" class="field-hint" style="margin-top:-8px;margin-bottom:12px">
        需创建密码文件：
        <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">
          sudo apt install -y apache2-utils && sudo htpasswd -c /etc/nginx/.htpasswd youruser
        </code>
      </p>

      <!-- Cloudflare + 防火墙 引导 -->
      <div class="deploy-guide" style="margin-top:16px">
        <h4>后续步骤</h4>
        <p>部署 Nginx 后，还需完成以下操作才能从外部访问：</p>
        <ol style="margin:8px 0 0;padding-left:1.4em;line-height:2">
          <li>
            <strong>开放防火墙端口</strong>
            <code class="deploy-guide-cmd" style="display:inline;padding:2px 8px;margin-left:4px">sudo ufw allow 80,443/tcp</code>
          </li>
          <li><strong>配置域名解析</strong> — 在域名服务商处添加 A 记录指向服务器 IP</li>
          <li v-if="form.enableHttps"><strong>申请 SSL 证书</strong> — 见上方 Certbot 命令</li>
          <li>
            <strong>使用 Cloudflare？</strong> — 前往
            <em style="color:var(--accent-cyan, var(--accent))">设置中心 → Cloudflare 管理</em>
            连接 Token、添加 DNS 记录、设置 SSL 模式
          </li>
        </ol>
        <p style="margin-top:8px">
          DNS 记录生效通常需要 1-5 分钟（Cloudflare 代理模式更快），请耐心等待后再验证。
        </p>
      </div>
    </div>

    <!-- 右侧输出 -->
    <div class="deploy-output">
      <div class="deploy-output-head">
        <div>
          <span class="deploy-output-label">统一预览</span>
          <h3 class="deploy-output-title">{{ activeTab === 'nginx' ? 'nginx.conf' : 'iris.service' }}</h3>
        </div>
        <span class="deploy-output-status" :class="{ disabled: !canDeploy }">
          {{ canDeploy ? '可直接部署' : (deployDisabledReason || '仅生成配置') }}
        </span>
      </div>

      <div class="deploy-tabs">
        <button
          class="deploy-tab"
          type="button"
          :class="{ active: activeTab === 'nginx' }"
          @click="activeTab = 'nginx'"
        >
          nginx.conf
        </button>
        <button
          class="deploy-tab"
          type="button"
          :class="{ active: activeTab === 'service' }"
          @click="activeTab = 'service'"
        >
          iris.service
        </button>
      </div>

      <div class="deploy-code-wrapper">
        <pre class="deploy-code">{{ currentPreviewContent }}</pre>
        <div class="deploy-actions">
          <button class="btn-copy" type="button" @click="handleCopy">{{ copyText }}</button>
          <button class="btn-download" type="button" @click="handleDownload">下载</button>
          <button
            class="btn-deploy"
            type="button"
            :disabled="!canDeploy"
            :title="deployDisabledReason"
            @click="showConfirm = true"
          >
            {{ activeTab === 'nginx' ? '部署 Nginx' : '部署 Service' }}
          </button>
        </div>
      </div>

      <!-- 联动建议 -->
      <div class="deploy-steps" v-if="preview.recommendations.length">
        <h3 class="deploy-steps-title">联动建议</h3>
        <div
          v-for="(message, i) in preview.recommendations"
          :key="`rec-${i}`"
          class="deploy-step"
        >
          <AppIcon :name="ICONS.status.ok" class="step-icon" />
          <span class="step-name">建议</span>
          <span class="step-output">{{ message }}</span>
        </div>
      </div>

      <!-- 预览校验 -->
      <div class="deploy-steps" v-if="preview.errors.length || preview.warnings.length">
        <h3 class="deploy-steps-title">预览校验</h3>
        <div
          v-for="(message, i) in preview.errors"
          :key="`error-${i}`"
          class="deploy-step step-fail"
        >
          <AppIcon :name="ICONS.status.fail" class="step-icon" />
          <span class="step-name">错误</span>
          <span class="step-output">{{ message }}</span>
        </div>
        <div
          v-for="(message, i) in preview.warnings"
          :key="`warning-${i}`"
          class="deploy-step"
        >
          <AppIcon :name="ICONS.status.warn" class="step-icon" />
          <span class="step-name">提示</span>
          <span class="step-output">{{ message }}</span>
        </div>
      </div>

      <!-- 部署步骤结果 -->
      <div class="deploy-steps" v-if="deployResult">
        <h3 class="deploy-steps-title">
          {{ deployResult.ok ? '部署成功' : '部署失败' }}
        </h3>
        <div
          v-for="(step, i) in deployResult.steps"
          :key="i"
          class="deploy-step"
          :class="step.success ? 'step-ok' : 'step-fail'"
        >
          <AppIcon :name="step.success ? ICONS.status.ok : ICONS.status.fail" class="step-icon" />
          <span class="step-name">{{ step.name }}</span>
          <span class="step-output">{{ step.output }}</span>
        </div>
        <div v-if="deployResult.error" class="deploy-step step-fail">
          <AppIcon :name="ICONS.status.warn" class="step-icon" />
          <span class="step-name">错误</span>
          <span class="step-output">{{ deployResult.error }}</span>
        </div>
      </div>

      <!-- 部署后：Cloudflare SSL 一键同步 -->
      <div class="deploy-steps" v-if="showCloudflareSync">
        <h3 class="deploy-steps-title">Cloudflare SSL 同步</h3>
        <div class="deploy-step">
          <AppIcon :name="ICONS.status.warn" class="step-icon" />
          <span class="step-name">当前模式</span>
          <span class="step-output">{{ cloudflareModeLabel(preview.cloudflare?.sslMode || null) }}</span>
        </div>
        <div class="deploy-step" style="grid-template-columns: 20px minmax(0,1fr)">
          <AppIcon :name="ICONS.status.ok" class="step-icon" />
          <div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button
                class="btn-save"
                type="button"
                :disabled="cfSyncing"
                @click="handleSyncCloudflare(form.enableHttps ? 'strict' : 'flexible')"
              >
                {{ cfSyncing ? '同步中...' : (form.enableHttps ? '同步为 Full (Strict)' : '同步为 Flexible') }}
              </button>
              <button
                v-if="form.enableHttps"
                class="btn-download"
                type="button"
                :disabled="cfSyncing"
                @click="handleSyncCloudflare('full')"
              >
                同步为 Full
              </button>
            </div>
            <p class="field-hint" style="margin-top:8px">
              建议：{{ form.enableHttps ? '源站已启用 HTTPS，优先使用 Full (Strict)。' : '源站为 HTTP-only，建议保持 Flexible。' }}
            </p>
            <span v-if="cfSyncMsg" class="settings-status" :class="{ error: cfSyncError }" style="margin-top:8px;display:inline-flex">
              {{ cfSyncMsg }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 确认弹窗 -->
    <Transition name="panel-modal">
      <div class="overlay" v-if="showConfirm" @click.self="showConfirm = false">
        <div class="deploy-confirm">
          <h3>确认部署</h3>
          <p>
            即将{{ activeTab === 'nginx' ? '部署 Nginx 反向代理配置' : '安装 systemd 服务' }}到服务器，
            此操作需要 sudo 权限。
          </p>
          <p v-if="activeTab === 'nginx' && detect.nginx.existingConfig" class="text-warn">
            注意：已存在 Iris 的 nginx 配置，将被覆盖。
          </p>
          <p v-if="activeTab === 'service' && detect.systemd.existingService" class="text-warn">
            注意：已存在 Iris 的 systemd 服务文件，将被覆盖。
          </p>
          <div class="form-group" style="margin-top:12px">
            <label>部署令牌</label>
            <input type="password" v-model="deployToken" placeholder="从服务端启动日志中获取" />
            <p class="field-hint">启动时日志会打印：部署令牌（一键部署需要）: xxxxx</p>
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" type="button" @click="showConfirm = false">取消</button>
            <button class="btn-deploy" type="button" @click="executeDeploy" :disabled="deploying || !deployToken.trim() || !canDeploy">
              {{ deploying ? '部署中...' : '确认部署' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useDeployView } from '../features/deploy/useDeployView'

const {
  form,
  activeTab,
  detectLoaded,
  canDeploy,
  managementNotice,
  detectError,
  detect,
  sudoClass,
  portInput,
  handlePortInput,
  syncPortInput,
  runtimeHint,
  previewDomain,
  preview,
  copyText,
  currentPreviewContent,
  handleCopy,
  handleDownload,
  deployDisabledReason,
  showConfirm,
  deployResult,
  showCloudflareSync,
  cloudflareModeLabel,
  cfSyncing,
  handleSyncCloudflare,
  cfSyncMsg,
  cfSyncError,
  deployToken,
  deploying,
  executeDeploy,
} = useDeployView()
</script>

