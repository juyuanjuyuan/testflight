# Plans

每个 `NN-*.md` 是一个可以独立交给 Claude Code 执行的计划：写清目标、依赖、先读什么、能改哪些文件、步骤、验收命令。**不按人分工**，谁有空谁领下一个。

## 怎么用

1. 领取：在下表里找第一个"依赖已完成"且未勾选的计划，在群里说一声"我做 NN"。
2. 交给 Claude Code：`读 docs/plans/NN-xxx.md 和 docs/CODING_STANDARDS.md 并执行。只改计划里"可以改"列出的文件。每一步做完跑验收命令。`
3. 完成：验收全部通过，并对照 `docs/CODING_STANDARDS.md` 自查后，在本表勾选，与代码放在同一个 commit 里，然后 push。
4. 卡住或需要改计划：直接改对应的 plan 文件并 commit，别只在聊天里说。

所有计划都要遵守 `AGENTS.md` 的硬规则（尤其是信息隔离），并保证 `npm test` 通过；动了 `src/runner/` 还要跑 `npm run smoke`（01 完成后才有）。

## 列表

| 完成 | 计划 | 依赖 | 预计 | 目标时间 |
|---|---|---|---|---|
| [x] | [01 仓库卫生与 smoke 测试](01-repo-hygiene.md) | — | 30 分钟 | 周六 17:00 |
| [ ] | [02 Sciforium 连通性测试](02-llm-smoke.md) | — | 30 分钟 | 周六 17:00 |
| [ ] | [03 planner 在 testpage 上自主运行](03-planner-testpage.md) | 02 | 1–1.5 小时 | **周六 18:00（关键路径）** |
| [ ] | [04 修复闭环（testpage）](04-fix-loop-testpage.md) | 01、03 | 1 小时 | 周六 19:30 |
| [ ] | [05 假电商站](05-fake-shop.md) | 01 | 2 小时 | 周六 20:00 |
| [ ] | [06 D6 仅鼠标可用](06-d6-pointer-only.md) | 01 | 45 分钟 | 周六 20:00 |
| [ ] | [07 D5 焦点可见性](07-d5-focus-visible.md) | 06 | 1 小时 | 周六 22:00 |
| [ ] | [08 真实网站模式与预跑](08-real-site-mode.md) | 01、03 | 1–1.5 小时 | 周六 22:00 |
| [ ] | [09 judge 与噪音调优](09-judge-and-noise.md) | 03、05、08 | 1.5 小时 | 周日 10:00 |
| [ ] | [10 评测流水线](10-eval-pipeline.md) | 05、09 | 1.5 小时 | 周日 10:00 |
| [ ] | [11 假站闭环与 CI](11-shop-loop-and-ci.md) | 04、05 | 1 小时 | 周日 11:00 |
| [ ] | [14 报告 viewer](14-report-viewer.md) | 01 | 1.5 小时 | 周六 22:00 |
| [ ] | [12 demo 回放与演练](12-demo-rehearsal.md) | 以上全部（含 14） | 1 小时 | 周日 12:30 |
| [ ] | [13 （可选）视觉层检查](13-optional-vision.md) | 12 | — | 仅当主线全部完成 |

01 和 02 互不依赖，可以同时开工；01 完成后 05、06 也能并行。06 和 07 都会改 testpage 和 fixture，所以必须先后做。03 是关键路径：08 的真实网站预跑必须有 planner。14 只依赖 01，之后随时可以并行做。

## 硬截止

- 周日 12:30 功能冻结，只修 bug 和演练
- 周日 13:00 提交 submission PR（`prior_work` 必填）
- 周日 14:00 代码冻结，评委看 `main` 最新 commit
