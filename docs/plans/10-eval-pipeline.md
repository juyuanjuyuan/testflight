# 10 — 评测流水线

**目标：** 一条命令产出可以直接贴进 README 的对比表：我们 vs axe（vs keyboard-a11y-tester），加上 judge 开/关的消融。

**依赖：** 05、09　**预计：** 1.5 小时

**先读：** `docs/ARCHITECTURE.md` §9、`eval/score.mjs`、`eval/groundtruth/*.yaml`（假站两条流程分别是 `shop-main.yaml`、`shop-second.yaml`，fixed 用 `shop-fixed.yaml`）、`src/audit.mjs`（`analyze()` 可以对已有 trace 重跑检测和 judge）

**可以改：** `eval/**`、新建 `sites/bad/`（W3C BAD 的本地副本）、`README.md` 的 Results 一节
**不要改：** `src/**`（发现检测器问题就在对应计划里记下来，不要在这里顺手改）

## 步骤

1. 写 `eval/run.mjs`（`node eval/run.mjs`），依次：
   - 对假站 original/fixed 的两条流程，用预录按键脚本各跑一次 `audit --no-judge`（保证各工具看到的页面状态一致）；
   - 对每条 trace 再用 `analyze()` 开启 judge 跑一遍（**消融**：同一条 trace，judge 开/关）；
   - 用 `scoreRun` 给 ours（judge 关）、ours（judge 开）、axe（WCAG 规则）打分；
   - 输出 Markdown 表：数据集 × 工具 → 埋入数、检出、漏检、误报；另起一张表列出 judge 开/关的误报数对比。
2. **W3C BAD**：下载 W3C Before and After Demonstration 的 after（已修复）版本放到 `sites/bad/after/`，写一个简单任务流的按键脚本，只统计误报（`barriers: []`）。如果下载或许可有问题，跳过并在 README 里说明。
3. （可选）keyboard-a11y-tester：用它的 serve 模式按我们 trace 里的按键序列重放，取它的结果打分。如果集成超过 30 分钟，就沿用可行性验证时的手工结果，并在表下注明方法。
4. 把结果表贴进 README 的 "Results so far"，替换 testpage 的临时表。

## 验收

- `node eval/run.mjs` 一条命令跑完，打印两张表，退出码 0。
- README 里的数字都能用这条命令复现。
- 开启 judge 那一列需要 `.env` 里的 key；没有 key 时脚本跳过该列并提示，而不是报错退出。

## 注意

- 表里的"axe"只统计带 WCAG 标签的规则，best-practice 规则另列，否则对比不公平。
- 假站障碍中 `detectable: vision-only` 的（文字印在图片上），在我们的"检出"里如实算作漏检，除非 13 做完了。

## 开始前需要处理（计划 18 发现，2026-09-27；已处理，见"结果"）

1. **`eval/groundtruth/testpage.yaml` 的站点路径不对。** 文件里写的是 `site: sites/testpage`，实际目录是 `sites/testpage/original`，所以计划 18 的"预设任务"匹配不到这个页面，改为调用模型生成任务。改成正确路径，并确认 `node cli.mjs suggest --url http://localhost:8080/testpage/original/` 返回的是预设任务（`source: "curated"`）。
2. **两个 testpage 的预设任务里没有卡号。** 用预录按键跑不受影响；但用 planner 跑时，它会在付款那一步停下，因为 planner 只能输入 goal 里原样出现的值，不会自己编造卡号（这是正确的行为）。建议在 `testpage.yaml` 和 `testpage-fixed.yaml` 的 goal 里都加上 "Pay with card number 4242 4242 4242 4242."。
   - 评分按 `barrierId` 匹配，改 goal 的文字不影响分数；
   - 但会让已有的 LLM 缓存失效，相关的 fixture 和 smoke 用例如果依赖旧的 goal 文字，要一起更新；
   - 改完用 planner 在 testpage 的 fixed 版上跑一次，确认能完成购买。

## 结果（已完成，2026-09-27）

最新数字见文末"后续"第 5 节（重新录制 `eval/traces/` 之后）；下面是第一版的记录。

### 做了什么

