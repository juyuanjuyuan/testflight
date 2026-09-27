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
judge 用的是当时工作区里 09 正在调的 `judge.md`（未提交）。

**状态：脚本版闭环和 CI 已完成；planner 版闭环被本计划范围外的两处代码卡住，所以没打勾。** 这两处的改法已经在隔离的 worktree 里验证过，见下文。

### 1. planner 版闭环（本计划的原意）：被卡住

| 站点 | 结果 |
|---|---|
| original，带 judge | 25 步用完 stuck，没走到结账页。0 条 block（F2 🛒 被标成 degrade，属于 09 的范围），`unexplainedStuck: true`，fixer 没有可修的 block |
| **fixed（人工修复的标准答案）** | 同样 25 步用完 stuck |
| patched（fixer 修了 B1、B7），`LLM_CACHE=off` | 同样 25 步用完 stuck |

连标准答案都跑不通，说明问题不在 fixer。trace 里能看到两个根因：

1. **planner 的 history 每步只保留前 3 条 heard**（`src/agent/observation.mjs` 的 `heardInStep(s).slice(0, 3)`）。购物车弹窗打开那一步 heard 有 10 条，`Canvas Tote Bag $24.00` 排在第 7 条。下一步 planner 只记得 `Wool Beanie $18.00`，以为托特包没加进去，于是 Escape、回去再加、再打开购物车，一直绕圈。stuck 的理由原话是 "The cart dialog only announced 'Wool Beanie $18.00'"。
2. **`MAX_STEPS = 25` 太紧**：主流程最短路线（`eval/keys.shop.main.json`）是 22 个动作加 done，只剩 2 步余量。只修第 1 点时，planner 在 fixed 上走到结账页，卡被拒，换备用卡，第 25 步按下 Pay，然后因为步数用完成了 max-steps。

**已验证的改法**（在隔离 worktree 里改的，没提交）：history `slice(0, 3)` → `slice(0, 12)`，`MAX_STEPS` 25 → 40，`LLM_CACHE=off`。
original（planner + judge）在第 23 步 Pay 之后 stuck，理由是 "heard no confirmation or decline message"。F3 `unannounced` B7 被标 block，fixer 修了 1 条 edit。planner 重跑结果 done，`closedLoop: true`，B7 resolved，没有 new。`npm test` 87/87 通过。这个只跑了 1 次，验收要求 2 次。

**需要有人做**（不在本计划"可以改"里，所以我没改）：
- `src/agent/observation.mjs`：history 里的 heard 多留几条（比如 12）。这不影响信息隔离：内容仍然只是辅助技术播报过的，`heardThisStep` 本来就给全量。
- `src/contracts.mjs`：`MAX_STEPS` 调到 40。09 正在改这个文件，等 09 提交之后再改。progress.json 的 `maxSteps` 会跟着变，只是值变了，字段没变。
- 改完按本计划步骤 1–3 用 planner 重跑两次，把 run 目录名补到这里。

另外，fixer 默认只修 block，所以 patched 里 B2（加购 toast 不播报）还在，planner 会连按 3–4 次 Add to cart。这不会卡死，但会浪费步数；要一起修可以加 `--findings`。

### 2. 脚本版闭环（确定性的，12 可以直接用来回放）

audit 和 rerun 都用 `--script eval/keys.shop.main.json`，开 judge，`LLM_CACHE=off`，连续跑两次（`fix --run <dir> --rerun --script eval/keys.shop.main.json`）：

| 次 | audit 目录 | rerun 目录 | 修复前的 block | closedLoop | 状态 |
|---|---|---|---|---|---|
| 1 | `runs/2026-09-27T03-17-52-shoploop-original` | `runs/2026-09-27T03-18-16-rerun` | F3 `unannounced` B7、F5 `weak-name` B1 | true | B7 unannounced、B1、B7 association 都 resolved，其余 degrade persists，无 new |
| 2 | `runs/2026-09-27T03-18-33-shoploop-original` | `runs/2026-09-27T03-18-54-rerun` | 同上 | true | B7、B1 resolved，其余 degrade persists，无 new |

**给 12 用的是第 2 次：`runs/2026-09-27T03-18-33-shoploop-original`**（runs/ 不提交，12 会在 demo 电脑上用 `LLM_CACHE=readwrite` 重新生成）。
注意：脚本版的 agent 是按脚本走的，`agentCanComplete` 永远是 true，所以这里的 `closedLoop` 意思是"所有 block 都修掉了，也没引入新的"，不代表"planner 能自己走完"。demo 时要照这个意思讲。

### fixer 和 `sites/shop/fixed/` 的差异（共 3 次 fix）

- B1 🛒：3 次都是 `aria-label="Add to cart"`，和 fixed 完全一样。
- B7 Card declined：fixed 是 `#carderr` 加 `aria-live="assertive"`、`#card` 加 `aria-describedby="carderr"`、JS 里设 `aria-invalid`。fixer 3 次都给 `#carderr` 加 `role="alert"`（等价于 assertive 的 live region），1 次加了 `aria-describedby`，一次也没加 `aria-invalid`。block（错误不播报）每次都修好了；association（degrade，F4）只有加了 describedby 那次才 resolved。
- 方向都对，`fixer.md` 没改。
- degrade（B2、B4、B5、B6、B8）默认不修，所以会 persists。

### CI

- workflow 改成审计假站 fixed 的主流程：`--script eval/keys.shop.main.json --no-judge --fail-on block`。
- **发现：不开 judge 时，所有候选都是 degrade**（`judge.mjs` 里 `enabled: false` 就直接 `toFinding(c)`），所以 `--fail-on block` 在 CI 里永远不会失败，原来 testpage 那步也一样。验证过：在 original 上跑同一条命令，9 条 degrade，exit 0。为此加了一步 "Fail on any finding"：fixed 没有埋任何障碍，出现任何 block 或 degrade 都算回归。
- 用已提交的代码在本地验证过（`BASELINE_MS=2000`）：fixed 0 条问题，通过；original 这一步 exit 1。
- GitHub Actions：（push 后填写）
