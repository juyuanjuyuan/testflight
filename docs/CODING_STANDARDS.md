# 代码规范

来源：`docs/process-template/skills/4-implementation.md` 和 `5-self-testing.md` 中适用于本项目的部分，按"Node.js 命令行工具 + 静态页面、没有数据库和后端服务"的实际情况改写。流程类要求（ADR、changelog、五份架构文档、工作包文档、发布门禁）刻意不采用，由 `docs/plans/`、commit message 和 CI 代替。

每个计划打勾之前，对照本文件自查一遍。

## 1. 分层

- `cli.mjs` 和 `scripts/` 只负责解析参数、调用、打印结果；业务逻辑放在 `src/` 里。
- `src/` 下的库代码**不直接 `console.log`**，需要输出进度时接收一个 `log` 回调（默认什么都不做），由 CLI 传入 `console.log`。
- 检测器（`src/detect/`）、观察构建（`observation.mjs`）、结论计算（`verdicts.mjs`）、报告生成（`report/build.mjs`）是纯函数：只读输入、返回数据，不读写文件、不访问网络。
- 一个模块只做一件事。优先沿用已有写法，不为"以后可能用到"新增抽象层。

## 2. 数据与契约

- 模块之间只通过 `src/contracts.mjs` 定义的结构交换数据。新增字段只能是可选的，且要同步更新注释、fixture 和测试。
- **在边界处校验所有外部输入**：LLM 输出（planner 的 Action、judge 的判定、fixer 的 edits）、trace 文件、命令行参数。校验失败要给出能看懂的原因，不要让 `undefined` 流进下游。
- 每种产物只有一个生成出口：`report.json` 只由 `report/build.mjs` 生成，`trace.jsonl` 只由 runner 写入。
- 数值阈值（时间窗口、步数上限、噪音次数等）集中放在 `contracts.mjs`，不要在各处写魔法数字。

## 3. 错误处理

- 配置缺失、文件不存在、必需资源找不到：**立即报错**，说明缺什么、怎么补。
- **不允许静默吞掉错误。** 每个 `catch` 必须二选一：重新抛出；或者按设计降级，并把降级写进输出，让人能看到。现有的降级方式：
  - judge 失败 → finding 标 `judged: false`，错误记入 `stats.judgeErrors`；
  - axe 无法运行 → 报告里 `axe.error`，数量为 `null`，**绝不能显示成"0 个问题"**；
  - planner 失败 → 输出 stuck 并标 `plannerError: true`；
  - CDP 解析焦点失败 → 焦点信息带 `axError`。
- 面向用户的错误只打印一行原因；设置 `DEBUG=1` 时才打印完整堆栈。

## 4. 路径与文件

- 所有路径都从 `src/paths.mjs` 的 `ROOT` 推出，**不依赖 `process.cwd()`**。从任何目录运行命令，结果都应该一样。
- 只写这几个位置：`runs/`、`.cache/`、`sites/*/patched/`。三者都已 gitignore。
- 来自用户或 LLM 的路径一律经过 `insideDir()`，防止路径穿越。
- 用 `path.join` 拼路径，代码里不写任何本机绝对路径。

## 5. 依赖与安全

- 允许的依赖：playwright、axe-core、openai、dotenv、yaml。新增依赖先在群里说一声。
- key 只放在 `.env`，不打印、不写进日志、不进 trace 或缓存文件名。
- 真实网站的运行结果和公司名永远不提交；`guard.mjs` 的限制只能加强，不能放宽。

## 6. 测试

- `npm test` 不依赖网络、LLM 或本机状态，只用 `fixtures/` 里录好的数据。push 前必须通过。
- 改了 `src/runner/` 还要跑 `npm run smoke`（会启动真实浏览器）。
- **每修一个 bug，先加一条能复现它的测试**，再修。
- 测试结束要关掉浏览器、服务器、定时器；临时文件用唯一路径（`fs.mkdtempSync`）。

## 7. 调试

按顺序：用 run 目录里的 trace、截图、报告复现并留下证据 → 找到最小的根因 → 写回归测试 → 做最小的修复 → 跑相关测试。不要在没有证据的情况下同时改好几处猜测的地方。

## 8. 提交

- 小步提交，一个 commit 只做一件事，能对应到某个计划的某一步。
- commit message 写清楚"改了什么 + 为什么"；修 bug 时写"现象 / 根因 / 修复"。这替代了 changelog。
- 不顺手重构无关代码，不改无关文件。
- 临时调试开关默认关闭，提交前删掉或改成 `DEBUG` 控制。

## 9. 简洁

- 删掉不用的代码和注释掉的代码，不留"以后可能用"的分支。
- 导出的函数写一行 JSDoc，说明输入和返回；内部小函数不用。
- 参考尺度：函数不超过约 50 行，文件不超过约 300 行；超过时先想想是不是做了两件事。
- 注释解释"为什么"，不复述代码"做了什么"。