- **开始前的两个问题**（单独 commit）：`testpage.yaml` 的 `site` 改成 `sites/testpage/original`；两个 testpage 的 goal 加上 "Pay with card number 4242 4242 4242 4242."。`cli.mjs suggest --url http://localhost:8080/testpage/original/` 返回 `source: "curated"`；不给 goal、用 planner 在 testpage/fixed 上跑，选中预设任务并完成购买（听到 "Order confirmed"）。`test/tasker.test.mjs` 里原来用 testpage/original 充当"没有预设任务的站点"，改用 `sites/testpage/patched`；fixture 和 smoke 用的是自己的 goal，不受影响。
- **`eval/run.mjs`**：9 条流程（shop-main/second/popup 各 original + fixed、testpage original + fixed、W3C BAD after），每条用 `eval/keys.*.json` 跑一次 judge 关闭的 audit，再对同一条 trace 用 `analyze()` 开启 judge（输出到 `<runDir>/judge/`），用 `scoreRun` 给三种工具打分，打印两张表，同时写入 `runs/eval/<时间>-eval/results.md` 和 `results.json`。脚本自己在 8092 端口起服务（`EVAL_PORT` 可改），不依赖 `npm run serve`。`.env` 里没有 `SCIFORIUM_API_KEY`/`MODEL_JUDGE` 时跳过 judge 列和消融表，并打印提示。
- **`--replay <dir>` 和 `--save-traces <dir>`**（计划外，原因见问题 1）：`--save-traces eval/traces` 把每条流程的 trace.jsonl、axe.json、meta.json 存下来（已提交，共 300K，只有本地站点）；`--replay eval/traces` 不开浏览器，对存下来的 trace 重跑检测器和 judge。README 的表就来自 `node eval/run.mjs --replay eval/traces`，连跑三次输出完全一致，judge 调用全部命中缓存。
- **W3C BAD**：`sites/bad/` 放的是 after 版 home/news/tickets/survey/template 五个页面及其 css、js、图片（356K），原样下载，没有改写链接；许可是 W3C Document License / Software License，允许保留版权声明原样再分发，说明写在 `sites/bad/README.md`。按键脚本 `eval/keys.bad.after.json`：首页 → 跳过链接 → 站内导航 → Survey → 填写表单 → 停在 submit 按钮（本地副本没有 survey.php，不提交）。标准答案 `eval/groundtruth/bad-after.yaml`，`barriers: []`。整个过程大约 15 分钟，没有碰到问题。
- **标准答案修正**：`shop-second.yaml` 加上 B8。第二流程按 Tab 经过卡号输入框和 Pay 按钮，这两个元素带 `data-barrier="B8"`（outline:none），检测器正确报出，但原来的标准答案没有登记，于是被算成误报。这和 B5 同时登记在两份文件里是同一种情况。
- keyboard-a11y-tester 这次没有纳入对比，表下已注明。

### 结果表（`node eval/run.mjs --replay eval/traces` 的原样输出）

#### Detection: planted barriers vs tools

| dataset | variant | tool | planted | detected | missed | false positives |
|---|---|---|---|---|---|---|
| shop-main | original | ours (judge off) | 8 | 7 | B3† | 0 |
| shop-main | original | ours (judge on) | 8 | 7 | B3† | 0 |
| shop-main | original | axe (WCAG rules) | 8 | 0 | B1 B2 B3† B4 B5 B6 B7 B8 | 0 |
| shop-main | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-main | fixed | ours (judge on) | 0 | 0 | – | 0 |
| shop-main | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-second | original | ours (judge off) | 4 | 4 | – | 0 |
| shop-second | original | ours (judge on) | 4 | 4 | – | 0 |
| shop-second | original | axe (WCAG rules) | 4 | 0 | B5 B8 B9 B10 | 0 |
| shop-second | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-second | fixed | ours (judge on) | 0 | 0 | – | 0 |
| shop-second | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-popup | original | ours (judge off) | 1 | 1 | – | 0 |
| shop-popup | original | ours (judge on) | 1 | 1 | – | 0 |
| shop-popup | original | axe (WCAG rules) | 1 | 0 | B11 | 0 |
| shop-popup | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-popup | fixed | ours (judge on) | 0 | 0 | – | 0 |
| shop-popup | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| testpage | original | ours (judge off) | 6 | 6 | – | 0 |
| testpage | original | ours (judge on) | 6 | 5 | T5 | 0 |
| testpage | original | axe (WCAG rules) | 6 | 0 | T1 T2 T3 T4 T5 T6 | 0 |
| testpage | fixed | ours (judge off) | 0 | 0 | – | 0 |
| testpage | fixed | ours (judge on) | 0 | 0 | – | 0 |
| testpage | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| w3c-bad | fixed | ours (judge off) | 0 | 0 | – | 3 |
| w3c-bad | fixed | ours (judge on) | 0 | 0 | – | 3 |
| w3c-bad | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| **total** | | ours (judge off) | 19 | 18 | 1 | 3 |
| **total** | | ours (judge on) | 19 | 17 | 2 | 3 |
| **total** | | axe (WCAG rules) | 19 | 0 | 19 | 0 |

† vision-only barrier (B3): text printed on an image; no keyboard/screen-reader rule can see it, so it is counted as a miss for us too.
Same trace for every tool (recorded key scripts `eval/keys.*.json`). axe counts only WCAG-tagged rules, per affected element; findings are matched to barriers by `data-barrier` id, unmatched = false positive.
axe best-practice rule nodes, not counted above: shop-main/original 1, shop-main/fixed 1, shop-second/original 1, shop-second/fixed 1, shop-popup/original 1, shop-popup/fixed 1, testpage/original 7, testpage/fixed 5, w3c-bad/fixed 28.
w3c-bad = W3C Before-and-After Demonstration, "after" (accessible) version: nothing planted, so it only measures false positives.
keyboard-a11y-tester: not included in this comparison.

#### Ablation: same trace, judge off vs on

