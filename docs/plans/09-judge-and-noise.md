# 09 — judge 与噪音调优

**目标：** 让 judge 在假站和真实网站上把无关变化（轮播、推荐、倒计时）过滤掉，并按"是否阻断任务"正确分级。

**依赖：** 03、05（需要假站的 trace）、08（需要真实网站的 trace）　**预计：** 1.5 小时

**先读：** `docs/ARCHITECTURE.md` §5–6、`src/agent/judge.mjs`、`src/agent/prompts/judge.md`、`src/detect/**`、`src/runner/recorder.js`（噪音计数）

**可以改：** `src/agent/judge.mjs`、`src/agent/prompts/judge.md`、`src/contracts.mjs` 里的噪音相关常量（`BASELINE_MS`、`NOISE_REPEAT`、`CHANGE_WINDOW_MS`）
**不要改：** 让 judge 能新增问题（它只能标注检测器的候选）

## 步骤

1. 收集 trace：假站两条流程的 original/fixed 各一条，真实网站预跑的 2–3 条。
2. 对每条 trace 跑 `replay --no-judge` 和 `replay`（开启 judge），对比两者的候选和结果。
3. 逐条看误判：
   - 噪音没被过滤 → 先考虑调确定性参数（`BASELINE_MS`、`NOISE_REPEAT`），不行再改 prompt；
   - 分级不对（比如把卡被拒未播报标成 degrade）→ 在 prompt 里补充判断标准，不要写死具体元素；
   - 🛒 这类名称判断不稳定 → 在 prompt 里给出判断准则。
4. 每改一次都重跑全部 trace，确保没有把之前正确的结果改错。
5. 在本文件"结果"一节记下调整前后的误报数。

## 验收

- 假站 fixed：两条流程开启 judge 后 0 条 block/degrade。
- 假站 original：所有埋入的阻断问题被判为 block。
- 真实网站 trace：轮播、推荐类变化不再出现在报告里。

## 结果

（完成后填写：每条 trace 在 judge 开/关时的误报数）
