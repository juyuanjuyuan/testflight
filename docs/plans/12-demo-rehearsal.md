# 12 — demo 回放与演练

**目标：** 保证周日下午的 5 分钟 demo 在断网、模型挂掉的情况下也能完整跑完。

**依赖：** 01–11 和 14（13 除外）　**预计：** 1 小时　**周日 12:30 前完成**

**先读：** Test Flight 方向文档的 "Demo 脚本" 和 "真实网站段的边界"、`src/agent/llm.mjs`（缓存机制）

**可以改：** 新建 `scripts/demo.sh`、`scripts/demo-prep.sh`、`README.md`
**不要改：** 功能代码（12:30 之后只修 bug）

## 步骤

1. **确定 demo 电脑**，之后所有缓存都在这台上生成。
2. 在这台电脑上用 `LLM_CACHE=readwrite` 把 demo 要跑的全部内容完整跑一遍：假站主流程 audit、fix、rerun、评测表。
3. 写 `scripts/demo.sh`：设 `LLM_CACHE=readonly`，按 demo 顺序执行上述命令。readonly 下缓存未命中会直接报错，不会访问网络。
4. **断网测试**：关掉 Wi-Fi 跑 `scripts/demo.sh`，必须完整跑通（假站在 localhost，模型走缓存）。
5. 确认真实网站段用的是 08 缓存好的结果，准备好"这是今天早些时候的真实运行"的说法。
6. 补完 README 的所有 TODO：队名、队员、结果表、what's real vs mocked、prior work。
7. 按方向文档的时间分配完整演练两遍并计时。

## 验收

- 断网状态下 `scripts/demo.sh` 完整跑通。
- README 没有 TODO。
- 两遍演练都控制在规定时间内（先向 staff 确认每队展示时长）。

## 结果（后端部分，2026-09-27）

### 验证：轮播横幅会不会让 readonly 缓存未命中

在假站主流程上（`--site sites/shop/original`，任务取 `eval/groundtruth/shop-main.yaml`，planner + judge）先用 `LLM_CACHE=readwrite`、再用 `LLM_CACHE=readonly` 各跑一次 `node cli.mjs audit`；testpage 同样各跑一次。没有改 planner 的输入或站点。

| 运行 | planner | judge | 结果 |
|---|---|---|---|
| shop readwrite | 28 次调用（27 步 + judge） | 调用成功 | block 2（F2 付款被拒没有播报、F4 🛒）· degrade 4 |
| shop readonly（跑了两次） | **27/27 命中**，步骤和 readwrite 完全相同 | **未命中**：`cache miss (readonly) for judge/…`，记入 `stats.judgeErrors`，按默认等级 | block 1（F8 pointer-only）· degrade 7 |
| testpage readwrite / readonly | readonly **11/11 命中** | readonly **未命中** | 两次都是 block 1 · degrade 4（默认等级恰好一样） |
| 同一个 trace 用 `replay` + readonly | 不需要 | **命中** | 和 readwrite 结果完全相同 |

结论：

1. **横幅没有影响 planner。** 两个站点的 readonly 都完整跑完，planner 每一步都命中。横幅只在首页轮播，planner 在导航后读页面文字时拿到的是首屏那一条，四次运行都一样。（原理上仍依赖时序，只是这四次都没出问题。）
2. **判断一定会未命中，原因不是横幅。** judge 的输入（`src/agent/judge.mjs` 的 `compactStep`）包含每条可见变化的 `dtMs`（按键后多少毫秒出现）和 `repeatCount`，每次新录制都会不同：同一流程两次录制之间，第 6 步 toast 是 `dtMs` 7 和 1，第 24 步 "Card declined" 是 3 和 1；第 2 步横幅在 readwrite 那次录到一次变化（`repeatCount: 7`），readonly 那次因为 planner 走缓存、每步几乎不用时间，没录到。所以**只要是新录制，readonly 下 judge 一定未命中**，findings 退回默认等级（不会崩，报告里 `judged: false`，`stats.judgeErrors` 有记录）。
3. **所以 readonly 下的实时闭环会失败。** fixer 的输入里有 judge 写的 `summary`（没判时是带毫秒数的 `hint`），judge 未命中 → fixer 也未命中。实测：readonly 下对新录的 shop 运行执行 `fix --rerun`，`fixes[0].errors = ["cache miss (readonly) for fixer/…"]`，一处都没改，`closedLoop: false`。
4. **不录制就能完整重放。** 同一个 `trace.jsonl` 用 `replay` 重新分析时 judge 全部命中；已经跑好的运行目录（报告、截图、复测）不需要模型。
5. **预录按键（`--script`、judge 关）的整条链可以离线重放**，但只适合演示“检测”，不适合演示闭环：testpage 脚本运行的 block 是 F4 trap + F7 pointer-only（hint 里没有毫秒数），readwrite 跑过一次 `fix --rerun` 后，readonly 下重新录制 + 修复 + 复测全部命中缓存，结果完全一致；但修了这两个问题复测仍然 stuck（付款后没有播报），`closedLoop: false`。假站的 `keys.shop.main.json` 是明眼人路线，最后下单成功，judge 关时结论是“读屏用户能完成”，不适合 demo。