| dataset | variant | candidates | FP judge off | FP judge on | detected off → on | dropped by judge | judge errors |
|---|---|---|---|---|---|---|---|
| shop-main | original | 9 | 0 | 0 | 7/8 → 7/8 | 0 | 0 |
| shop-main | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| shop-second | original | 6 | 0 | 0 | 4/4 → 4/4 | 1 | 0 |
| shop-second | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| shop-popup | original | 2 | 0 | 0 | 1/1 → 1/1 | 0 | 0 |
| shop-popup | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| testpage | original | 7 | 0 | 0 | 6/6 → 5/6 | 1 | 0 |
| testpage | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| w3c-bad | fixed | 3 | 3 | 3 | 0/0 → 0/0 | 0 | 0 |
| **total** | | 27 | 3 | 3 | 18 → 17 | 2 | 0 |

Judge-on numbers depend on the model (`MODEL_JUDGE`); verdicts are cached in `.cache/llm`, so replaying the same recording on this machine gives the same numbers; another machine or model may differ slightly. A fresh recording can also differ: the demo pages' rotating banner lands in different steps, so the judge sees a slightly different prompt.

Reproduce: `node eval/run.mjs --replay eval/traces` (no browser; the judge column needs `.env`).

### 发现的问题（没有改 `src/`，留给对应计划）

1. **judge 的结果在重新录制后不可复现（09）。** 演示页的促销横幅按定时器轮播，每次录制时横幅变化落在不同的步骤里，`repeatCount` 和 `dtMs` 也有几毫秒的抖动。这些都会进入 judge 的输入（`visibleChanges`、候选的 `hint` 里写着 "appeared 2ms after"），所以提示词每次都不一样，缓存命中不了，模型每次都重新回答。在 testpage 上 5 次重新录制，judge 有 2 次把 T5 标成 `none`。本计划的处理办法是用 `--replay` 固定 trace。要让重新录制也能复现，需要在 `src/` 里给 judge 的输入去掉毫秒级的抖动和噪音变化。
2. **judge 把 T5 标成了"与任务无关"（09）。** T5 是只能用鼠标点的 "Apply coupon"。judge 的理由是 "optional and not required to buy the tote bag"：这符合任务级相关性的设计，但评分把 `impact: none` 当作没检出，所以开启 judge 后检出从 18 降到 17。要么标准答案按任务标注"是否相关"，要么评分把 `none` 单独算一类。这个取舍需要团队决定。
3. **judge 在这个数据集上没有减少误报。** 两个版本的误报都是 3 → 3。唯一的误报是 BAD 上的跳转链接（见第 4 条），judge 都保留成 `degrade`。消融表的数字因此说明不了 AI 过滤有多大价值；噪音主要出现在真实网站上（08/09），这份评测没有覆盖。
4. **focus-lost 把页内跳转链接当成焦点丢失（D4，W3C BAD 上 3 个误报）。** 在 "Skip to content" 这类 `href="#…"` 链接上按 Enter，如果目标元素不能获得焦点，`document.activeElement` 会回到 `<body>`，但顺序导航的起点已经移到了目标位置，下一次 Tab 会从目标继续（trace 里第 3、6、14 步可以看到）。读屏用户实际上是正常跳转了。建议：动作是 Enter、焦点所在的链接是同页 fragment、而且下一次 Tab 落在目标之后时，不报这个问题。
5. **weak-name 在 BAD 首页的两个误报**（只在探索时出现，评测脚本的路线没有经过）："Go" 按钮被判为名字太短，但它紧跟在 "Explore Site by Topic:" 下拉框后面，在上下文里是清楚的；演示工具栏和站内导航里各有一个 "News/Tickets/Survey" 链接，被报成"不同控件同名"，但它们指向同一个页面。同名检测可以把 href 相同的链接当成同一个控件。
6. **axe 的结果没有 barrierId（评分，runner）。** `score.mjs` 对 axe 结果只能按 selector 匹配，而标准答案里的障碍没有 selector，所以如果 axe 报到了某个障碍元素，会被算成误报而不是检出。这次 axe 在所有数据集上 WCAG 违规都是 0，不影响数字；如果以后 axe 开始报问题，需要 `src/runner/axe.mjs` 给每个节点补上最近的 `data-barrier`。
7. 小问题：拉取计划 16 之后要先 `npm install`（新增依赖 `@guidepup/virtual-screen-reader`），否则 `npm test` 有 5 个用例失败。

### 验收

- `node eval/run.mjs`：一条命令跑完，退出码 0，打印两张表（重新录制约 2 分钟）；`node eval/run.mjs --replay eval/traces` 不到 1 秒（judge 命中缓存），输出与 README 一致。
- 没有 key 时跳过 judge 列并提示：`SCIFORIUM_API_KEY= node eval/run.mjs --replay eval/traces` 退出码 0，打印提示，只输出 judge 关闭和 axe 两列，消融表显示 skipped。
- `npm test`：145 个全部通过；`npm run smoke`：9 个用例全部 ok。

## 后续（2026-09-27，处理上面"发现的问题"第 2、3、4 条；第 3 条的"judge 没有减少误报"改为分开统计检出和分级）

### 1. D4 跳转链接误报（第 4 条）

`src/detect/focus.mjs`：在链接上按 Enter，如果这一步的 URL 只有 fragment 变了（origin、路径、查询都没变，新 hash 非空且不同于上一步），就不算焦点丢失。trace 里的 `FocusInfo` 没有 `href`，所以用"URL 只改了 hash"来判断链接指向本页锚点：`href="#x"` 和"本页地址 + #x"两种写法按下后都只会改 hash，效果等同于检查 href，而且不用改 runner 和契约。`href="#"`（URL 结尾变成空 hash）和按下后 URL 不变的链接照常报。

