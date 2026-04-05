# Session 日记：从「npm install 是什么」到「拆仓库再合回来」

> 日期：2026 年 4 月 5 日
> 项目：Iris —— 一个模块化的 AI 聊天框架
> 参与者：我（用户）+ AI 助手

---

## 话题一：项目基础认知（Round 1）

**我的问题**：bun install 和 npm install 区别是什么？从源码启动的流程是什么？这到底是个什么项目？TypeScript 和 Node.js 什么关系？

**收获**：
- 了解了 bun 和 npm 都是包管理器，装的东西一样，区别在锁文件和速度
- 本项目 Console TUI 必须用 Bun 运行时，Web/Telegram 等用 Node.js 就行
- 这是一个 **TypeScript + Node.js 项目**：TS 是语言，Node.js 是运行环境
- TS 和 Node.js 的关系类似 Java 和 JVM——TS 写代码，编译成 JS，交给 Node.js/Bun 跑

---

## 话题二：为什么安装依赖这么复杂？（Round 2-5）

**我的问题**：setup 和 setup:extensions 区别是什么？按理说软件不都是装完依赖就能启动吗？为什么还要分两步？npm 和 bun 的路线为什么不一样？

**收获**：
- 这个项目是**多包仓库（monorepo）**，一个仓库里塞了 15 个独立项目
- 根目录的 `npm install` 只装主程序的依赖，不管各 extension 子目录
- `setup` 封装了三条命令：
  1. `npm install --legacy-peer-deps`（装主程序依赖，忽略 peer 冲突）
  2. `npm run setup:extensions -- --frozen-lockfile`（遍历各 extension 装依赖，严格按锁文件）
  3. `cd extensions/web/web-ui && npm install`（单独装 Web 前端依赖）
- `setup` 里写死了 npm，所以 Bun 用户不能直接用，只能手动分步操作

---

## 话题三：锁文件到底是什么？（Round 6-9）

**我的问题**：我都有 package.json 了还要什么锁？先 npm install 再 bun install 会怎样？锁文件什么时候更新？严格按锁文件安装还需要特殊命令？

**收获**：
- `package.json` 记的是版本范围（如 `^2.8.2`），不同时间装可能装到不同版本
- 锁文件是**精确快照**——把整棵依赖树的每个包、每个版本、每个下载地址全部钉死
- npm 用 `package-lock.json`，bun 用 `bun.lock`，互不干扰也互不读取
- `npm install` 在发现不一致时会**偷偷更新锁文件**
- `npm ci` / `--frozen-lockfile` 才是严格模式——对不上就报错，绝不擅自改
- 本项目同时维护两个锁文件，靠作者偶尔手动同步，不完美但能跑

---

## 话题四：这个仓库到底该分成几个项目？（Round 10）

**我的问题**：如果按一个依赖表一个仓库，该分成几个？

**收获**：
- 严格来说是 **15 个项目**：1 个主程序 + 1 个 SDK + 11 个 extension + 1 个 Web UI + 1 个终端工具
- 之所以都塞在一个仓库，是 monorepo 的设计选择：换来开发方便（一个 commit 改所有），代价是 install 复杂

---

## 话题五：拆分计划（Round 11）

**我的问题**：帮我出个计划，搞一个纯净版，把插件都拆出去。

**AI 给出的方案**：拆成 4 个仓库
1. **iris-extension-sdk** — 公共 SDK 契约层
2. **iris-web-ui** — Web 前端（Vue 3 项目）
3. **iris-extensions** — 11 个官方插件合集
4. **iris-core** — 纯净版主程序

分 5 个阶段执行：先修硬耦合 → 拆 SDK → 拆 Web UI → 拆 extensions → 清理 core

---

## 话题六：实际执行拆分操作（Round 12-21）