按规则没有改 `src/`。以后如果要让 readonly 下的实时运行也能用 judge，可以考虑把 `dtMs` 从 judge 的输入里去掉或者分桶（要先确认 judge 的 prompt 不依赖具体毫秒数），这属于功能改动，不在本计划范围内。

### `scripts/demo-prep.sh`

依次检查 Node ≥ 20、依赖、Chromium（或 `CHROME_BIN`）、`.env` 里 `SCIFORIUM_API_KEY` / `MODEL_PLANNER` / `MODEL_JUDGE` 非空（只打印缺哪个，不打印值）、8080 上的服务器；然后通过 API 在假站主流程上跑 审计 → `{"rerun":true}` 修复全部 block → 复测，`rerun.closedLoop` 不是 `true` 就报错退出，最后一行打印 runDir。需要网络和模型，服务器用默认的 readwrite（`.env`）启动，这样顺便把缓存补全。实测一次 86 秒：block 是 F2（付款被拒没有播报）和 F4（🛒），两处都修好，`closedLoop: true`（`runs/2026-09-27T05-27-21-audit`，只在这台电脑上）。

### demo 当天的三套方案

所有方案都用同一个服务器 `npm run serve`（8080），前端和 viewer 都读它。**demo 前一小时内**在 demo 电脑上跑一次 `scripts/demo-prep.sh`，记下最后一行的 runDir（下面写作 `<RUN>`），并提前在浏览器里开好方案二的标签页。

**方案一：实时运行（首选，需要网络和模型）**
- 服务器：`npm run serve`（不要设 `LLM_CACHE=readonly`：由上面的结论 3，readonly 下实时修复一定失败）。
- 前端里填 `http://localhost:8080/shop/original/`，任务**手动填固定的**：`Buy a canvas tote bag. Pay with the test card 4000 0000 0000 0002. If it is declined, try 4242 4242 4242 4242.`（不要让它自动生成任务，自动生成的任务每次不同，缓存用不上）。审计完成后点“修复全部阻断问题 + 复测”。等价的命令行就是 `scripts/demo-prep.sh` 里的两次 POST。
- planner 大概率全部走缓存（很快），judge 和 fixer 实时调用模型，整个流程约 1.5 分钟。judge 每次的判定可能略有不同，所以 block 问题和 `closedLoop` 不保证和预跑一样。

**方案二：打开提前跑好的运行（兜底，不需要网络和模型）**
- `http://localhost:8080/viewer/?run=/runs/<RUN>/`；前端的运行列表（`GET /api/runs`）里也有这条，复测目录是报告里的 `rerun.runDir`。
- 断网时建议用 `LLM_CACHE=readonly npm run serve` 重启服务器：万一有人误点了新运行，会立刻按缓存未命中报错，而不是等网络超时。
- 说法：“这是今天早些时候在这台电脑上完整跑的一次”，和真实网站段的说法一致。

**方案三：预录按键（现场录制但不调用模型）**
- 前端不支持传 `script`，用命令行：
  `curl -s -X POST localhost:8080/api/runs -H 'Content-Type: application/json' -d '{"url":"http://localhost:8080/testpage/original/","goal":"Buy the canvas tote bag. Pay with card number 4242 4242 4242 4242.","script":"keys.testpage.json"}'`
  然后在前端或 viewer 打开返回的 runDir。约 10 秒，不需要网络，readonly 下也能跑。
- 用 testpage，不要用假站：假站的脚本路线最后下单成功，judge 关时结论是“能完成”（见结论 5）。
- 只演示检测（trap、pointer-only 等，结论“读屏用户不能完成”），修复和复测切到方案二展示。