回归测试（`test/pipeline.test.mjs`）用 `eval/traces/w3c-bad-fixed`：第 2、5、11、13 步的跳转不再报。对所有已录 trace 前后对比检测结果：只有 w3c-bad 变了（focus-lost 3 → 0），假电商站 B6（第 11 步）和 testpage 的检测结果逐条不变。

**没有重新录制 `eval/traces/`**：目录里存的是 runner 的原始录制（trace.jsonl、axe.json、meta.json），不含检测结果，`--replay` 每次都会用当前检测器重新检测；这次修复不改 runner，录制内容不会变。重新录制反而会因为轮播横幅让 judge 的提示词变掉、缓存失效（第 1 条）。

### 2. 标准答案的 `expectedImpact`

每个障碍新增 `expectedImpact: block | degrade | none`：这个障碍对**该文件的任务**（goal + 录制路线）的实际影响，也就是希望 judge 给出的等级。原来的 `impact` 是设计时的严重程度，保留不动。判断标准：`block` = 键盘/读屏用户没法完成任务；`degrade` = 能完成，但会困惑或多花工夫；`none` = 不在任务路径上（检测器仍然应该找到它）。

| 障碍 | 任务 | expectedImpact | 依据 |
|---|---|---|---|
| B1 🛒 加购按钮 | 买帆布包 | block ⚠️ | 加购是必经步骤，名字只有表情符号，而且页头还有一个 "Cart" 按钮，分不清哪个是加购。沿用设计时的 `impact: block`。 |
| B2 加购提示没播报 | 买帆布包 | degrade | 听不到确认，录制路线里多按了一次，数量变成 2，后面要去购物车改，但任务能完成。 |
| B3 图片上的促销文字 | 买帆布包 | none | 图片内容是 "All hats 20% off"，和帆布包无关。 |
| B4 购物车数量/小计不播报 | 买帆布包 | degrade | 改了数量听不到结果，要自己再确认；不妨碍结账。 |
| B5 −/+ 按钮 | 买帆布包 | degrade | 路线里要用它把数量减回 1，名字里没有商品，需要猜。 |
| B6 Remove 后焦点掉到 body | 买帆布包 | degrade | 删掉毛线帽后要从头找位置，能继续。 |
| B7 "Card declined" 不播报 | 买帆布包 | block | 第一张卡必被拒，听不到就不知道要换卡，买不成。 |
| B8 付款表单 outline:none | 买帆布包 | degrade | 视力正常的键盘用户看不到焦点在卡号框还是 Pay 上；读屏用户不受影响，仍能付款。 |
| B5 −/+ 按钮 | 用优惠码 | none ⚠️ | 路线只是 Tab 经过，不操作它们。 |
| B8 付款表单 outline:none | 用优惠码 | none ⚠️ | 同上，只是 Tab 经过卡号框和 Pay；对视力正常的键盘用户来说，经过时焦点"消失"两下，也可以算 degrade。 |
| B9 "Members only" 弹窗陷阱 | 用优惠码 | block | 焦点到优惠码框就弹出，出不去。 |
| B10 Apply 是 `<span>` | 用优惠码 | block | 就算没有 B9，键盘也按不到 Apply。 |
| B11 订阅弹窗陷阱 | 打开帆布包商品页 | block | 进页面就被困住。 |
| T1 🛒 加购按钮 | 买帆布包 | block ⚠️ | 和 B1 同一种障碍，按 B1 处理。不过 testpage 上不加购也能直接点 Checkout 付款，严格说可以算 degrade。 |
| T2 加购提示没播报 | 买帆布包 | degrade | 同 B2。 |
| T3 卡号错误不播报、没关联 | 买帆布包 | block ⚠️ | 录制路线故意输了短卡号，错误出现但听不到，在对话框里卡死。如果照 goal 输 16 位卡号，这个错误根本不会出现。 |
| T4 付款对话框陷阱 | 买帆布包 | block ⚠️ | 录制路线里和 T3 一起让用户出不去（run 以 stuck 结束）。同样，卡号正确时付款后对话框会关闭，陷阱碰不到。 |
| T5 只能鼠标点的 Apply coupon | 买帆布包 | none | 优惠券是可选的，买包不需要（按你的决定）。 |
| T6 Checkout outline:none | 买帆布包 | degrade | 同 B8。 |

**⚠️ 需要你确认的 5 处（已确认，见下面第 4 节；上表 B1、T1、shop-second 的 B5/B8 已改）：**
- **B1 / T1**：block 还是 degrade？表情符号 🛒 读屏会读成 "shopping cart"，用户可能猜得到；testpage 上 T1 甚至不是必经步骤。
- **shop-second 的 B5 / B8**：只是 Tab 经过、不操作的控件，算 none 还是 degrade？
- **T3 / T4**：按"录制路线"（短卡号）是 block；按"goal 里给的正确卡号"两者都碰不到，应该是 none。现在按录制路线填。

### 3. `eval/run.mjs` 分开统计检出和分级

