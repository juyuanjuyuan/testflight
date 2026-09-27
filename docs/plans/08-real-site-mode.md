# 08 — 真实网站模式与预跑

**目标：** 让工具接管一个人手动打开的 Chrome，在真实电商网站上检测（不修复、不付款），并在周六晚上预跑 3–5 个网站、缓存结果，供 demo 第二段使用。

**依赖：** 01、03（真实网站没法预录按键，必须有 planner）　**预计：** 1–1.5 小时

**先读：** `docs/ARCHITECTURE.md` §10–11、原《工程架构》文档的"真实网站模式"一节、`src/runner/session.mjs`、`src/runner/guard.mjs`、`src/audit.mjs`

**可以改：** `src/audit.mjs`、`src/runner/session.mjs`、`src/runner/guard.mjs`、`cli.mjs`、新建 `scripts/real-chrome.sh`；做 `shotSize` 时另加 `src/contracts.mjs`（只加可选字段）、`src/report/build.mjs`、`fixtures/testpage-*`、`test/`、`docs/report.schema.json`、`docs/REPORT_FORMAT.md`、`docs/report.example.json`
**不要改：** 放宽 `guard.mjs` 的任何限制

## 步骤

1. **暂停等人**：`audit()` 新增可选参数 `waitForUser`（返回 Promise 的回调）。real 模式下 `start()` 之后先 `await o.waitForUser?.()`，再进入 agent 循环。`src/` 不读终端、不打印：提示语“处理完验证码/cookie 弹窗后按回车开始”和 `node:readline` 交互只写在 `cli.mjs` 里，由 cli 作为回调传入。**cookie 弹窗不要替它关**：它本身就是测试对象。
   同时让 real 模式下的 `--url` 变成可选：`cli.mjs` 只在 local 模式下要求 `--url`；real 模式没有传时，用接管的标签页当前 URL（`meta.url` 记录实际 URL）。
2. **启动 Chrome**：写 `scripts/real-chrome.sh`，用单独的用户目录启动带远程调试的 Chrome：
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/a11y-real-profile
   ```
   在 WSL 里通过 WSLg 显示窗口；如果 WSL 里没装 Chrome，按脚本注释安装。
3. **连通测试**（real 模式不需要 `--url`）：`node cli.mjs audit --mode real --cdp http://localhost:9222 --goal "Search for a tote bag and add it to the cart"`，确认能接管已打开的标签页、按回车后开始、到结账页自动停止。
4. **验证安全限制**：确认 `guard.mjs` 会拒绝在卡号、CVV、密码框里输入，URL 或标题出现 checkout/payment 时自动结束。
5. **预跑**：挑 3–5 个公开电商网站（避开 Glasswing portfolio 公司），goal 只到"加入购物车"为止。结果统一放 `runs/real/`（已 gitignore），挑结果最清晰、流程最稳定的一个作为 demo 用，在本文件"结果"一节记下选了哪个、为什么（**不要写公司名**，用"候选 1/2/3"代替）。

## 验收

- 能完整接管、暂停、运行、在结账前停止。
- 至少一个真实网站跑出"加购成功但未播报"之类的清晰问题，且缓存了完整结果。
- repo 里没有任何真实网站的运行结果或公司名。

## 注意

- 如果 WSL 连不上 Windows 那边的 Chrome（WSL2 NAT 网络的问题），就直接在 WSL 里用 WSLg 启动 Chrome，不要折腾网络配置。
- 被反爬拦截时如实记录，换下一个网站。
- 真实网站模式下截图尺寸不固定（连的是用户自己的 Chrome，窗口大小和 devicePixelRatio 都不受控，本地模式固定为 1280×800、DPR 1）。每一步要记录截图的宽高，作为 Step 的**可选**字段（例如 `shotSize: {w, h, dpr}`，按 `docs/ARCHITECTURE.md` §3 的规则在 `contracts.mjs`、fixture 和测试里同步），并由 `report/build.mjs` 带到 `timeline[]`；同步更新 `docs/report.schema.json`、`REPORT_FORMAT.md` 和 `report.example.json`（新字段在 schema 里必须是可选的，`npm test` 的 `test/report-schema.test.mjs` 会检查）。**需要前端配合：** viewer 按这个实际尺寸把 `focusRect` / `seen[].rect`（CSS 像素）换算到截图上，而不是假定截图就是 1280×800。本计划不改 `viewer/`，做完后在“结果”一节写明新字段名和含义，交给前端。

