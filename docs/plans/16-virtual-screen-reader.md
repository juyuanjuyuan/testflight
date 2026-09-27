# 16 — 接入 Guidepup Virtual Screen Reader

**目标：** 用开源的虚拟读屏器 `@guidepup/virtual-screen-reader`（MIT）填上 trace 里一直空着的 `spoken` 字段，让"辅助技术获知了什么"不再只靠我们自己的规则推算，而是有一个独立实现作为依据；并用两者的一致率作为 README 里的证据。

**依赖：** 03（planner 的 prompt 已经稳定；本计划会改变 planner 听到的文字格式）　**预计：** 1.5–2 小时
**不要和 06、07、15 同时进行**（都会改 `session.mjs` 或重新生成 fixture）

**先读：** `AGENTS.md`（信息隔离）、`docs/ARCHITECTURE.md` §4、`src/agent/observation.mjs`、`src/runner/session.mjs`、`src/runner/recorder.js`、`src/contracts.mjs`、`test/pipeline.test.mjs`

**可以改：** `package.json`（新增这一个依赖）、`src/runner/**`、`src/agent/observation.mjs`、`src/agent/prompts/planner.md`、`src/contracts.mjs`（只加可选字段）、`fixtures/testpage-*`、`test/`、`AGENTS.md` 与 `docs/CODING_STANDARDS.md` 的依赖白名单、`docs/ARCHITECTURE.md`、`README.md`、`src/report/build.mjs`（只加字段）、`docs/report.schema.json`、`docs/REPORT_FORMAT.md`、`docs/report.example.json`、`scripts/smoke.mjs`（执行时补上：smoke 的 replace 用例断言 heard 里有原文 `Order confirmed`，格式变了必须改）
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

2026-09-27。**状态：完成。** 验收全部通过：`npm test`、`npm run smoke`（original 6/6、fixed 0 误报）、两个 fixture 的 `spoken` 都有内容，original 按 Pay 那一步 `spoken: []`，fixed 那一步 `["assertive: Card number is invalid"]`。

### 和"做法"不同的地方

**注入方式改了。** 没有用 `page.route` + `addScriptTag`，而是 `page.evaluate` 直接执行包里的 `lib/esm/index.browser.js`：它只有一条 `export{…}`，改写成 `window.__vsrModule = {…}`（`src/runner/vsr.mjs`，形状不对时启动就报错）。原因：
1. DevTools 的 evaluate 不受网站 CSP 限制（在 `script-src 'none'` 的页面上验证过），两种模式都不需要 bypassCSP，本地模式的 browser context 保持原样；real 模式的 `Page.setBypassCSP` 要到下一次跳转才生效，管不到用户已经打开的那一页。
2. `page.route` 会关掉那个页面的 HTTP 缓存，real 模式下就是用户自己的标签页。
3. `http://a11y-audit.local` 在 https 网站上会被当成混合内容拦截。

**`spokenPhraseLog()` 是异步的**，"做法"里的 `spokenPhraseLog().length` 拿到的是 undefined（第一次跑出来每步都是完整日志）。

**新发现的泄露，已修：** 虚拟读屏器读的是 DOM 里的值，所以会把密码原样读出来（`Password, hunter2`），real 模式下也会读出浏览器自动填的内容（`textbox, Email, me@example.com`）。新增 `guard.redactSpoken`：密码在所有模式下都换成 •（和 AX 树一样），real 模式下 planner 没输入过的字段值换成 `(redacted)`，只替换按 `, ` 分开的整段，短值不会误伤别的词。测试：`test/spoken.test.mjs`；smoke 的 password 用例改成回到输入框再听一次并检查 •，form (real) 用例原有的"trace/report 里没有自动填的邮箱"检查现在也覆盖 `spoken`。

每步的做法：动作前在 `mark()` 同一个 evaluate 里取日志长度，settle 之后取新增部分。新页面（新 document）里重新启动；启动失败时这一页的每一步记 `spokenSource: null` 和 `spokenError`，`heardInStep` 回退到规则，同一页不再重试。

### 耗时