- **检出率**：只用 judge 关闭的结果（包括 expectedImpact 为 none 的障碍）对比 axe。表里去掉了"ours (judge on)"这一行，合计行加上百分比。
- **分级准确率**：新增 `gradeRun()`（`eval/score.mjs`，测试在 `test/eval-score.test.mjs`）：对检测器找到的每个障碍，取报给它的影响等级（多条 finding 命中同一个障碍时取最严重的，`none` 表示判为无关），和 `expectedImpact` 比。检测器没找到的障碍（B3）不参与分级，它在检出率里已经算作漏检。judge 关闭时用的是各检测器的固定默认等级（`judge.mjs` 的 `DEFAULT_IMPACT`），作为对照。
- **误报**：统计方法不变，放在检出表（judge 关）和分级表的 "FP judge off → on" 列。
- 旧的消融表（"detected off → on"、"dropped by judge"）被分级表取代；`results.json` 里仍保留 `dropped`、`llmCalls`、`cacheHits`。
- README 的 Results 换成这两张表，表下说明 judge 的作用是按任务判断影响，不是提高检出数。

#### 结果表（确认 expectedImpact 之前的版本，已被第 4 节取代）

#### Detection rate: planted barriers vs tools (judge off)

| dataset | variant | tool | planted | detected | missed | false positives |
|---|---|---|---|---|---|---|
| shop-main | original | ours (judge off) | 8 | 7 | B3† | 0 |
| shop-main | original | axe (WCAG rules) | 8 | 0 | B1 B2 B3† B4 B5 B6 B7 B8 | 0 |
| shop-main | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-main | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-second | original | ours (judge off) | 4 | 4 | – | 0 |
| shop-second | original | axe (WCAG rules) | 4 | 0 | B5 B8 B9 B10 | 0 |
| shop-second | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-second | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-popup | original | ours (judge off) | 1 | 1 | – | 0 |
| shop-popup | original | axe (WCAG rules) | 1 | 0 | B11 | 0 |
| shop-popup | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-popup | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| testpage | original | ours (judge off) | 6 | 6 | – | 0 |
| testpage | original | axe (WCAG rules) | 6 | 0 | T1 T2 T3 T4 T5 T6 | 0 |
| testpage | fixed | ours (judge off) | 0 | 0 | – | 0 |
| testpage | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| w3c-bad | fixed | ours (judge off) | 0 | 0 | – | 0 |
| w3c-bad | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| **total** | | ours (judge off) | 19 | 18/19 (95%) | 1 | 0 |
| **total** | | axe (WCAG rules) | 19 | 0/19 (0%) | 19 | 0 |

† vision-only barrier (B3): text printed on an image; no keyboard/screen-reader rule can see it, so it is counted as a miss for us too.
Detection counts every planted barrier, including those expected to be irrelevant to the task (expectedImpact none): finding them is the detectors' job; whether they matter is the judge's.
Same trace for every tool (recorded key scripts `eval/keys.*.json`). axe counts only WCAG-tagged rules, per affected element; findings are matched to barriers by `data-barrier` id, unmatched = false positive.
axe best-practice rule nodes, not counted above: shop-main/original 1, shop-main/fixed 1, shop-second/original 1, shop-second/fixed 1, shop-popup/original 1, shop-popup/fixed 1, testpage/original 7, testpage/fixed 5, w3c-bad/fixed 28.
w3c-bad = W3C Before-and-After Demonstration, "after" (accessible) version: nothing planted, so it only measures false positives.
keyboard-a11y-tester: not included in this comparison.

#### Impact accuracy: same trace, judge on vs off

| dataset | variant | detected barriers | agree, judge off (defaults) | agree, judge on | judge off: expected→given | judge on: expected→given | FP judge off → on | judge errors |
|---|---|---|---|---|---|---|---|---|
| shop-main | original | 7 | 5/7 (71%) | 7/7 (100%) | B1 block→degrade, B7 block→degrade | – | 0 → 0 | 0 |
| shop-main | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| shop-second | original | 4 | 2/4 (50%) | 2/4 (50%) | B5 none→degrade, B8 none→degrade | B5 none→degrade, B8 none→degrade | 0 → 0 | 0 |
| shop-second | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| shop-popup | original | 1 | 1/1 (100%) | 1/1 (100%) | – | – | 0 → 0 | 0 |
| shop-popup | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| testpage | original | 6 | 3/6 (50%) | 6/6 (100%) | T1 block→degrade, T3 block→degrade, T5 none→block | – | 0 → 0 | 0 |
| testpage | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| w3c-bad | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| **total** | | 18 | 11/18 (61%) | 16/18 (89%) | | | 0 → 0 | 0 |

For every barrier the detectors found, the impact level we report for it (block / degrade / none = irrelevant to this task; the most severe if several findings hit it) is compared with `expectedImpact` in `eval/groundtruth/`, i.e. what the barrier does to that flow's task. Judge off = each detector's fixed default level, shown as the baseline.
The judge never adds findings and does not raise the detection count: its job is to rate each finding's impact on the task (including marking task-irrelevant ones as none). False positives are counted as in the detection table; a finding the judge rates none is not counted as reported.

