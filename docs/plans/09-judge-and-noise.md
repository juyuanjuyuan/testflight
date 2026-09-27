# 09 — judge 与噪音调优

**目标：** 让 judge 在假站和真实网站上把无关变化（轮播、推荐、倒计时）过滤掉，并按"是否阻断任务"正确分级。

**依赖：** 03、05（需要假站的 trace）、08（需要真实网站的 trace）　**预计：** 1.5 小时

**先读：** `docs/ARCHITECTURE.md` §5–6、`src/agent/judge.mjs`、`src/agent/prompts/judge.md`、`src/detect/**`、`src/runner/recorder.js`（噪音计数）

**可以改：** `src/agent/judge.mjs`、`src/agent/prompts/judge.md`、`src/contracts.mjs` 里的噪音相关常量（`BASELINE_MS`、`NOISE_REPEAT`、`CHANGE_WINDOW_MS`）
**不要改：** 让 judge 能新增问题（它只能标注检测器的候选）

## 步骤

1. 收集 trace：假站两条流程的 original/fixed 各一条，真实网站预跑的 2–3 条。
2. 对每条 trace 跑 `replay --no-judge` 和 `replay`（开启 judge），对比两者的候选和结果。
3. 逐条看误判：
   - 噪音没被过滤 → 先考虑调确定性参数（`BASELINE_MS`、`NOISE_REPEAT`），不行再改 prompt；
   - 分级不对（比如把卡被拒未播报标成 degrade）→ 在 prompt 里补充判断标准，不要写死具体元素；
   - 🛒 这类名称判断不稳定 → 在 prompt 里给出判断准则。
4. 每改一次都重跑全部 trace，确保没有把之前正确的结果改错。
5. 在本文件"结果"一节记下调整前后的误报数。

## 验收

- 假站 fixed：两条流程开启 judge 后 0 条 block/degrade。
- 假站 original：所有埋入的阻断问题被判为 block。
- 真实网站 trace：轮播、推荐类变化不再出现在报告里。

## 结果

**trace**：假站三条流程（main / second / popup）的 original 和 fixed，用当前 runner 和预录按键重录（`--no-judge`）；真实网站用计划 08 的两条预跑（候选 1：80 步 stuck；候选 2：57 步 done）；testpage 两个 fixture；另写了一个探针页（1 Hz 倒计时 + 3 秒轮播 + 一个未播报的 toast），只在本机 scratch 里用，不进 repo。每条 trace 都用 `analyze()` 分别跑 judge 关、旧 prompt、新 prompt。

**改了什么**
1. `BASELINE_MS` 2000 → 3500（确定性参数，先调它）。证据：探针页上 1 Hz 倒计时在 2 秒基线里只变 2 次（`repeatCount` 2 < `NOISE_REPEAT` 3），3/3 次运行都报成 unannounced；改成 3500 后 3/3 次都被过滤，真 toast 仍然检出。假站 700ms 的促销横幅原来第一次出现在变化里时 `repeatCount` 是 3（6 次里有 5 次是 3、1 次是 4），正好卡在阈值上，现在是 5。代价是每次运行多等 1.5 秒（只在 `start()`，跳转后不等）。
   - `NOISE_REPEAT` 不变：降到 2 在两个真实网站的 208 条 unannounced 候选里一条都去不掉（没有 `repeatCount` 正好是 2 的），反而会把"空闲时变了两次"的真实内容当噪音。
   - `CHANGE_WINDOW_MS` 不变：降到 1000 只去掉候选 2 第 35 步的 19 条（都是 SPA 新页面内容，judge 已经判成 none），却可能漏掉走网络的慢反馈（比如卡被拒）。
   - 几秒一换的轮播靠基线抓不到（要 3 × 周期），交给 judge：探针页的 3 秒轮播被 judge 判为 none。
2. judge 输入（`judge.mjs`）：每步新增 `focusBefore`（按键时焦点所在的控件，judge 才知道"按了哪个按钮之后"）和 `newView`（页面跳转，**或** URL 变了但没有 load 的 SPA 路由切换）。每批只发这批候选用到的步骤（原来每批都带全部步骤）。新增导出 `judgeInput()`，`test/pipeline.test.mjs` 加了一条测试。
3. prompt（`prompts/judge.md`）补了判断准则，没写死任何具体元素：
   - 不相关：不是用户操作引起的（轮播、倒计时、广告、聊天助手）；完成目标用不到的可选内容（推荐、热门/最近搜索、输入时的自动补全、促销、"N 人在看"、评论），即使紧跟在用户操作之后出现；`newView` 时新页面本身的内容。同一情况下的同类候选要判得一致。
   - block：必须处理的错误没有传达（卡被拒、校验错误）；任务**必需**的控件名称说不清用途（没名字，或只有 emoji/符号：读屏器读的是字符的 Unicode 名称，比如一个物品名，不是动作）；键盘到不了必需控件或离不开挡路的东西。degrade：成功没有确认但能用别的办法核实、焦点掉到 body、没有焦点框、次要控件只有符号名。
   - 合并了多个步骤的候选要看每一步，按最严重的一步判（候选 2 的"Add to Bag"→"Adding to Bag…"就是这种）。
   - trap：只有**同一个键**反复按还在循环才算；Tab 和 Shift+Tab 交替是用户自己来回走，判 none。
   - 同名控件：只有任务需要在它们之间选、又分不清时才算 degrade。pointer-only：任务必需 → block；跳转链接这类便利功能 → degrade；说明性内容、广告标签 → none。

