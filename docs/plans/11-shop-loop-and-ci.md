# 11 — 假站修复闭环与 CI

**目标：** demo 主线在假站上完整成立：发现 → 修复 → 重跑通过；CI 改为检查假站。

**依赖：** 04、05　**预计：** 1 小时

**先读：** `docs/plans/04-fix-loop-testpage.md` 的结果、`src/fix/**`、`.github/workflows/a11y-audit.yml`

**可以改：** `src/fix/**`、`src/agent/prompts/fixer.md`、`.github/workflows/a11y-audit.yml`
**不要改：** `sites/shop/original/`、`sites/shop/fixed/`

## 步骤

1. 在假站 original 主流程上跑带 judge 的 audit → `fix --site sites/shop/original` → `rerun`。
2. 对照 `sites/shop/fixed/` 检查 fixer 的每条 edit，方向不对就调 `fixer.md`（不要写死假站的具体元素）。
3. 连续跑 2 次都得到 `closedLoop: true` 才算通过。把最终那次的 run 目录名记在本文件"结果"一节，12 的 demo 回放会用它。
4. CI：把 workflow 里的 testpage 换成假站 fixed 的主流程（`--script eval/keys.shop.main.json --no-judge --fail-on block`），push 后确认 Actions 变绿。

## 验收

- 假站主流程 `closedLoop: true`，两次都成立。
- 原来的 block 问题全部 resolved，没有 new。
- GitHub Actions 在假站 fixed 上通过。

## 结果

2026-09-27。goal 用 `eval/groundtruth/shop-main.yaml` 里的：`Buy a canvas tote bag. Pay with card 4000 0000 0000 0002; if it is declined, use 4242 4242 4242 4242.`

**状态：完成。** planner 版闭环连续 2 次 `closedLoop: true`，脚本版闭环也是 2 次，CI 在假站 fixed 上是绿的。

**本次按要求超出了"可以改"的范围**（09 推送之后经用户同意）：`src/agent/observation.mjs`、`src/contracts.mjs` 的 `MAX_STEPS`，
以及随之更新的 `test/pipeline.test.mjs`、`test/planner.test.mjs`、`docs/API.md`、`docs/REPORT_FORMAT.md`、`docs/report.schema.json`、`docs/report.example.json`。

### 1. planner 版闭环（给 12 的 demo 用这个）

**第一轮被卡住。** planner 在 original、fixed（人工修复的标准答案）、patched 上都是 25 步用完就 stuck。连标准答案都跑不通，说明问题不在 fixer。trace 里能看到两个根因：

1. **planner 的 history 每步只保留前 3 条 heard**（`observation.mjs` 的 `heardInStep(s).slice(0, 3)`）。购物车弹窗打开那一步 heard 有 10 条，`Canvas Tote Bag $24.00` 排在第 7 条。下一步 planner 只记得 `Wool Beanie $18.00`，以为托特包没加进去，于是 Escape、回去再加、再打开购物车，一直绕圈。stuck 的理由原话是 "The cart dialog only announced 'Wool Beanie $18.00'"。
2. **`MAX_STEPS = 25` 太紧**：主流程最短路线（`eval/keys.shop.main.json`）是 23 步。只修第 1 点时，planner 在 fixed 上走到结账页，卡被拒，换备用卡，第 25 步按下 Pay，然后因为步数用完成了 max-steps。

**修复**（都是先写的失败测试）：
- history 里每步的 heard 保留 12 条。这不影响信息隔离：内容仍然只是辅助技术播报过的，`heardThisStep` 本来就给全量。测试：弹窗第 7 行在下一步的 history 里还在。
- `MAX_STEPS` 25 → 40。测试：`MAX_STEPS` ≥ 1.5 × `eval/keys.*.json` 里最长的路线。progress.json 和 report.json 的 `maxSteps` 只是值变了，字段没变；文档里写 25 的地方都改成了 40。

**结果**：audit 和 rerun 都用 planner，开 judge（09 已提交的版本），`LLM_CACHE=off`，连续两次（`fix --run <dir> --rerun`）：