Judge-on numbers depend on the model (`MODEL_JUDGE`); verdicts are cached in `.cache/llm`, so replaying the same recording on this machine gives the same numbers; another machine or model may differ slightly. A fresh recording can also differ: the demo pages' rotating banner lands in different steps, so the judge sees a slightly different prompt.

Reproduce: `node eval/run.mjs --replay eval/traces` (no browser; the judge columns need `.env`).

#### 解读

- 检出 18/19（95%），axe 0/19；误报从 3 降到 0（第 1 步的 D4 修复）。
- 分级准确率：judge 关 11/18（61%）→ judge 开 16/18（89%）。默认等级错在：B1、B7、T1、T3 应为 block 却给了 degrade；T5 应为 none 却给了 block。judge 把这 5 个都纠正了。
- judge 开启后剩下的 2 个不一致是 shop-second 的 B5、B8（expectedImpact 填的 none，judge 给了 degrade），正好是上面标 ⚠️ 的两处。如果你确认它们应该算 degrade，分级准确率会变成 18/18。
- 标 ⚠️ 的 B1、T1、T3、T4 在 judge 开启时和我填的一致；如果你把它们改掉，这几个会变成不一致。
- judge 的判定全部来自缓存：这次修复只让 w3c-bad 的候选从 3 个变成 0 个，其他数据集的 judge 输入没变。所以**没有重新录制 `eval/traces/`**（理由见第 1 节）。

#### 验收

- `npm test`：152 个全部通过；`npm run smoke`：9 个用例全部 ok。
- `node eval/run.mjs --replay eval/traces`：退出码 0，输出和 README 一致；`SCIFORIUM_API_KEY=` 时 judge 开启的列显示 skipped，退出码 0。

### 4. 确认后的 expectedImpact（2026-09-27）

- **B1、T1 → degrade**。读屏器按 Unicode 名称把 🛒 读成 "shopping cart"，用户能猜到和购物车有关，但分不清是"加入"还是"查看"，属于降级。testpage 上不加购也能付款，更不会阻断。设计时的 `impact: block`（B1）保留不动，它记录的是埋障碍时的意图。judge 的 prompt 没有改（属于计划 09）。
- **只是 Tab 经过的控件，按这条规则判断**（已写进 `eval/groundtruth/*.yaml` 的文件头注释）：障碍只在使用该控件时才出现，而本任务不用它 → `none`；按 Tab 经过时就会造成困扰（例如名称缺失或无法理解）→ `degrade`。
  - **B5（shop-second）→ degrade**：这是命名障碍。每次 Tab 经过，读屏都会念出 "−"、"+"，没有商品名，听的人不知道这是什么控件。属于"经过时就会造成困扰"。
  - **B8（shop-second）→ degrade**：`outline:none` 不需要操作控件就会暴露。视力正常的键盘用户按 Tab 经过卡号框和 Pay 时，焦点指示消失两次，不知道焦点停在哪里、还要按几次 Tab。对读屏用户没有影响；这和 main 流程里 B8 判 degrade 的理由一致。
  - 这两个我不再拿不准，不需要去问前端队友。
- **T3、T4 保持 block**。`testpage.yaml` 里注明：评分以录制路线为准，录制路线故意输错卡号，模拟用户打错字；从错误中恢复是任务的一部分，用户听不到错误提示就无法改正和付款。同样的说明由 `eval/run.mjs` 输出到表下，README 里也有。
- 没有重新录制 `eval/traces/`（见第 1 节）。

#### 结果表（`node eval/run.mjs --replay eval/traces` 的原样输出，连跑两次完全一致，judge 全部命中缓存）

#### Detection rate: planted barriers vs tools (judge off)

| dataset | variant | tool | planted | detected | missed | false positives |
|---|---|---|---|---|---|---|
| shop-main | original | ours (judge off) | 8 | 7 | B3† | 0 |
| shop-main | original | axe (WCAG rules) | 8 | 0 | B1 B2 B3† B4 B5 B6 B7 B8 | 0 |
| shop-main | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-main | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-second | original | ours (judge off) | 4 | 4 | – | 0 |
| shop-second | original | axe (WCAG rules) | 4 | 0 | B5 B8 B9 B10 | 0 |
| shop-second | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-second | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-popup | original | ours (judge off) | 1 | 1 | – | 0 |
| shop-popup | original | axe (WCAG rules) | 1 | 0 | B11 | 0 |
| shop-popup | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-popup | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| testpage | original | ours (judge off) | 6 | 6 | – | 0 |
| testpage | original | axe (WCAG rules) | 6 | 0 | T1 T2 T3 T4 T5 T6 | 0 |
| testpage | fixed | ours (judge off) | 0 | 0 | – | 0 |
| testpage | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| w3c-bad | fixed | ours (judge off) | 0 | 0 | – | 0 |
| w3c-bad | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| **total** | | ours (judge off) | 19 | 18/19 (95%) | 1 | 0 |
| **total** | | axe (WCAG rules) | 19 | 0/19 (0%) | 19 | 0 |

