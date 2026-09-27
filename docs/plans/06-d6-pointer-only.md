# 06 — D6 仅鼠标可用

**目标：** planner 卡住时，找出"页面上看得见、能点，但键盘永远到不了"的控件，解释为什么卡住。

**依赖：** 01　**预计：** 45 分钟

**先读：** `src/detect/focus.mjs`（`detectPointerOnly` 已写好，等 runner 提供数据）、`src/runner/session.mjs`、`src/runner/recorder.js`、`src/contracts.mjs`

**可以改：** `src/runner/recorder.js`、`src/runner/session.mjs`、`src/detect/focus.mjs`、`src/contracts.mjs`（只加可选字段的注释）、`sites/testpage/original/index.html`、`eval/groundtruth/testpage.yaml`、`eval/keys.testpage.json`、`fixtures/testpage-*`、`test/`、`scripts/smoke.mjs`
**不要改：** `sites/testpage/fixed/`

## 步骤

1. 在 `recorder.js` 里加 `unreachableClickables()`：找出可见、看起来可点击（有 `onclick` 属性或事件、`cursor: pointer`、`role=button` 但没有 `tabindex`），但**不可聚焦**（不是原生可聚焦元素，且没有 `tabindex >= 0`）的元素，返回 `{selector, barrierId, text}`，最多 20 个。
2. `session.step()` 在 `action.kind === 'stuck'` 时调用它，把结果写进 step 的 `unreachableClickables`。
3. 在 `contracts.mjs` 的 Step 注释里加上这个可选字段。
4. 在 testpage **original** 里加一个只能用鼠标点的 `<div data-barrier="T5" onclick=...>Apply coupon</div>`，`testpage.yaml` 加 T5（`wcag: ["2.1.1"]`）。只加在 original。
5. 重跑两个 fixture 并覆盖 `fixtures/testpage-original`、`fixtures/testpage-fixed`（trace、report、shots），更新 `test/pipeline.test.mjs` 里的数量断言（4 → 5）。

## 验收

- `npm test` 通过，并有一条新测试断言 T5 被 D6 检出。
- `npm run smoke` 通过（smoke 里的 4/4 相应改成 5/5）。
- fixed 仍然 0 误报。

## 注意

- 带 `cursor: pointer` 的元素在真实网站上很多（整张商品卡片都可能是），只在 stuck 时扫描，并交给 judge 过滤。
- 重新生成 fixture 后步骤编号会变，commit message 里写清楚。

## 结果

- 完成。testpage original 检出 5/5、0 误报；fixed 0 误报；`npm run smoke` 6/6 通过。D6 在 original 上只报 `#coupon`（T5），原生按钮及其内部文字不会误报。
- 上限 `MAX_UNREACHABLE = 20` 放进了 `contracts.mjs`（`test/standards.test.mjs` 要求 recorder 的阈值都来自 contracts）。
- 重新录制后 fixture 步骤数不变（original 14 步、fixed 18 步），只有最后的 stuck 步多了 `unreachableClickables`；fixed 第 5 步现在带有 AX value `'4242 4242'`，相应调整了 focusValue 测试。
- 待办（不在本计划可改范围）：`docs/ARCHITECTURE.md` 第 7 行仍写"原版检出 4/4"，应改成 5/5。
