# 10 — 评测流水线

**目标：** 一条命令产出可以直接贴进 README 的对比表：我们 vs axe（vs keyboard-a11y-tester），加上 judge 开/关的消融。

**依赖：** 05、09　**预计：** 1.5 小时

**先读：** `docs/ARCHITECTURE.md` §9、`eval/score.mjs`、`eval/groundtruth/*.yaml`、`src/audit.mjs`（`analyze()` 可以对已有 trace 重跑检测和 judge）

**可以改：** `eval/**`、新建 `sites/bad/`（W3C BAD 的本地副本）、`README.md` 的 Results 一节
**不要改：** `src/**`（发现检测器问题就在对应计划里记下来，不要在这里顺手改）

## 步骤

1. 写 `eval/run.mjs`（`node eval/run.mjs`），依次：
   - 对假站 original/fixed 的两条流程，用预录按键脚本各跑一次 `audit --no-judge`（保证各工具看到的页面状态一致）；
   - 对每条 trace 再用 `analyze()` 开启 judge 跑一遍（**消融**：同一条 trace，judge 开/关）；
   - 用 `scoreRun` 给 ours（judge 关）、ours（judge 开）、axe（WCAG 规则）打分；
   - 输出 Markdown 表：数据集 × 工具 → 埋入数、检出、漏检、误报；另起一张表列出 judge 开/关的误报数对比。
2. **W3C BAD**：下载 W3C Before and After Demonstration 的 after（已修复）版本放到 `sites/bad/after/`，写一个简单任务流的按键脚本，只统计误报（`barriers: []`）。如果下载或许可有问题，跳过并在 README 里说明。
3. （可选）keyboard-a11y-tester：用它的 serve 模式按我们 trace 里的按键序列重放，取它的结果打分。如果集成超过 30 分钟，就沿用可行性验证时的手工结果，并在表下注明方法。
4. 把结果表贴进 README 的 "Results so far"，替换 testpage 的临时表。

## 验收

- `node eval/run.mjs` 一条命令跑完，打印两张表，退出码 0。
- README 里的数字都能用这条命令复现。
- 开启 judge 那一列需要 `.env` 里的 key；没有 key 时脚本跳过该列并提示，而不是报错退出。

## 注意

- 表里的"axe"只统计带 WCAG 标签的规则，best-practice 规则另列，否则对比不公平。
- 假站障碍中 `detectable: vision-only` 的（文字印在图片上），在我们的"检出"里如实算作漏检，除非 13 做完了。
