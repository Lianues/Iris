# Iris v1.0.28 Release Notes

* Search：`search_in_files` 全面切换为 glob-first 接口，使用 `include` / `exclude` 数组描述搜索范围，不再接受旧的 `path` / `pattern` / `isRegex` 参数。
* Search：引入 `fast-glob` 支持常见复杂 glob 语法，例如 `{src,tests}/**/*`、`**/*.{ts,tsx}` 与 extglob，让 AI 更容易生成符合编程习惯的搜索调用。
* Search：搜索和替换结果新增 `filesMatched`、`effectiveExclude` 与空匹配 `warning`，区分“没有命中内容”和“没有匹配到文件”。
* Search Replace：同步更新 `search_in_files.replace` 的 diff 预览逻辑，按新的 `include` / `exclude` 范围生成审批预览。
* Remote Exec：远端 `search_in_files` 同步切换到新 glob 接口，并使用 `minimatch` 在远端候选文件上匹配复杂 glob。
* Console / Web UI：更新工具调用摘要展示，显示新的 include glob 范围。
* Tests：新增 `search_in_files` glob 接口测试，并更新替换预览测试。
