/**
 * config.ts —— 解析 remote_exec.yaml 主配置
 */

import YAML from 'yaml';

export interface RemoteExecSshConfig {
  reuseConnection: boolean;
  connectTimeoutMs: number;
  keepAliveSec: number;
  commandTimeoutMs: number;
  /**
   * 远端进程退出后，等待 stdout/stderr 缓冲排空的最长时间（毫秒）。
   *
   * 用于解决"前台命令已结束、但后台进程持有原 SSH channel 的 stdout/stderr fd
   * 导致 channel 不关闭"的问题（典型场景：`nohup ... > log 2>&1 &`）。
   *
   * 触发流程：
   *   1. ssh2 stream 收到 'exit' 事件（远端进程已退出，exitCode 已知）
   *   2. 启动 drain 计时器，给 stdout/stderr 一段时间排空
   *   3. 计时器到时若 'close' 仍未触发，主动关闭 channel 并 resolve
   *
   * 默认 200ms。设为 0 时退化为旧行为（仅等 'close'），不推荐。
   */
  postExitDrainMs: number;
}

export interface RemoteExecConfig {
  enabled: boolean;
  defaultEnvironment: string; // 'local' 或 Host 别名
  exposeSwitchTool: boolean;
  remoteWorkdir?: string;
  ssh: RemoteExecSshConfig;
}

export const LOCAL_ENV = 'local';

const DEFAULTS: RemoteExecConfig = {
  enabled: false,
  defaultEnvironment: LOCAL_ENV,
  exposeSwitchTool: true,
  remoteWorkdir: undefined,
  ssh: {
    reuseConnection: true,
    connectTimeoutMs: 10000,
    keepAliveSec: 30,
    commandTimeoutMs: 0,
    postExitDrainMs: 200,
  },
};

export function parseRemoteExecConfig(raw: unknown): RemoteExecConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  const ssh = (r.ssh && typeof r.ssh === 'object' ? r.ssh : {}) as Record<string, unknown>;

  return {
    enabled: r.enabled === true,
    defaultEnvironment:
      typeof r.defaultEnvironment === 'string' && r.defaultEnvironment.trim()
        ? r.defaultEnvironment.trim()
        : LOCAL_ENV,
    exposeSwitchTool: r.exposeSwitchTool !== false,
    remoteWorkdir:
      typeof r.remoteWorkdir === 'string' && r.remoteWorkdir.trim()
        ? r.remoteWorkdir.trim()
        : undefined,
    ssh: {
      reuseConnection: ssh.reuseConnection !== false,
      connectTimeoutMs: toFiniteNumber(ssh.connectTimeoutMs, DEFAULTS.ssh.connectTimeoutMs),
      keepAliveSec: toFiniteNumber(ssh.keepAliveSec, DEFAULTS.ssh.keepAliveSec),
      commandTimeoutMs: toFiniteNumber(ssh.commandTimeoutMs, DEFAULTS.ssh.commandTimeoutMs),
      postExitDrainMs: toFiniteNumber(ssh.postExitDrainMs, DEFAULTS.ssh.postExitDrainMs),
    },
  };
}

export function parseRemoteExecYaml(text: string): RemoteExecConfig {
  try {
    return parseRemoteExecConfig(YAML.parse(text));
  } catch {
    return { ...DEFAULTS };
  }
}

function toFiniteNumber(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : def;
}
