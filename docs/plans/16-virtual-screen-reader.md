# 16 — 接入 Guidepup Virtual Screen Reader

**目标：** 用开源的虚拟读屏器 `@guidepup/virtual-screen-reader`（MIT）填上 trace 里一直空着的 `spoken` 字段，让"辅助技术获知了什么"不再只靠我们自己的规则推算，而是有一个独立实现作为依据；并用两者的一致率作为 README 里的证据。

**依赖：** 03（planner 的 prompt 已经稳定；本计划会改变 planner 听到的文字格式）　**预计：** 1.5–2 小时
**不要和 06、07、15 同时进行**（都会改 `session.mjs` 或重新生成 fixture）

**先读：** `AGENTS.md`（信息隔离）、`docs/ARCHITECTURE.md` §4、`src/agent/observation.mjs`、`src/runner/session.mjs`、`src/runner/recorder.js`、`src/contracts.mjs`、`test/pipeline.test.mjs`

**可以改：** `package.json`（新增这一个依赖）、`src/runner/**`、`src/agent/observation.mjs`、`src/agent/prompts/planner.md`、`src/contracts.mjs`（只加可选字段）、`fixtures/testpage-*`、`test/`、`AGENTS.md` 与 `docs/CODING_STANDARDS.md` 的依赖白名单、`docs/ARCHITECTURE.md`、`README.md`、`src/report/build.mjs`（只加字段）、`docs/report.schema.json`、`docs/REPORT_FORMAT.md`、`docs/report.example.json`
**不要改：** `viewer/`、`sites/shop/`；`report.json` 只能新增字段

## 已验证的可行性（2026-09-26）

在 testpage 上用真实 Playwright 按键操作，同时让虚拟读屏器在页面里运行，它的播报记录是：

- fixed：`button, Add Canvas Tote Bag to cart` → `polite: Added to cart` → `button, Checkout` → `dialog, Payment, modal` → `textbox, Card number` → `button, Pay` → `assertive: Card number is invalid`
- original：`button, 🛒` → （加购后无播报）→ `button, Checkout` → `dialog, Payment` → … → `button, Pay` → （付款失败后**无播报**）

和我们规则推算的"听到了什么"完全一致。它会跟踪真实的键盘焦点，也会记录 live region 的播报。

## 做法

**注入方式**（已验证可行）：`lib/esm/index.browser.js` 是一个自包含的 ESM 文件（约 400KB，没有外部 import）。

1. 用 `page.route('http://a11y-audit.local/vsr.js', …)` 把请求直接返回这个文件的内容（从 `node_modules` 用 `createRequire` 解析路径，不写死路径）。
2. 每次页面加载完成后，`page.addScriptTag({ type: 'module', content: "import { virtual } from 'http://a11y-audit.local/vsr.js'; window.__vsr = virtual; await virtual.start({ container: document.body }); window.__vsrReady = true;" })`，再 `waitForFunction(() => window.__vsrReady)`。
3. 真实网站可能有 CSP 拦截模块加载：local 模式用 `browser.newContext({ bypassCSP: true })`，real 模式对 CDP 会话发 `Page.setBypassCSP { enabled: true }`。仍然失败时，这一页的 step 记 `spokenSource: null` 和 `spokenError`，回退到规则推算，**不要吞掉错误**。

**每步记录：** 动作前记下 `spokenPhraseLog()` 的长度，settle 之后取新增部分写入 `step.spoken`，并记 `step.spokenSource = 'virtual-screen-reader'`。页面跳转后要重新 start。

**信息隔离（最重要）：**
- `heardInStep()`：当 `step.spokenSource === 'virtual-screen-reader'` 时，以 `step.spoken` 为准；否则用现有的规则推算作为回退。planner 仍然只通过 `buildObservation()` 获得信息。
- 原有的信息隔离测试必须继续通过：original 里未播报的错误不能出现在 Observation 中。
- 虚拟读屏器的播报带 `polite:` / `assertive:` 前缀和角色名，格式和之前不同。检查 planner prompt 是否需要说明这种格式，改完后按计划 03 的方式在 fixed 和 original 上各跑一次确认没有退化。

**交叉验证（给 README 用）：** 在报告的 `stats` 里新增 `spokenAgreement`：每一步"虚拟读屏器是否播报了这条新出现的文字"和"规则推算是否认为它被播报"是否一致，给出一致步数/总步数和不一致的步骤列表。不一致时不要自动改检测器，记录下来人工看。

## 步骤

1. `npm install @guidepup/virtual-screen-reader`（先在群里说一声），把它加进 `AGENTS.md` 和 `docs/CODING_STANDARDS.md` §5 的依赖白名单。
2. 先写测试：`heardInStep` 在有 `spokenSource` 时使用 `spoken`；没有时回退到规则推算。
3. 实现注入和每步记录；`contracts.mjs` 的 Step 注释里加上 `spokenSource?`、`spokenError?`。
4. 重新生成 `fixtures/testpage-original` 和 `fixtures/testpage-fixed`，更新相关断言；`npm test`、`npm run smoke` 通过。
5. 实现 `stats.spokenAgreement`，在两个 fixture 上确认一致率。`spoken` 和 `spokenAgreement` 进入 report.json 时，同步更新 `docs/report.schema.json`、`REPORT_FORMAT.md` 和 `report.example.json`（新字段在 schema 里必须是可选的，`npm test` 的 `test/report-schema.test.mjs` 会检查）。
6. 修正文档里写错的包名：搜索 `virtual-screenreader`（少了连字符），全部改成 `virtual-screen-reader`。
7. README 的 How it works 和 Brought in / 第三方组件部分写明：虚拟读屏器来自 Guidepup（MIT），用于模拟读屏播报；我们自己做的是逐步对比"屏幕上出现的"和"读屏获知的"、信息隔离的 planner、修复验证闭环。
8. 在本文件"结果"一节记录：每步增加的耗时、两个 fixture 上的一致率、需要前端配合的地方（例如 viewer 可以把 `spoken` 原文显示在右栏）。

## 验收

- testpage 两个版本的 `step.spoken` 都有内容，且 original 付款那一步为空、fixed 那一步包含 "Card number is invalid"。
- 信息隔离测试、smoke、`npm test` 全部通过；smoke 的检出结果仍是 original 全部检出、fixed 0 误报。
- `spokenAgreement` 在两个 fixture 上为 100%，或者不一致的步骤都在"结果"一节里解释清楚。
- 每步增加的耗时 < 200ms（页面加载那一步除外）。

## 注意

- 虚拟读屏器也不是 NVDA/JAWS，README 里的措辞保持"没有任何程序化方式能被播报"，不要写成"NVDA 不会读"。
- 如果 real 模式下注入反复失败，不要花超过 30 分钟，记录下来，真实网站段回退到规则推算即可。

## 结果

（完成后填写）