**什么时候切换**
- 方案一 → 方案二：审计或修复的进度超过 20 秒没有变化、`state` 变成 `failed`、或者复测结束 `closedLoop` 不是 `true`。直接切到事先开好的方案二标签页，不要在台上重试。
- 开场前发现没网络或模型不可用（`scripts/demo-prep.sh` 失败）：跳过方案一，用 `LLM_CACHE=readonly npm run serve` 启动，先用方案三现场录一次（证明是真的在跑），再用方案二讲修复和复测。前提是之前已经成功跑过一次 `demo-prep.sh`，`<RUN>` 存在。
- 真实网站段：这台电脑上目前**没有** `runs/real/`（计划 08 的预跑结果在跑它的那台电脑上），demo 电脑上要先有一份，否则这一段只能讲不能展示。

### 还没做（需要人来做）

- 步骤 1、4、7：确定 demo 电脑、断网测试、计时演练两遍。上面的缓存结论和 `<RUN>` 都是在当前这台电脑上得出的，换电脑要重新跑 `scripts/demo-prep.sh`。
- 步骤 3 的 `scripts/demo.sh`（“readonly 下按顺序跑完整个 demo”）没有写：由结论 3，新录制的审计在 readonly 下没法完成修复闭环，这个脚本的前提不成立。demo 流程改用上面的三套方案。
- 步骤 6：README 里需要人填的内容，见下一节。

### README 还没填的内容（不替团队编）

1. 第 1 行标题：`# TODO: team name`，需要填队名。
2. 第 7 行：`Team: TODO Name (@github), …`，需要填队员姓名和 GitHub 账号。
3. 第 145 行 prior work：
   - “~100 行可行性脚本”是否在周六之前写的；如果是，要先原样提交再在这里描述，否则删掉这句。
   - 这一行写“Focus-visibility detection will reuse keyboard-a11y-tester (MIT) — TODO: add the exact link”，但计划 07 实际用的是方案 A（自己写的计算样式对比，没有引入 keyboard-a11y-tester），评测表下也写了它没有纳入对比。需要团队确认后删改这句，不然和实际不符。
4. 计划 12 步骤 6 里的“结果表”“what's real vs mocked”README 里已经有了，不算 TODO；但 “Real-site segment … results are shown from a cached run” 要求 demo 电脑上真的有那次运行（见上面“真实网站段”）。

### 验证：结账页会员弹窗（B9）+ 优惠码 Apply（B10）场景（2026-09-27）

通过 8080 上的 API（`POST /api/runs`，不带 `script`），在 `http://localhost:8080/shop/original/` 上跑任务
`Buy a Canvas Tote Bag using the coupon code SAVE10. Pay with the test card 4242 4242 4242 4242.`，
然后 `POST /api/runs/<runDir>/fix`，body 是 `{"rerun":true}`，不传 findingIds。服务器用 `.env` 里的 `LLM_CACHE=readwrite`。
没有改 `sites/shop/`、`src/` 和 `eval/`。一共跑了 3 次完整流程：第 1 次缓存还是空的，第 2、3 次就是要求的“readwrite 下连续两次”。

| # | 审计 runDir | 审计 | 修复+复测 | 合计 | 复测 runDir | closedLoop |
|---|---|---|---|---|---|---|
| 1 | `2026-09-27T17-29-41-audit` | 238 s | 90 s | 328 s | `2026-09-27T17-33-47-rerun` | **true** |
| 2 | `2026-09-27T17-35-22-audit` | 42 s | 57 s | 99 s | `2026-09-27T17-36-15-rerun` | **true** |
| 3 | `2026-09-27T17-37-14-audit` | 75 s | 39 s | 114 s | `2026-09-27T17-38-38-rerun` | **true** |

第 1 次慢，是因为 planner 缓存没命中（44 次模型调用，其中 2 次超时重试，浪费 53 s）。第 2、3 次 planner 全部命中缓存，只有 judge 和 fixer 是实时调用（原因见上面的结论 2、3）。第 3 次的审计比第 2 次慢 33 s，全是 judge 那一次调用花的时间（13 s → 45 s）。