† vision-only barrier (B3): text printed on an image; no keyboard/screen-reader rule can see it, so it is counted as a miss for us too.
Detection counts every planted barrier, including those expected to be irrelevant to the task (expectedImpact none): finding them is the detectors' job; whether they matter is the judge's.
Same trace for every tool (recorded key scripts `eval/keys.*.json`). axe counts only WCAG-tagged rules, per affected element; findings are matched to barriers by `data-barrier` id, unmatched = false positive.
axe best-practice rule nodes, not counted above: shop-main/original 1, shop-main/fixed 1, shop-second/original 1, shop-second/fixed 1, shop-popup/original 1, shop-popup/fixed 1, testpage/original 7, testpage/fixed 5, w3c-bad/fixed 28.
w3c-bad = W3C Before-and-After Demonstration, "after" (accessible) version: nothing planted, so it only measures false positives.
keyboard-a11y-tester: not included in this comparison.

#### Impact accuracy: same trace, judge on vs off

| dataset | variant | detected barriers | agree, judge off (defaults) | agree, judge on | judge off: expected→given | judge on: expected→given | FP judge off → on | judge errors |
|---|---|---|---|---|---|---|---|---|
| shop-main | original | 7 | 6/7 (86%) | 6/7 (86%) | B7 block→degrade | B1 degrade→block | 0 → 0 | 0 |
| shop-main | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| shop-second | original | 4 | 4/4 (100%) | 4/4 (100%) | – | – | 0 → 0 | 0 |
| shop-second | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| shop-popup | original | 1 | 1/1 (100%) | 1/1 (100%) | – | – | 0 → 0 | 0 |
| shop-popup | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| testpage | original | 6 | 4/6 (67%) | 5/6 (83%) | T3 block→degrade, T5 none→block | T1 degrade→block | 0 → 0 | 0 |
| testpage | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| w3c-bad | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| **total** | | 18 | 15/18 (83%) | 16/18 (89%) | | | 0 → 0 | 0 |

For every barrier the detectors found, the impact level we report for it (block / degrade / none = irrelevant to this task; the most severe if several findings hit it) is compared with `expectedImpact` in `eval/groundtruth/`, i.e. what the barrier does to that flow's task. Judge off = each detector's fixed default level, shown as the baseline.
expectedImpact is scored on the recorded route: e.g. the testpage script types a short card number on purpose, a user's typo; recovering from it is part of the task, and a user who never hears the error cannot correct it and pay, so T3 (unannounced error) and T4 (dialog trap) are block.
The judge never adds findings and does not raise the detection count: its job is to rate each finding's impact on the task (including marking task-irrelevant ones as none). False positives are counted as in the detection table; a finding the judge rates none is not counted as reported.

Judge-on numbers depend on the model (`MODEL_JUDGE`); verdicts are cached in `.cache/llm`, so replaying the same recording on this machine gives the same numbers; another machine or model may differ slightly. A fresh recording can also differ: the demo pages' rotating banner lands in different steps, so the judge sees a slightly different prompt.

Reproduce: `node eval/run.mjs --replay eval/traces` (no browser; the judge columns need `.env`).

#### 解读

- **分级一致率：judge 关 15/18（83%），judge 开 16/18（89%）**。确认前是 11/18 → 16/18。
- judge 开启时的合计没有下降，但构成变了：shop-second 的 B5、B8 现在一致了（judge 给的是 degrade），B1、T1 变成了不一致（judge 给 block，标准答案是 degrade）。也就是说，按确认后的标准，judge 在"表情符号名称"这类障碍上判得偏重。
- judge 关闭时从 11 升到 15，是因为 weak-name 的默认等级本来就是 degrade，这 4 处改完后正好和默认一致。所以 judge 相对默认等级的提升从 +5 缩小到 +1：judge 纠正了 B7、T3（block）和 T5（none），但把 B1、T1 判重了。
- 检出率不受影响：我们 18/19（95%），axe 0/19，误报 0。

#### 验收

- `npm test`：152 个全部通过。`node eval/run.mjs --replay eval/traces`：退出码 0，输出和 README 一致。

### 5. 重新录制 `eval/traces/`（2026-09-27，商店页面美化 + shop-main 新 goal）

- 原因：`sites/shop/` 加了本地 SVG 插图、hero 区和页脚（original 和 fixed 同步，可见文字、障碍、`data-barrier` 和元素 id 都不变），读屏能读到的页面文本变了；`shop-main.yaml` 的 goal 改成和 `config/test-data/shop.json` 的 `payment_card` 相同的句子（"Pay with the test card 4000 0000 0000 0002. If it is declined, try 4242 4242 4242 4242."，商品部分不变）。
- 做法：`node eval/run.mjs --save-traces eval/traces`，judge 开启。9 条流程里没有模型调用失败、超时或 judge 错误；有候选的 4 条流程各调用 judge 1 次，所有 finding 都有 judge 结论。之后 `node eval/run.mjs --replay eval/traces` 连跑两次，输出完全一致，并且和录制时的表一致。
- 和第 4 节相比：
  - 检出率不变：我们 18/19（95%），axe 0/19，误报 0。axe best-practice 节点数也不变。
  - judge 关闭的分级一致率不变：15/18（83%）。
  - judge 开启：16/18（89%）→ **15/18（83%）**。只有 testpage/original 变了：**T5**（pointer-only，expectedImpact none）从一致（judge 给 none）变成 judge 给 degrade；T1 仍然是 degrade→block。假电商站三条流程的 judge 结论和第 4 节完全相同（shop-main 仍只有 B1 degrade→block 不一致）。
  - testpage 的页面这次没有改，T5 的变化来自重新录制本身：这就是第 1 条说的问题（重新录制后 judge 的提示词里有毫秒级抖动，缓存失效，模型重新回答）。第 1 条里 testpage 5 次重新录制，judge 只有 2 次把 T5 判成 none，可见 T5 的结论本来就不稳定；上一版 trace 正好是 none，这一版是 degrade。