## 结果（进行中：代码和安全限制已完成，planner 预跑等 `.env`）

**已完成**
- 步骤 1：`audit({ waitForUser })`，`cli.mjs` 用 `node:readline` 提示“解决验证码/登录后按回车”（stdin 关闭时也会继续，方便管道）。cookie 弹窗不替用户关。real 模式 `--url` 可选：不传就接管当前**可见**的标签页；传了就先把这个标签页导航过去，再等人。`meta.url` 记录 step 0 的实际 URL。
  - **与计划的差异**：等人发生在 `start()` **之前**（`openSession` 内，选标签页之前），不是之后。原因：`start()` 会记录 step 0（基线、焦点、pageText、截图、axe），如果人在那之后才去过验证码或换页面，step 0 描述的是 agent 从没见过的页面，`current` 焦点也是旧的。
  - 结束时 `browser.close()` 只断开 CDP 连接（Playwright 对 connectOverCDP 的行为），人的 Chrome 和标签页都保留，CLI 能正常退出。
- 步骤 2：`scripts/real-chrome.sh [url…]`。macOS / Linux / WSL（WSLg）都能用，单独的 profile（默认 `/tmp/a11y-real-profile`，没有日常登录、银行卡或自动填充），`CDP_PORT`、`A11Y_PROFILE`、`CHROME_BIN` 可覆盖。
- 步骤 4：guard 测试补上了密码、CVV、有效期字段，以及 checkout/payment/billing 按 URL 或标题停止（`test/pipeline.test.mjs`）。`audit()` 现在**先**检查结账边界，再问 planner：到结账页后不会再调用 LLM，也不会再执行任何动作。端到端验证（本地 shop，real 模式，预录按键）：第 17 步进入 `checkout.html`，第 18 步 `done: reached checkout boundary`，卡号没有输入；data: 页面上往密码框输入被拒绝（`stuck`），trace 里没有这段文字。
- `shotSize`：见下文“交给前端”。`fixtures/testpage-*` 已用当前 runner 重录（只有 `dtMs` 抖动和新增的 `shotSize` 不同）。`npm test` 57/57，`npm run smoke` 7/7。
- 步骤 3 的连通测试（**预录 Tab，没有 planner**）：候选 1、候选 2 的首页都能正常加载（没有反爬拦截页），接管、回车开始、记录、断开都正常。结果在 `runs/real/*-conn-cand{1,2}`（已 gitignore）。

**未完成（阻塞）**
- 步骤 3 的 planner 连通测试和步骤 5 的预跑：这台机器上没有 `.env`（没有 Sciforium key），也没有 LLM 缓存。有了 `.env` 之后运行：
  ```bash
  scripts/real-chrome.sh https://<site>/          # 单独开一个终端
  node cli.mjs audit --mode real --cdp http://localhost:9222 --goal "Search for a tote bag and add it to the cart" --out runs/real --label cand1
  ```
- 验收里的“加购成功但未播报”还没跑出来，所以本计划还没勾选。

**给计划 09 的观察**：候选 1 上预录 Tab 后 `stuck` 且关闭 judge 时，D6 报了 9 个 pointer-only 的 block 候选（首页卡片）。这些要靠 judge 过滤。搜索分类下拉框没有名称（`combobox ""`），这是真实问题。

**交给前端（viewer 需要配合）**：`timeline[].shotSize = {w, h, dpr}`，表示截图的实际像素宽高和 devicePixelRatio；没有截图时为 `null`，旧报告里没有这个字段（按 1280×800、dpr 1 处理）。`focusRect`、`seen[].rect` 都是 **CSS 像素**，画框时用：`rect × dpr × (显示宽度 / shotSize.w)`。本地模式固定 `{1280, 800, 1}`；真实网站模式下，Retina Mac 上候选 1 实测是 `{w: 2560, h: 1522, dpr: 2}`，所以按 1280 缩放会整体错位一倍。详见 `docs/REPORT_FORMAT.md` §4。
