# Iris v1.0.21 Release Notes

* **remote-exec**：修复 SSH 执行 `nohup ... &` 等后台命令后工具调用永久挂起的问题。`transport.ts` 新增监听 ssh2 stream 的 `'exit'` 事件（远端进程退出后 200ms drain 排空缓冲，若 `'close'` 未触发则主动关闭 channel），同时补齐 `'error'` 事件监听防止 Node UnhandledError。新增配置项 `ssh.postExitDrainMs`（默认 200），设为 0 可退化为旧行为。
* **remote-exec**：修复 `list_files` 递归列目录时 `set -o pipefail` 与 while 循环退出码冲突导致始终报 `exitCode=1 stderr=` 的问题。根因是 `[ "$count" -ge ${max} ] && break` 在计数未达上限时返回 1，`pipefail` 将其传播为管道整体退出码。修复：循环末尾加 `true;` 强制退出码为 0。