| 次 | audit 目录 | original 结果 | 修复前的 block | rerun 目录 | rerun 结果 | closedLoop | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | `runs/2026-09-27T03-47-43-shoploop-planner` | 第 23 步按 Pay 后 stuck："heard no confirmation or error" | F3 `unannounced` B7、F5 `weak-name` B1 | `runs/2026-09-27T03-49-26-rerun` | 第 26 步 done，读到下单确认页 | true | B7、B1 resolved，其余 degrade persists，无 new |
| 2 | `runs/2026-09-27T03-51-06-shoploop-planner` | 第 27 步按 Pay 后 stuck | 同上 | `runs/2026-09-27T03-52-59-rerun` | 第 28 步 done | true | B7、B1、B7 association 都 resolved，无 new |

两次的 original 和 rerun 有 3 次超过了 25 步，所以两处修复缺一不可。

**给 12 用的是第 2 次：`runs/2026-09-27T03-51-06-shoploop-planner`**（runs/ 不提交，12 会在 demo 电脑上用 `LLM_CACHE=readwrite` 重新生成）。
demo 的讲法：planner 用两张卡按 Pay 之后什么都听不到，只能停下；修复后听到 "Card declined"，换备用卡，下单成功。

fixer 默认只修 block，所以 patched 里 B2（加购 toast 不播报）还在，planner 可能会连按几次 Add to cart。这会浪费步数，但不会卡死；要一起修可以加 `--findings`。

### 2. 脚本版闭环（确定性的，planner 出问题时给 12 备用）

audit 和 rerun 都用 `--script eval/keys.shop.main.json`，开 judge，`LLM_CACHE=off`，连续跑两次（`fix --run <dir> --rerun --script eval/keys.shop.main.json`）：

| 次 | audit 目录 | rerun 目录 | 修复前的 block | closedLoop | 状态 |
|---|---|---|---|---|---|
| 1 | `runs/2026-09-27T03-17-52-shoploop-original` | `runs/2026-09-27T03-18-16-rerun` | F3 `unannounced` B7、F5 `weak-name` B1 | true | B7 unannounced、B1、B7 association 都 resolved，其余 degrade persists，无 new |
| 2 | `runs/2026-09-27T03-18-33-shoploop-original` | `runs/2026-09-27T03-18-54-rerun` | 同上 | true | B7、B1 resolved，其余 degrade persists，无 new |

备用的是第 2 次：`runs/2026-09-27T03-18-33-shoploop-original`。
注意：脚本版的 agent 是按脚本走的，`agentCanComplete` 永远是 true，所以这里的 `closedLoop` 意思是"所有 block 都修掉了，也没引入新的"，不代表"planner 能自己走完"。demo 时要照这个意思讲。

### fixer 和 `sites/shop/fixed/` 的差异（脚本版 3 次 + planner 版 2 次，共 5 次 fix）

- B1 🛒：5 次都是 `aria-label="Add to cart"`，和 fixed 完全一样。
- B7 Card declined：fixed 是 `#carderr` 加 `aria-live="assertive"`、`#card` 加 `aria-describedby="carderr"`、JS 里设 `aria-invalid`。fixer 5 次都给 `#carderr` 加 `role="alert"`（等价于 assertive 的 live region），2 次加了 `aria-describedby`，一次也没加 `aria-invalid`。block（错误不播报）每次都修好了；association（degrade，F4）只有加了 describedby 的那两次才 resolved。
- 方向都对，`fixer.md` 没改。
- degrade（B2、B4、B5、B6、B8）默认不修，所以会 persists。

### CI

- workflow 改成审计假站 fixed 的主流程：`--script eval/keys.shop.main.json --no-judge --fail-on block`。
- **发现：不开 judge 时，所有候选都是 degrade**（`judge.mjs` 里 `enabled: false` 就直接 `toFinding(c)`），所以 `--fail-on block` 在 CI 里永远不会失败，原来 testpage 那步也一样。验证过：在 original 上跑同一条命令，9 条 degrade，exit 0。为此加了一步 "Fail on any finding"：fixed 没有埋任何障碍，出现任何 block 或 degrade 都算回归。
- 用已提交的代码在本地验证过（`BASELINE_MS=2000`）：fixed 0 条问题，通过；original 这一步 exit 1。
- GitHub Actions：`49f9994` 的 run 36291368568 通过，所有步骤都是绿的，包括 "Audit the shop's checkout flow" 和 "Fail on any finding"。