**1. 审计：planner 的路径（3 次完全相同，一共 45 步）**
- 1–11：首页 → Canvas Tote Bag → 在 🛒 上按了 **3 次** Enter（名字看不懂，toast 也没有朗读，它以为没加上）→ 找到 Cart。
- 12–20：购物车弹窗 → Checkout。购物车里有预置的 Wool Beanie，加上 3 个 tote，所以最后买的是 3 个 tote + 1 个 beanie（总价 $90，用了优惠码后 $81）。demo 时可以顺带提一句，这也是 B1/B2 的后果。
- 21–23：结账页 Tab 到 Card number，输入卡号，再 Tab 到 Pay。
- **24：Tab 进入优惠码框，弹出“Members only”弹窗**，焦点在 Email 上。
- **25–28：Escape、Escape（都没用），Tab → Join，Tab → Email（在两个元素之间来回）。**
- **29：runner 确认是陷阱，由“看得见屏幕的协助者”点了 ×**（`#joinclose`，计划 19），焦点回到优惠码框。
- 30：输入 SAVE10。
- **31–44：一直找 Apply**。Tab 的顺序是 优惠码 → body → Card number → Pay → 优惠码，Apply 从来拿不到焦点；中间也试过 Shift+Tab。
- **45：stuck**（10 步都没有新进展）。结论：`outcome: stuck`，读屏用户**不能**完成。

检出的问题（3 次完全相同）：

| id | 检测器 | 等级 | 对应障碍 | 步骤 |
|---|---|---|---|---|
| F3 | trap | **block** | B9 会员弹窗 | 25, 27, 28 |
| F4 | weak-name | **block** | B1 🛒 | 5–8 |
| F8 | pointer-only | **block** | B10 Apply | 45 |
| F1 | unannounced | degrade | B2 加购 toast | 6 |
| F5 | weak-name | degrade | B5 数量 “−” | 14–18 |
| F7 | focus-visible | degrade | B8 | 21–45 |

B7（卡被拒没有朗读）不在这个任务的路径上：这里用的是 4242 卡，不会被拒。

**2. 修复 + 复测**
- **B9（F3）**：3 次都是在弹窗的 keydown 处理里加一行 `if (e.key === 'Escape') { e.preventDefault(); closeJoin(); return; }`，并把注释里的 “Escape does nothing” 删掉。第 2 次还多了一处修改：给弹窗加了 `aria-modal="true"`。
  注意：× 仍然是只能用鼠标点的 `<span>`，Tab 也仍然只在 Email 和 Join 之间来回。fixer 只加了 Escape 这个出口，这已经满足 2.1.2，但 demo 时不要说成“× 也能用键盘点了”。
- **B10（F8）**：3 次都是两处修改：`<span id="apply">` 加上 `role="button" tabindex="0"`，再加一个 keydown 处理，按 Enter 或空格时调用 `apply.click()`。没有改成 `<button>`。
- B1（F4）：给 🛒 按钮加 `aria-label="Add to cart"`。
- 复测（3 次路径相同，33 步，没有协助）：第 24 步弹窗出现 → **25 按 Escape 回到优惠码框** → 26 输入 SAVE10 → **27 Tab 到 Apply → 28 按 Enter**，朗读 “Coupon SAVE10 applied: 10% off.” 和 “Total $81.00” → Pay → 33 done（“Thank you! Your order has been placed”）。
  F3、F4、F8 都是 `resolved`，F1、F5、F7 是 `persists`，`introduced: []`，**`closedLoop: true`**。

**3. 稳定性**：3 次的 planner 路径（审计和复测）、findings、等级，以及对 B9、B10 的修改（除了第 2 次多加的 `aria-modal`）都一样，3 次都是 `closedLoop: true`。fixer 每次都实时调用，所以 rationale 的文字每次不同，但修改本身是一样的。

**4. 风险**（没有遇到卡住的情况，这里只列可能出问题的地方）
- 审计要走 45 步，而且是在“10 步没进展”之后才以 stuck 结束。第 31–44 步是 planner 在找 Apply，这段是 demo 里最长的空转。缓存命中时总共约 40–75 s，没有缓存时约 4 分钟。
- judge 和 fixer 在 readwrite 下每次都实时调用，结论 2、3 说的限制在这里一样适用：readonly 下这个场景跑不出修复闭环，所以现场只能用方案一（需要网络）或方案二（打开上面已经跑好的 runDir）。
- 要稳定走到这条路径，依赖 planner 的缓存。换电脑或者改了任务文字，planner 就会实时调用，路径可能不同（比如先去找优惠码框、不先填卡号）。上面的 runDir 都只在这台电脑上。