**做了什么**：

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | 在 IrisesAgentDev 组织创建 `iris-extension-sdk` 仓库 | ✅ |
| 2 | 复制 `packages/extension-sdk/` 源码，测试编译通过 | ✅ 0 错误 |
| 3 | Push 到 GitHub，修正分支名 master → main | ✅ |
| 4 | 创建 `iris-web-ui`，复制 `extensions/web/web-ui/` | ✅ 89 个文件 |
| 5 | 创建 `iris-extensions`，复制 11 个 extension | ✅ |
| 6 | 讨论后删除了 `iris-extensions` 中重复的 `web/web-ui/` | ✅ 165 个文件 |
| 7 | 创建 `iris-core`，复制主程序（排除 extensions/ 和 packages/） | ✅ 321 个文件 |

**中间的重要讨论**：
- 用户明确指示：**主仓库不要做任何修改**，理解为 fork/镜像即可
- 讨论了 `iris-extensions` 中是否需要保留 `web/web-ui/`，结论是删掉避免重复

---

## 话题七：拆了之后要改什么？（Round 22-23）

**调研发现**：如果要让四个仓库各自独立运行，需要改的东西不少：

- **iris-extensions**：11 个 `file:../../packages/extension-sdk` → npm 版本号（工作量小）
- **iris-core**：
  - 2 个硬 import（直接引用了 extensions/ 和 packages/ 的源码）
  - package.json 的 `file:` 本地链接
  - tsconfig.json 的 paths 映射（指向不存在的 packages/ 目录）
  - vitest.config.ts 的别名映射（同上）
  - 6 个构建脚本（大量引用 extensions/ 目录路径）
  - CI/CD 工作流（引用 extensions/ 和 packages/）

**用户追问了为什么 tsconfig/vitest/CI 也要变**：
- 答案很简单——它们的路径写的是 `packages/xxx` 或 `extensions/xxx`，拆仓库后这些目录不存在了，不改就报错

---

## 话题八：灵魂拷问——拆 multi-repo 真的好吗？（Round 24）

**AI 搜索了大量业界文章后的诚实结论：不建议拆。**

核心理由：
- 业界共识：**小团队 / 单团队 → monorepo 更好**
- 拆了之后的痛苦：版本同步地狱（改一个接口要跨 3 仓库改 13 次）、跨仓库调试极其痛苦、CI/CD 复杂度翻倍
- 有一篇文章讲了「拆了又合回来」的故事
- **更好的方案是用 pnpm workspace 管好现有 monorepo**，一条命令装完所有依赖

---

## 话题九：归档收尾（Round 25）

**最终决定**：
- 把 iris-core 也 push 上去
- 四个仓库全部标记为 **Archive（归档）**
- 作为镜像/快照保留，不作为实际开发流程使用

**最终结果**：

| 仓库 | 地址 | 状态 |
|------|------|------|
| iris-core | https://github.com/IrisesAgentDev/iris-core | 🔒 归档 |
| iris-extension-sdk | https://github.com/IrisesAgentDev/iris-extension-sdk | 🔒 归档 |
| iris-extensions | https://github.com/IrisesAgentDev/iris-extensions | 🔒 归档 |
| iris-web-ui | https://github.com/IrisesAgentDev/iris-web-ui | 🔒 归档 |

主仓库 `Lianues/Iris` 未做任何改动。

---

## 总结感悟

这个 session 从一个看似简单的问题（bun 和 npm 有什么区别）开始，逐步深入到了：

1. **包管理器的本质**——它们做的事情一样，只是速度和锁文件不同
2. **monorepo 的复杂性**——15 个项目塞一个仓库，install 必然复杂
3. **锁文件的意义**——保证所有人装出完全一样的依赖
4. **架构拆分的诱惑与陷阱**——理论上拆开更「干净」，但实际上小团队拆 multi-repo 弊大于利
5. **业界的真实经验**——很多团队拆了又合回来，选择取决于团队规模而非技术偏好

最终结论：**保持 monorepo 不动，如果 install 复杂度是痛点，用 pnpm workspace 解决，而不是拆仓库。**

四个归档仓库作为「如果真要拆会是什么样」的参考快照保留。