**误报数**（假站和 testpage 按 `data-barrier` 计分；真实网站没有标准答案，是人工逐条看的：候选 1 真问题 6 条：搜索分类下拉框无名称、搜索后焦点掉到 body、2 个无焦点框、2 个键盘到不了的跳转链接；候选 2 真问题 4 条："Add to Bag"之后只有按钮文字变成"Adding to Bag…"、同一步焦点掉到 body、2 个无焦点框）

| trace | 候选数 | judge 关：显示 / 误报 | 旧 prompt：显示 / 误报 | 新 prompt：显示 / 误报 | 备注 |
|---|---|---|---|---|---|
| 假站 main original | 9 | 9 / 0 | 9 / 0 | 9 / 0 | 检出 7/8（B3 只有视觉能看出）；**B1 🛒 旧 prompt 判 degrade，新的判 block** |
| 假站 second original | 6 | 6 / 1 | 6 / 1 | 6 / 1 | 那 1 条是 B8（卡号框无焦点框），second 流程也经过它，但 `shop-second.yaml` 没登记，见下文 |
| 假站 popup original | 2 | 2 / 0 | 2 / 0 | 2 / 0 | B11 两条都是 block |
| 假站 fixed ×3 | 0 | 0 / 0 | 0 / 0 | 0 / 0 | |
| testpage original / fixed | 7 / 0 | 7 / 0 · 0 / 0 | — | 7 / 0 · 0 / 0 | 6/6；T1 🛒 和 T3"卡号无效"未播报都判为 block |
| 探针页（倒计时 + 轮播） | 3 → 2 | 3 / 2 → 2 / 1 | — | 1 / 0 | 箭头左边是 2 秒基线，右边是 3.5 秒基线；倒计时靠基线过滤，轮播靠 judge |
| 真实网站 候选 1 | 56 | 56 / 50（显示的里面 10 条是 block） | 8 / 2 | 5 / 0 | 旧 prompt 把 Tab/Shift+Tab 来回走判成 **block 级 trap**；新 prompt 漏了分类下拉框（有 description 能读出用途，不关缓存时判 degrade，属边界） |
| 真实网站 候选 2 | 172 | 172 / 168 | 22 / 19 | 4 / 0 | 旧 prompt 留了 17 条搜索建议/热门搜索，还漏掉了"Adding to Bag…"；新 prompt 4 条全是真问题，包括 demo 要讲的那一条 |

**验收**
- 假站 fixed：三条流程开启 judge 后都是 0 条 block/degrade ✅
- 假站 original：埋入的阻断问题 B1、B7、B9、B10、B11 全部判为 block ✅（旧 prompt 把 B1 判成 degrade）
- 真实网站：轮播、推荐、热门搜索、自动补全都不再出现在报告里 ✅
- `npm test` 88/88，`npm run smoke` 全部通过（`BASELINE_MS` 会影响 runner）

**稳定性**：关掉缓存（`LLM_CACHE=off`）重跑一遍新 prompt，约 250 条标注里有 2 条变了，都是边界情况：B9 弹窗出现时的 unannounced 在 block/degrade 之间（B9 的 trap 两次都是 block）；候选 1 的分类下拉框在 none/degrade 之间。

**范围说明**：除了"可以改"里的文件，还改了 `test/pipeline.test.mjs`（给 `judgeInput()` 加一条测试）和 `docs/ARCHITECTURE.md` §5 的一句话（基线从 2 秒改成 3.5 秒）。report.json 结构没变。

**交给其他计划（检测器/标准答案问题，按本计划的范围没改）**
- **D2 误报（`src/detect/trap.mjs`）**：`isTab` 把 Tab 和 Shift+Tab 算在同一串里，planner 来回按 Tab/Shift+Tab 就被当成两个元素之间的循环（候选 1 第 31–38 步）。现在靠 judge 判 none，应该在检测器里只认同方向的连续按键，先写回归测试。✅ 已修：`detectTrap` 换方向就重新开始一串，回归测试在 `test/pipeline.test.mjs`；shop 的 B9、B11 在 `--no-judge` 下仍然检出。
- **SPA 路由切换**：URL 变了但没有 `pageLoad`，D1 会把整个新页面的内容都当成"未播报的变化"（候选 2 第 35 步 140 条）。现在靠 `newView` 让 judge 过滤，但要多花约 12 次 judge 调用；而且真正的问题（SPA 跳转后什么都没播报、焦点没动）没有单独的检测器，只能从 focus-lost 间接看到。建议：D1 跳过 URL 变化的步骤，再加一条"视图切换没有任何播报"的检测。
- **`dedupe` 跨步合并**：同一元素在不同步骤的不同文字会合并成一个候选，`evidence.text` 和 `hint` 只保留第一步（候选 2 的 F39 显示"Add to Bag"，真正的问题是第 54 步的"Adding to Bag…"）。judge 现在会看所有步骤，但报告里显示的文字是错的。
- **`eval/groundtruth/shop-second.yaml`**（计划 05/10）：second 流程也经过结账页的卡号框，应该像 B5 一样把 B8 也登记进去，否则 second 流程永远多算 1 个误报。
- **demo 缓存（计划 12）**：prompt 改了，旧的 judge 缓存都不会再命中。演练用 `LLM_CACHE=readonly` 之前，先用 `readwrite` 把 demo 用的 trace 重跑一遍。