#### 结果表（`node eval/run.mjs --replay eval/traces` 的原样输出）

#### Detection rate: planted barriers vs tools (judge off)

| dataset | variant | tool | planted | detected | missed | false positives |
|---|---|---|---|---|---|---|
| shop-main | original | ours (judge off) | 8 | 7 | B3† | 0 |
| shop-main | original | axe (WCAG rules) | 8 | 0 | B1 B2 B3† B4 B5 B6 B7 B8 | 0 |
| shop-main | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-main | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-second | original | ours (judge off) | 4 | 4 | – | 0 |
| shop-second | original | axe (WCAG rules) | 4 | 0 | B5 B8 B9 B10 | 0 |
| shop-second | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-second | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-popup | original | ours (judge off) | 1 | 1 | – | 0 |
| shop-popup | original | axe (WCAG rules) | 1 | 0 | B11 | 0 |
| shop-popup | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-popup | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| testpage | original | ours (judge off) | 6 | 6 | – | 0 |
| testpage | original | axe (WCAG rules) | 6 | 0 | T1 T2 T3 T4 T5 T6 | 0 |
| testpage | fixed | ours (judge off) | 0 | 0 | – | 0 |
| testpage | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| w3c-bad | fixed | ours (judge off) | 0 | 0 | – | 0 |
| w3c-bad | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| **total** | | ours (judge off) | 19 | 18/19 (95%) | 1 | 0 |
| **total** | | axe (WCAG rules) | 19 | 0/19 (0%) | 19 | 0 |

† vision-only barrier (B3): text printed on an image; no keyboard/screen-reader rule can see it, so it is counted as a miss for us too.
Detection counts every planted barrier, including those expected to be irrelevant to the task (expectedImpact none): finding them is the detectors' job; whether they matter is the judge's.
Same trace for every tool (recorded key scripts `eval/keys.*.json`). axe counts only WCAG-tagged rules, per affected element; findings are matched to barriers by `data-barrier` id, unmatched = false positive.
axe best-practice rule nodes, not counted above: shop-main/original 1, shop-main/fixed 1, shop-second/original 1, shop-second/fixed 1, shop-popup/original 1, shop-popup/fixed 1, testpage/original 7, testpage/fixed 5, w3c-bad/fixed 28.
w3c-bad = W3C Before-and-After Demonstration, "after" (accessible) version: nothing planted, so it only measures false positives.
keyboard-a11y-tester: not included in this comparison.

#### Impact accuracy: same trace, judge on vs off

| dataset | variant | detected barriers | agree, judge off (defaults) | agree, judge on | judge off: expected→given | judge on: expected→given | FP judge off → on | judge errors |
|---|---|---|---|---|---|---|---|---|
| shop-main | original | 7 | 6/7 (86%) | 6/7 (86%) | B7 block→degrade | B1 degrade→block | 0 → 0 | 0 |
| shop-main | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| shop-second | original | 4 | 4/4 (100%) | 4/4 (100%) | – | – | 0 → 0 | 0 |
| shop-second | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| shop-popup | original | 1 | 1/1 (100%) | 1/1 (100%) | – | – | 0 → 0 | 0 |
| shop-popup | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| testpage | original | 6 | 4/6 (67%) | 4/6 (67%) | T3 block→degrade, T5 none→block | T1 degrade→block, T5 none→degrade | 0 → 0 | 0 |
| testpage | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| w3c-bad | fixed | 0 | – | – | – | – | 0 → 0 | 0 |
| **total** | | 18 | 15/18 (83%) | 15/18 (83%) | | | 0 → 0 | 0 |

For every barrier the detectors found, the impact level we report for it (block / degrade / none = irrelevant to this task; the most severe if several findings hit it) is compared with `expectedImpact` in `eval/groundtruth/`, i.e. what the barrier does to that flow's task. Judge off = each detector's fixed default level, shown as the baseline.
expectedImpact is scored on the recorded route: e.g. the testpage script types a short card number on purpose, a user's typo; recovering from it is part of the task, and a user who never hears the error cannot correct it and pay, so T3 (unannounced error) and T4 (dialog trap) are block.
The judge never adds findings and does not raise the detection count: its job is to rate each finding's impact on the task (including marking task-irrelevant ones as none). False positives are counted as in the detection table; a finding the judge rates none is not counted as reported.

Judge-on numbers depend on the model (`MODEL_JUDGE`); verdicts are cached in `.cache/llm`, so replaying the same recording on this machine gives the same numbers; another machine or model may differ slightly. A fresh recording can also differ: the demo pages' rotating banner lands in different steps, so the judge sees a slightly different prompt.

Reproduce: `node eval/run.mjs --replay eval/traces` (no browser; the judge columns need `.env`).
