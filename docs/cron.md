# Cron 定时任务

## 概述

Cron 由 `cron` extension 提供，用于让 Iris 在指定时间、固定间隔或一次性延迟后自动执行后台任务。

- **任务定义文件**：`extension-data/cron/cron-jobs.json`（默认全局路径为 `~/.iris/extension-data/cron/cron-jobs.json`）
- **调度器配置**：`~/.iris/configs/cron.yaml`
- **启用方式**：需要在 `plugins.yaml` 中启用 `cron` extension（详见 [configuration-examples.md#pluginsyaml](./configuration-examples.md#pluginsyaml)）

---

## 启用调度器

```bash
# 启用调度器（写入 ~/.iris/configs/cron.yaml）
iris cron config enable

# 查看调度器状态
iris cron status
```

---

## 添加任务

Cron extension 支持三种任务类型：

### 按 cron 表达式（重复执行）

```bash
# 每天 9 点执行一次
iris cron add morning --type cron --value "0 9 * * *" --instruction "生成一条早安问候" --silent
```

### 按固定间隔（重复执行）

```bash
# 每 30 分钟执行一次
iris cron add check --type interval --value 30m --instruction "检查项目状态并总结"
```

支持的时间单位：`s`（秒）、`m`（分钟）、`h`（小时）、`d`（天）。

### 一次性延迟

```bash
# 10 分钟后执行一次
iris cron add reminder --type once --value 10m --instruction "提醒我喝水"
```

### 常用 flag

| flag | 说明 |
|---|---|
| `--type` | 任务类型：`cron` / `interval` / `once` |
| `--value` | 触发表达式（cron 表达式 / 间隔值 / 延迟值） |
| `--instruction` | 触发时发给 AI 的指令文本 |
| `--silent` | 不在前台显示任务执行（仅记录） |
| `--agent <name>` | 给指定 Agent 写独立任务（默认写到全局任务） |

---

## 管理任务

```bash
# 列出全部任务
iris cron list

# 查看某个任务详情
iris cron get morning

# 临时禁用 / 重新启用任务
iris cron disable morning
iris cron enable morning

# 删除任务
iris cron remove morning
```

---

## Agent 独占任务

如需让某个特定 Agent 拥有独占的定时任务，使用 `--agent` 参数：

```bash
iris cron add daily-report --agent analyst --type cron --value "0 18 * * *" --instruction "汇总今日工作"
```

该任务只会作用于 `analyst` Agent 的会话，不会影响其他 Agent。

---

## 热重载行为

- **任务文件（`cron-jobs.json`）变化**：会被 cron extension 轮询同步，无需重启 Iris。
- **调度器配置（`cron.yaml`）变化**：可能需要重启或触发配置热重载后才能应用（例如启用/禁用调度器本身）。

---

## 相关文档

- [configuration-examples.md](./configuration-examples.md) — 全局配置文件示例
- [agents.md](./agents.md) — Agent 覆盖层机制
- [plugins.md](./plugins.md) — 插件系统（Cron 是其中一个 plugin extension）
