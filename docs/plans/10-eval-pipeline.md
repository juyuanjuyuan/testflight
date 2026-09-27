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
