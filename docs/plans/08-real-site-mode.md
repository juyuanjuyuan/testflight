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

## 结果

**范围调整（执行中发现，已在此说明）**：在真实网站上跑时暴露了两个阻塞问题，修复它们需要改“可以改”之外的文件：
- `src/runner/recorder.js`（D6）：`unreachableClickables` 只检查祖先是否可 Tab 到，不检查后代。大型电商的按钮常见结构是 `<span class="button" id=…><input type=submit aria-label="Add to cart">`，外层 span 被误报为“仅鼠标可用”，judge 还把它们判成了 block（候选 1 一次运行 12 条 block 全是误报）。修复：内部含有可聚焦控件（opacity 0 也算）的包裹元素不算。回归用例是 `scripts/smoke.mjs` 里的 `pointer-only`（先写的用例，确认失败后才修）。本地 shop 三个流程修复前后得分一致。
- 步数：`MAX_STEPS = 25` 对只按 Tab 的 planner 来说连大型网站的页头都走不完。新增 `MAX_STEPS_REAL = 80`（`contracts.mjs`），`planner.mjs` 的 `nextAction` 接收 `maxSteps`（默认仍是 `MAX_STEPS`）。本地模式发给 planner 的消息完全不变，已有的 LLM 缓存仍然有效。

**已完成**
- 步骤 1：`audit({ waitForUser })`，`cli.mjs` 用 `node:readline` 提示“解决验证码/登录后按回车”（stdin 关闭时也会继续，方便管道）。cookie 弹窗不替用户关。real 模式 `--url` 可选：不传就接管当前**可见**的标签页；传了就先把这个标签页导航过去，再等人。`meta.url` 记录 step 0 的实际 URL。
  - **与计划的差异**：等人发生在 `start()` **之前**（`openSession` 内，选标签页之前），不是之后。原因：`start()` 会记录 step 0（基线、焦点、pageText、截图、axe），如果人在那之后才去过验证码或换页面，step 0 描述的是 agent 从没见过的页面，`current` 焦点也是旧的。
  - 结束时 `browser.close()` 只断开 CDP 连接，人的 Chrome 和标签页都保留，CLI 能正常退出。
- 步骤 2：`scripts/real-chrome.sh [url…]`。macOS / Linux / WSL（WSLg）都能用，单独的 profile（默认 `/tmp/a11y-real-profile`，没有日常登录、银行卡或自动填充）。
- 步骤 4：guard 测试补上了密码、CVV、有效期字段，以及 checkout/payment/billing 按 URL 或标题停止。`audit()` 现在**先**检查结账边界，再问 planner：到结账页后不会再调用 LLM，也不会再执行任何动作。在本地 shop 上用 real 模式验证过：进入 `checkout.html` 后下一步就是 `done: reached checkout boundary`，卡号没有输入；往密码框输入被拒绝，trace 里没有这段文字。
- 步骤 3、5：在两个网站上预跑（用户给了 2 个；计划建议 3–5 个，之后可以再加）。每次交给 planner 之前，都先加载页面确认不是验证码或反爬页。结果在 `runs/real/`（已 gitignore），LLM 响应在 `.cache/llm`。
  - **候选 1**：没有反爬拦截，搜索成功（第 6–7 步），但 80 步用完也没走到商品。原因是 planner 只会按 Tab、不会用跳转链接；页面 AX 文本开头是页脚标题，planner 误以为自己“卡在页脚”，来回按 Shift+Tab 和 Home。**不适合 demo。** 真实问题：搜索分类下拉框没有名称；搜索提交后焦点掉到 body。
  - **候选 2（选为 demo）**：57 步完成，约 2 分钟。第 54 步在商品页按下 “Add to Bag”，屏幕上出现 “Adding to Bag…”，随后打开了一个“已加入购物袋”面板（`modalOpen: true`）。但焦点掉到 body，读屏用户**什么都没听到**（`heard` 只有 “(focus on page body)”）。agent 只是继续按 Tab 才碰巧发现了 close 按钮和 “View Shopping Bag (1)”。报告里是 F170 `focus-lost`（degrade）。这正是“加购成功但未播报”，而且流程稳定、画面清楚。judge 从 172 个候选里过滤掉了 150 个。
- `shotSize`：见下文“交给前端”。`fixtures/testpage-*` 已用当前 runner 重录（只有 `dtMs` 抖动和新增的 `shotSize` 不同）。

**给计划 09 的观察**
- 候选 2 的 22 条 degrade 里有 17 条是搜索框下拉的“热门搜索 / 自动补全建议没有播报”，属于噪音，应该过滤掉或合并成一条。
- 弹窗打开但焦点没有移进去、也没有播报（候选 2 第 54 步），目前只表现为 `focus-lost`，没有单独的检测。按钮自己的文字从 “Add to Bag” 变成 “Adding to Bag…” 和第 35 步的同名文字被合并成一个候选，judge 判为 none。
- 本 `.env` 里 `MODEL_JUDGE` 和 `MODEL_PLANNER` 是同一个 DeepSeek 模型，所以 judge 实际跑在 DeepSeek 上，不是 GLM。
- （与本计划无关、之前就存在）本地 shop 的 popup 流程在 `--no-judge` 下没检出 B11。

**交给前端（viewer 需要配合）**：`timeline[].shotSize = {w, h, dpr}`，表示截图的实际像素宽高和 devicePixelRatio；没有截图时为 `null`，旧报告里没有这个字段（按 1280×800、dpr 1 处理）。`focusRect`、`seen[].rect` 都是 **CSS 像素**，画框时用：`rect × dpr × (显示宽度 / shotSize.w)`。本地模式固定 `{1280, 800, 1}`；真实网站模式在 Retina Mac 上实测是 `{w: 2560, h: 1522, dpr: 2}`，所以按 1280 缩放会整体错位一倍。详见 `docs/REPORT_FORMAT.md` §4。demo 用的真实网站报告只在跑的这台机器上：`runs/real/<运行目录>/report.json`，通过 `npm run serve` 访问 `/runs/real/<运行目录>/report.json`。
