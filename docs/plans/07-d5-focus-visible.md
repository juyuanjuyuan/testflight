# 07 — D5 焦点可见性

**目标：** 检出"键盘焦点落在元素上，但屏幕上看不出来"的问题（WCAG 2.4.7）。

**依赖：** 06（06 和 07 都改 testpage original、fixture 和数量断言，必须先后做）　**预计：** 1 小时

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

## 结果

- 完成，用方案 A（计算样式对比，无新依赖）。testpage original 检出 6/6、0 误报；fixed 0 误报；`npm test` 53/53、`npm run smoke` 7/7 通过。
- `recorder.js` 的 `focusVisible()`：在焦点元素后面插入克隆体（带 `data-a11y-probe`），比较元素本身和 `::before`/`::after` 的 outline、四边 border、box-shadow、背景色/背景图、文字颜色、下划线、opacity、transform；outline/border 只有真正画出来（style 不是 none/hidden 且宽度 > 0）时才比颜色。克隆体在同一个任务里移除，不会被绘制，也拿不到焦点；recorder 的 MutationObserver 忽略它。`session.mjs` 在 snapshot 里和 `modalOpen` 放在同一次 `evaluate` 里取值。
- 比计划多做的两点（都是为了减少真实网站上的误报）：
  - 焦点**到达那一刻**（window 捕获阶段的 `focus` 事件，早于页面自己的处理函数）记下元素的属性，克隆体用这份属性。否则 MUI 的 `Mui-focusVisible`、React Aria 的 `data-focus-visible` 这类由 JS 加上的焦点 class/属性会被一起复制，克隆体也带焦点样式，结果被误判为不可见。
  - 返回 `null`（无法判断）的情况：焦点在 body 上；焦点在 iframe/frame/object/embed 或 shadow host 上；元素本身不可见或宽/高 ≤ 1px（sr-only、opacity:0 的自定义复选框，焦点环画在相邻的 label 上）。
- 已知漏洞（按计划交给 judge，并写进了 README 的 Limits）：焦点样式只写在父元素的 `:focus-within` 上时会误判为不可见。
- 耗时：直接测量，每次检查 2–11 ms。trace 时间戳里相邻步骤的间隔中位数：original 364 → 367 ms，fixed 约 355 → 352 ms，都在噪声范围内（间隔主要由 settle 轮询和 700 ms 的轮播决定），远低于 150 ms。
- 重新录制后 fixture 步骤数不变（original 14 步、fixed 18 步）。original 第 3 步（Tab 到 Checkout）`focusVisible: false`，所有 body 步为 `null`，其余都是 `true`。新增的 focus-visible 候选排在 pointer-only 之前，所以 pointer-only 的 finding 编号从 F6 变成 F7。
- 测试：`test/pipeline.test.mjs` 新增两条（T6 被 D5 检出、只在焦点停在 Checkout 的步骤上；两个 fixture 每一步的 `focusVisible` 都符合预期）。smoke 新增 `focus-visible` 用例，在真实浏览器里覆盖默认焦点环、`outline:none`、box-shadow 焦点环、`::after` 焦点环、焦点处理函数加的 class、sr-only 输入框，并检查克隆体不会被记成页面变化。
- 按计划改了 `README.md` 的 Limits（计划正文要求写明已知漏洞，但"可以改"里没列 README）。
- 待办（不在本计划可改范围）：
  - `docs/ARCHITECTURE.md` 第 9 行仍把 D5 列为"未做"，第 72 行写"runner 目前填 null"；第 7 行和 README 的结果表还写着 testpage 原版 4/4，现在是 6/6。
  - 给计划 09 的观察：recorder 按行对比文字。行内元素（inline 的 button、链接、span）只改 class/style 时，它自己的文字不是 `document.body.innerText` 里单独的一行，会被当成"新出现的文字"记进 `changes`。写 smoke 用例时碰到过（焦点处理函数给行内按钮加 class），和 D5 无关，可能是真实网站上的一个噪音来源。

