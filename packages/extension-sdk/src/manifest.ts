export interface ExtensionPluginContribution {
  /** 插件入口文件，相对 extension 根目录。未填写时回退到 index.ts / index.js / index.mjs */
  entry?: string;
  /** 插件默认配置文件，相对 extension 根目录。默认 config.yaml */
  configFile?: string;
}

export type ExtensionPlatformPanelFieldType = 'string' | 'password' | 'number';

export interface ExtensionPlatformPanelField {
  /** 表单字段唯一键 */
  key: string;
  /** 写入 platform.yaml 对应平台配置对象时使用的键名；不填时默认使用 key */
  configKey?: string;
  /** 表单字段类型 */
  type?: ExtensionPlatformPanelFieldType;
  /** 字段显示名称 */
  label: string;
  /** 字段说明 */
  description?: string;
  /** 输入框占位文本 */
  placeholder?: string;
  /** 示例值 */
  example?: string;
  /** 默认值 */
  defaultValue?: string | number;
  /** 是否必填 */
  required?: boolean;
}

export interface ExtensionPlatformPanelContribution {
  /** 平台配置面板标题 */
  title?: string;
  /** 平台配置面板说明 */
  description?: string;
  /** 平台配置面板需要填写的字段列表 */
  fields: ExtensionPlatformPanelField[];
}

export interface ExtensionPlatformContribution {
  /** 注册到 platform.type 中的平台名称 */
  name: string;
  /** 平台入口文件，相对 extension 根目录 */
  entry: string;
  /** 命名导出名；不填时依次尝试 default / factory / platform */
  exportName?: string;
  /** 平台显示名称（用于终端界面展示） */
  label?: string;
  /** 平台描述 */
  description?: string;
  /** 平台配置面板声明 */
  panel?: ExtensionPlatformPanelContribution;
}

export interface ExtensionDistributionContribution {
  /** 可直接安装发行包需要下载的文件列表，相对 extension 根目录 */
  files?: string[];
}

export interface ExtensionManifest {
  /** extension 唯一名称 */
  name: string;
  /** extension 版本 */
  version: string;
  /** 描述 */
  description?: string;
  /** 作者 */
  author?: string;
  /** 兼容的 Iris 版本范围（当前仅保留元数据，暂不强校验） */
  iris?: string;
  /** 标签 */
  tags?: string[];
  /** 顶层插件入口。仅在 plugin 未显式声明 entry 时作为简写使用。 */
  entry?: string;
  /** 插件贡献 */
  plugin?: ExtensionPluginContribution;
  /** 平台贡献 */
  platforms?: ExtensionPlatformContribution[];
  /** 发行包元数据 */
  distribution?: ExtensionDistributionContribution;
}

export type ExtensionSource = 'installed' | 'workspace';

export interface ExtensionPackage {
  manifest: ExtensionManifest;
  rootDir: string;
  source: ExtensionSource;
}

export interface ResolvedLocalPlugin {
  type: 'extension-plugin';
  name: string;
  rootDir: string;
  entryFile: string;
  configPath?: string;
  extensionPackage: ExtensionPackage;
}

export type ExtensionInstallFallbackReason = 'remote_path_not_found';

export type ExtensionDistributionMode = 'bundled' | 'source';

export interface InstalledExtensionResult {
  source: 'remote' | 'local';
  requested: string;
 name: string;
  version: string;
  targetDir: string;
  remotePath?: string;
  sourceDir?: string;
  fallbackReason?: ExtensionInstallFallbackReason;
  fallbackDetail?: string;
  distributionMode?: ExtensionDistributionMode;
}