每步增加约 1–2 ms（testpage 中位数 0.8 ms、最大 2.0 ms；shop 0.5–0.9 ms），页面加载那一步启动需要 10–33 ms。远低于 200 ms 的要求。真实大网站上读屏器自身在页面里的开销没有测。

### 一致率（`stats.spokenAgreement`）

| trace | 比较的步数 | 一致 | 不一致 |
|---|---|---|---|
| `fixtures/testpage-original` | 6 | 5 | 第 4 步 `Card number Pay` |
| `fixtures/testpage-fixed` | 10 | 8 | 第 4、13 步 `Card number Pay` |
| shop original（`keys.shop.main.json`） | 6 | 5 | 第 9 步购物车弹窗的 12 行内容 |
| shop fixed（同上） | 6 | 5 | 第 9 步购物车弹窗的 11 行内容 |

（比较的步数随轮播时机略有浮动。）所有不一致都是同一个原因，**不是检测器的问题**：焦点移进弹窗时（Checkout 打开付款弹窗、Cart 打开购物车），recorder 把弹窗里的文字记成 `focusMovedInto: true` 的变化，规则认为都被读出来了；虚拟读屏器只说弹窗名字和焦点所在的控件（`dialog, Payment` + `textbox, Card number`；`dialog, Your cart, modal`）。NVDA/JAWS 在焦点落到弹窗上时一般会读弹窗里的文字，所以这里虚拟读屏器比真人读屏更严格。按计划没有改检测器，D1 在这些步骤上两边都不报。

另外两处值得人看的差别（不影响一致率统计）：
- shop fixed 第 7 步第二次按 Add to cart：页面把同一句 toast 重新写了一遍，文字没变，recorder 看不到变化，规则认为什么都没听到；虚拟读屏器又播报了一次 `polite: Canvas Tote Bag added to cart`。这里它更准确。
- shop original 第 12 步：按 Remove 后焦点丢到 body，再按 Tab 到下一个 "Remove"，虚拟读屏器什么都没说（它自己的行为），planner 仍能从 `focus` 字段知道焦点在哪。

### planner 没有退化

DeepSeek，`--no-judge`，`LLM_CACHE=off`，各跑一次：

| 站点 | goal | outcome | SR 用户能完成 | 步数 | 耗时 |
|---|---|---|---|---|---|
| testpage fixed | 计划 03 的 goal | done（听到 `polite: Order confirmed`） | true | 10 | 22 s |
| testpage original | 同上 | 按 Pay 后 stuck | false | 10 | 26 s |
| shop fixed | 计划 11 的 goal | done（听到 `assertive: Card declined. Try another card.` 后换卡） | true | 25 | 51 s |
| shop original | 同上 | 按 Pay 后 stuck："heard no confirmation or decline message" | false | 26 | 57 s |

shop 是 demo 路线，额外跑了。打开购物车时 planner 现在听不到购物车内容，在 fixed 上靠 Tab 到 "Remove Canvas Tote Bag" 这类按钮名确认，在 original 上一路 Tab 到 Checkout；两边的结论和计划 11 一致。

### 需要注意 / 需要前端配合

- **LLM 缓存失效：** planner 的 observation 和 judge 的输入里 `heard` 的文字都变了，计划 16 之前录的缓存不会命中。计划 12 用 `LLM_CACHE=readonly` 演示前要重新录。
- **前端（不改 viewer，只记录）：** 右栏可以直接显示 `timeline[].spoken` 原文，并按 `spokenSource` 标注"虚拟读屏器原话" / "规则推算"；`stats.spokenAgreement` 可以做成"两种独立方法一致 N/M"，`disagreements[].step` 做成跳转。`heard` 字段本身没变，只是内容格式从 `button "Pay"` 变成了 `button, Pay`。`viewer/sample/report.json` 没有这些字段。
- 步骤 6：仓库里除本文件外没有 `virtual-screenreader` 的拼写，不用改。
- real 模式只在 smoke 的 `form (real)`（CDP 接管、data: URL）上验证过，没有在真实网站上跑。
