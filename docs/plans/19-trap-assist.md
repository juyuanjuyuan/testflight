# 19 键盘陷阱检测改为焦点转移图 + 协助者介入

## 目标

planner 试探弹窗陷阱时 Tab、Shift+Tab、Escape 混着按（规则 6），旧检测器要求"连续同方向 Tab 重复两整轮"，一次也没凑齐，
shop 优惠码的 Members only 弹窗（B9）没被报出来；planner 在里面耗到 40 步上限，后面的障碍也走不到。

1. D2 改成焦点转移图（`src/detect/trap.mjs`），规则见 `docs/ARCHITECTURE.md` §5。
2. 陷阱确认后由 runner 模拟"看得见屏幕的协助者"用鼠标点弹窗的关闭元素，运行继续（`src/runner/assist.mjs`），见 §6。

## 可以改

`src/detect/*`、`src/runner/assist.mjs`、`act.mjs`、`session.mjs`、`recorder.js`、`src/audit.mjs`、`src/contracts.mjs`、
`src/agent/observation.mjs`、`planner.mjs`、`prompts/judge.md`、`src/verdicts.mjs`、`docs/`、`test/`。

## 验收

```bash
npm test && npm run smoke
node cli.mjs audit --url http://localhost:8080/shop/original/ --site sites/shop/original --goal 'use the coupon code "ABC"  to buy anything'
```

## 结果

- 回归测试 `test/pipeline.test.mjs`（混合按键的陷阱）先失败后通过；协助的测试在 `test/assist.test.mjs`。eval traces 上的陷阱（B9、B11、T4）照常检出，
  shop-second 的证据步骤从 12,13,15 变为 13,14,15（最新一次的转移）。
- 实跑上面的任务：第 33 步确认陷阱，第 34 步协助者点了 ×，planner 继续到优惠码框；block 3 个：B9 陷阱、B1 🛒、B10 Apply 只能用鼠标点。
  B7（卡被拒没有朗读）仍没走到：planner 要先应用优惠码才付款，而 Apply 只能用鼠标点。若也要覆盖，需要第二种协助（stuck 时替它点
  D6 找到的元素），尚未做。
- 步数上限不变（40），每次协助加 20：`stepsLeft` 在每个 planner 请求里，改上限会让全部 planner 缓存失效。planner 的 system prompt 也没改。
  judge prompt 的陷阱说明改了，judge 缓存需要重新录（plan 12）。

### 需要前端做的（后端不改 viewer/、FRONTEND/）

- `timeline[].action.kind` 新增 `assist`（不是 AI 的操作，是协助者用鼠标点击，`action.target` 是被点的元素）。现在两个前端都原样显示 `assist`
  和 reason，不会坏；建议换成单独样式，例如"协助者介入"。
- `verdicts.assistedSteps`（只在有协助时出现）：结论旁可以注明"需要协助"，此时 `agentCanComplete` 一定是 false。
- `meta.maxSteps` 可能是 60、80（本地 40 + 每次协助 20）。
