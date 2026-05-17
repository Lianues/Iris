# Iris v1.0.26 Release Notes

* 简化 Plan Mode 提示逻辑：移除“已退出 Plan Mode”的单独提示，非 Plan Mode 场景统一复用“Plan Mode 可用”。
* 移除 Auto Edit 对模型的运行时提示注入：Auto Edit 仅作为审批/自动同意机制存在，不再向模型暴露启用状态或暂停提示。
* 清理运行时动态提示相关代码与测试，减少不必要的 prompt 注入路径。
