# 07 — D5 焦点可见性

**目标：** 检出"键盘焦点落在元素上，但屏幕上看不出来"的问题（WCAG 2.4.7）。

**依赖：** 01　**预计：** 1 小时

**先读：** `src/runner/session.mjs`、`src/detect/focus.mjs`（`detectFocusVisible` 已写好，读 `step.focusVisible`）、`src/contracts.mjs`

**可以改：** `src/runner/**`、`src/detect/focus.mjs`、`sites/testpage/original/index.html`、`eval/groundtruth/testpage.yaml`、`fixtures/testpage-*`、`test/`、`scripts/smoke.mjs`
**不要改：** `sites/testpage/fixed/`、`src/agent/**`

## 做法（二选一）

**A. 计算样式对比（推荐，无新依赖，同步完成）：**
- 每步焦点落到元素 `el` 上后，在页面里插入一个 `el.cloneNode(true)`，放在同一个父元素里、紧挨着 `el`，加 `data-a11y-probe` 属性，不让它获得焦点。
- 比较 `el`（有焦点）和克隆体（无焦点）的计算样式：`outline-style`、`outline-width`、`outline-color`、`box-shadow`、`border-color`、`background-color`、`color`、`text-decoration-line`。**全部相同** → 获得焦点时外观没有变化 → `focusVisible = false`。比较完立即移除克隆体。
- `recorder.js` 要忽略带 `data-a11y-probe` 的元素产生的变化，否则会被当成"新出现的文字"。
- 已知漏洞：焦点样式写在父元素的 `:focus-within` 上时会误判为不可见。这种情况交给 judge 过滤，并在 README 的限制里写明。
- 不要用"焦点离开后再截图对比"的做法：焦点离开时页面常常同时变化（比如弹窗遮罩盖住按钮），会把不可见误判成可见。

**B. 接入 keyboard-a11y-tester（MIT）：** 复用它的计算样式 + 像素对比检测。需要在 README 注明来源和改动，会新增依赖，先在群里说一声。

## 步骤

1. 按 A 或 B 实现，填 `step.focusVisible`（`true` / `false` / 无法判断时 `null`）。
2. testpage original 里给 Checkout 按钮加 `outline: none`，标 `data-barrier="T6"`，`testpage.yaml` 加 T6（`wcag: ["2.4.7"]`）。
3. 重新生成 fixture，更新测试和 smoke 的数量断言。

## 验收

- T6 被检出；fixed 0 误报。
- `npm test`、`npm run smoke` 通过。
- 每步增加的耗时 < 150ms（在 trace 的时间戳里看）。
