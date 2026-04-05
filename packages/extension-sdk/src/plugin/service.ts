/**
 * 插件服务注册中心类型定义
 *
 * 允许插件注册自己的服务/接口，供其他插件发现和调用。
 * 替代之前 `(api as any).xxx = impl` 的 hack 方式，提供类型安全的服务注册与发现。
 *
 * 使用示例：
 * ```typescript
 * // 插件 A —— 注册服务
 * activate(ctx) {
 *   ctx.getServiceRegistry().register('web.pageRenderer', {
 *     showPage(title, html) { ... },
 *     showModal(opts)       { ... },
 *   }, { description: '渲染自定义页面', version: '1.0' });
 * }
 *
 * // 插件 B —— 使用服务
 * activate(ctx) {
 *   ctx.onReady(async (api) => {
 *     const renderer = await api.services.waitFor<PageRenderer>('web.pageRenderer');
 *     renderer.showPage('任务列表', '<h1>Jobs</h1>');
 *   });
 * }
 * ```
 */

/** 通用释放器接口，调用 dispose() 撤销注册 */
export interface Disposable {
  dispose(): void;
}

/** 已注册服务的描述信息 */
export interface ServiceDescriptor {
  /** 服务唯一 ID，建议格式 "pluginName.serviceName"，如 "memory.store"、"web.pageRenderer" */
  id: string;
  /** 服务描述 */
  description?: string;
  /** 服务版本（语义化版本），用于兼容性检查 */
  version?: string;
  /** 注册该服务的插件名称（由宿主自动填充） */
  pluginName?: string;
}

/** 服务注册中心接口 */
export interface ServiceRegistryLike {
  /**
   * 注册一个服务实例。
   * @param id 服务唯一 ID
   * @param implementation 服务实现对象
   * @param meta 可选的描述信息（description、version）
   * @returns Disposable，调用 dispose() 注销服务
   * @throws 如果 id 已被注册
   */
  register<T>(id: string, implementation: T, meta?: Omit<ServiceDescriptor, 'id' | 'pluginName'>): Disposable;

  /**
   * 获取已注册的服务实例。
   * @returns 服务实例，未注册时返回 undefined
   */
  get<T>(id: string): T | undefined;

  /**
   * 获取已注册的服务实例，不存在则抛出错误。
   */
  getRequired<T>(id: string): T;

  /**
   * 检查服务是否已注册。
   */
  has(id: string): boolean;

  /**
   * 列出所有已注册服务的描述信息。
   */
  list(): ServiceDescriptor[];

  /**
   * 等待某个服务注册完成。
   * 适用于解决插件加载顺序导致的服务尚未注册问题。
   * @param id 服务 ID
   * @param timeoutMs 超时时间（毫秒），默认 10000
   * @returns 已注册的服务实例
   * @throws 超时未等到注册
   */
  waitFor<T>(id: string, timeoutMs?: number): Promise<T>;

  /**
   * 监听服务注册事件。
   */
  onDidRegister(listener: (descriptor: ServiceDescriptor) => void): Disposable;

  /**
   * 监听服务注销事件。
   */
  onDidUnregister(listener: (id: string) => void): Disposable;
}
