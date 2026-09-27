# report.json 格式说明（给前端）

后端每跑完一次审计，会在运行目录里生成一个 `report.json`。**前端只需要读这一个文件**，外加它引用的截图。

- 机器可读的完整定义：`docs/report.schema.json`（JSON Schema 2020-12，可以用来校验或生成 TypeScript 类型，例如 `npx json-schema-to-typescript docs/report.schema.json`）
- 字段齐全的示例：`docs/report.example.json`（基于真实运行数据；judge 的文字和修复部分是按真实格式手写的示意；`meta.goalInput` / `testDataAppended` / `testDataProfile` 也是示意，仓库里 testpage 实际没有自己的测试数据配置）
- 真实运行结果：`fixtures/testpage-original/report.json`（读屏用户无法完成）、`fixtures/testpage-fixed/report.json`（可以完成）、`fixtures/testpage-fixloop/report.json`（真实的"发现 → 修复 → 重跑"：带 judge、`fixes`、`findings[].fix` 和 `rerun`，`closedLoop: true`）

## 1. 怎么读取

`npm run serve` 之后，报告和截图都通过同一个服务器访问：

| 内容 | 地址 |
|---|---|
| 某次运行的报告 | `http://localhost:8080/runs/<运行目录名>/report.json` |
| 测试用的固定数据 | `http://localhost:8080/fixtures/testpage-original/report.json` |
| 截图 | 报告所在目录 + `timeline[].screenshot`，例如 `/runs/<运行目录名>/shots/0007.png` |

运行目录名形如 `2026-09-26T21-24-50-audit`，后端命令行在运行结束时会打印出来；从网页启动的运行由 `POST /api/runs` 返回，运行中的进度在同一目录的 `progress.json`，见 `docs/API.md`。所有运行（包括运行中的和命令行跑的真实网站）可以用 `GET /api/runs` 列出，同样见 `docs/API.md`。

直接用 `file://` 打开页面会读不到报告，必须经过服务器。

## 2. 顶层结构

| 字段 | 类型 | 用途 |
|---|---|---|
| `meta` | object | 这次运行的基本信息：网址、任务目标、模式 |
| `verdicts` | object | **两个核心结论**，页面最醒目的位置 |
| `counts` | object | 阻断/降级问题数量，以及 axe 的对比数字 |
| `timeline` | array | 每一步的记录，用来逐步回放 |
| `findings` | array | 问题清单，阻断在前 |
| `axe` | object / null | axe-core 的结果 |
| `fixes` | array / null | 自动修复的结果，没跑修复时为 null |
| `rerun` | object / null | 修复后重跑的前后对比，没重跑时为 null |
| `stats` | object / null | 模型调用次数、耗时等统计 |
| `fixPolicy` | object（可能没有） | 自动修复允许改什么：代码强制的规则和只写在 prompt 里的要求，适合放在修复页上。旧报告里没有这个字段 |

## 3. 各部分字段

### meta

| 字段 | 说明 |
|---|---|
| `goal` | 交给 AI 的任务，例如 "Buy the canvas tote bag" |
| `url` | 起始网址 |
| `mode` | `local` = 我们自己的测试站点；`real` = 真实网站（只检测，不修复） |
| `script` | `true` = 按预录按键运行；`false` = AI 自己决定每一步 |
| `judge` | `false` 时问题没有经过 AI 审核，`userImpact` 为空 |
| `generatedAt` | 生成时间（ISO 格式） |
| `startedAt` / `finishedAt` | 运行开始、分析结束的时间（ISO 格式），相减就是"本次审计用时"；修复后重新生成的报告保留审计的这两个时间（`generatedAt` 会更新）。真实网站模式的 `startedAt` 包含人在 Chrome 里处理验证码、按回车之前的时间。`replay` 生成的报告和旧报告里没有这两个字段 |
| `maxSteps` | 步数上限（第 0 步 `start` 不计入）：本地站点 40，真实网站 80；每有一次协助（`assist`）再加 20。可以显示"用了 14 / 40 步"。`replay` 生成的报告和旧报告里没有 |
| `goalSource` | 任务从哪里来：`user` = 用户填的；`curated` = 演示站点的预设任务（`eval/groundtruth/`）；`generated` = 用户没填，AI 根据起始页生成。可以在任务旁边显示"AI 生成"之类的标记。`replay` 生成的报告和旧报告里没有 |
| `goalReason` | 为什么选这个任务（一句英文）；用户填的任务为 `null`。没有 `goalSource` 时也没有 |
| `testDataProfile` | 拼进 goal 的测试数据配置名（`config/test-data/<名字>.json`，例如 `default`、`shop`）：AI 生成的任务，或者自动补了测试数据的用户任务（`testDataAppended`）。预设任务、原样使用的用户任务以及真实网站模式（不拼接任何支付和个人数据）为 `null`。没有 `goalSource` 时也没有 |
| `goalInput` | 用户原本输入的任务（补测试数据之前）。只在 `testDataAppended` 为 `true` 时出现，可以用它显示用户输入的原文，旁边注明"已自动补充测试数据" |
| `testDataAppended` | 只在补了测试数据时出现，值为 `true`：用户的任务里没有任何数字，而本地站点有自己的测试数据配置（例如 `config/test-data/shop.json` 的测试卡号），于是把这些值拼在任务后面，`goal` 是拼接后实际使用的任务。真实网站模式从不补充 |

### verdicts：两个核心结论

| 字段 | 说明 | 建议展示 |
|---|---|---|
| `screenReaderUserCanComplete` | **结论一：读屏用户能否完成任务**。= AI 完成了任务，并且路径上没有阻断级问题。**可能是 `null`**：无法判断（见 `inconclusiveReason`），不能显示成"不能完成" | 最大、最醒目；`null` 时显示"无法判断" |
| `agentCanComplete` | **结论二：只靠结构信息的 AI agent 能否完成**（只用键盘和读屏器能获得的信息）。和结论一同时为 `null` | 紧挨着结论一 |
| `outcome` | `done` 完成 / `stuck` 卡住 / `max-steps` 步数用完 | 小字 |
| `blockingFindings` | 阻断级问题的 id 列表 | 可以链接到问题清单 |
| `unexplainedStuck` | AI 卡住了，但没有检测器能解释原因（无法判断时为 `false`） | 为 true 时提示"需要人工查看" |
| `inconclusiveReason` | 只在两个结论为 `null` 时出现。`missing_test_data`：AI 因为任务里没有给出需要输入的值（例如卡号）而停下，这不是网站的问题。`blockingFindings` 和问题清单照常有效 | `null` 时显示原因，例如"任务里缺少测试数据（如卡号），无法判断" |
| `assistedSteps` | 只在有人协助过时出现：协助发生在哪几步（`timeline[].action.kind` 为 `assist`）。协助过的运行一律不算完成（`agentCanComplete` 为 `false`，即使 `outcome` 是 `done`），和可用性测试里"需协助完成 = 失败"一样；协助之后发现的问题照常有效，正是协助让我们走到了那里 | 结论旁注明"需要协助"，可以链接到那一步 |

无法判断时 `verdicts` 的样子（`blockingFindings` 照常列出）：

```json
{ "outcome": "stuck", "agentCanComplete": null, "screenReaderUserCanComplete": null,
  "blockingFindings": ["F4"], "unexplainedStuck": false, "inconclusiveReason": "missing_test_data" }
```

`rerun.before` / `rerun.after` 也可能是这样；`rerun.closedLoop` 只在修复前为 `false`、修复后为 `true` 时才是 `true`（修复前无法判断不算"闭环"）。

结论可能是 `null` 是后加的变化（以前一定是布尔值），前端要处理：不要用 `!screenReaderUserCanComplete` 判断"不能完成"，要分别判断 `true` / `false` / `null`。

### counts

| 字段 | 说明 |
|---|---|
| `block` / `degrade` | 阻断 / 降级问题数量 |
| `filteredOut` | 被 AI 判定为无关、已经过滤掉的候选数量 |
| `axeViolations` | axe-core 在同样页面上找到的 **WCAG** 问题数。**为 `null` 表示 axe 没能运行，要显示"axe 不可用"，绝对不能显示成 0** |
| `axeBestPractice` | axe 的非 WCAG 建议数，单独显示 |

适合做成对比："axe：0 个 WCAG 问题 / 我们：2 个阻断问题"。

### timeline：逐步回放

每一步一个对象，按顺序排列。

| 字段 | 说明 | 对应画面 |
|---|---|---|
| `i` | 步骤编号，从 0 开始 | 步骤列表 |
| `t` | 距离第 0 步的毫秒数（第 0 步是 0），用来做时间轴，例如 00:12。`null` 表示 trace 里没有这一步的时间；旧报告里没有这个字段 | 回放时间轴 |
| `action.kind` | `start` / `press` / `type` / `done` / `stuck` / `assist`。`assist` **不是 AI 的操作**：键盘陷阱被规则确认后（Tab 只在几个元素间打转、Esc 无效、没有可 Tab 到的关闭按钮），一位"看得见屏幕的协助者"用鼠标点了关闭按钮，让审计能继续发现后面的问题。本地站点、由 AI 操作时才会出现，每次运行最多 2 次 | 步骤列表；`assist` 建议用不同样式，例如"协助者介入" |
| `action.target` | 协助者点击的元素（`assist` 时），CSS 选择器，例如 `#joinclose` | 可选 |
| `action.key` | 按下的键（`press` 时），如 `Tab`、`Enter`、`Escape` | 步骤列表 |
| `action.text` | 输入的文字（`type` 时） | 步骤列表 |
| `action.replace` | 为 true 表示替换了输入框原有内容 | 可选 |
| `action.reason` | **AI 这一步的想法**，例如 "Pressed Pay and heard nothing" | 步骤列表，建议显示，这是"AI 在想什么" |
| `screenshot` | 截图路径，相对于报告所在目录；为 `null` 表示截图失败 | **中栏：屏幕上看到的** |
| `shotSize` | 这张截图的实际像素宽高和设备像素比 `{w, h, dpr}`；没有截图时为 null，旧报告里没有这个字段。换算方法见第 4 节 | 换算框的位置 |
| `focusRect` | 焦点元素的位置 `{x, y, w, h}`（CSS 像素），可能为 null | 在截图上画焦点框 |
| `seen` | 这一步之后**屏幕上新出现的文字**：`[{text, rect}]` | 中栏：列出文字，并在截图上画框 |
| `seenNoise` | 被识别为噪音的变化（轮播、倒计时） | 可选，灰色显示 |
| `focus` | 读屏器对当前焦点的描述，例如 `button "Pay"` | **右栏：辅助技术获知的** |
| `heard` | 这一步读屏用户**听到的所有内容**。**空数组 = 什么都没听到**，要醒目显示，例如"（无）"。`spokenSource` 为 `"virtual-screen-reader"` 时它就是虚拟读屏器的原话（和 `spoken` 相同，例如 `button, Pay`）；为 null 时是规则推算的（例如 `button "Pay"`） | 右栏 |
| `spoken` | 开源虚拟读屏器（Guidepup，MIT）这一步**逐字说的话**：焦点落到某处时是"角色, 名字, 内容, 描述, 状态"，例如 `textbox, Card number, 4242 4242, Card number is invalid, invalid`；live region 播报是 `polite: …` / `assertive: …`；页面加载是 `document`。空数组 = 它什么都没说。密码显示为 •；真实网站上用户自己填的字段值显示为 `(redacted)`。旧报告里没有这个字段 | 右栏，可以标注"虚拟读屏器原话" |
| `spokenSource` | `"virtual-screen-reader"` = 右栏内容来自虚拟读屏器；`null` = 它这一步没在运行（旧 trace，或在这个页面启动失败），`heard` 是规则推算的。旧报告里没有这个字段 | 右栏标题旁的小标签 |
| `findingIds` | 这一步涉及的问题 id | 步骤有问题时标红或标色 |

**demo 最关键的一帧**（`fixtures/testpage-original` 第 7 步，按下 Pay 之后）：

```json
{
  "i": 7,
  "action": { "kind": "press", "key": "Enter", "reason": "Submitting payment" },
  "focus": "button \"Pay\"",
  "seen": [{ "text": "Card number is invalid", "rect": { "x": 470, "y": 401, "w": 339, "h": 19 } }],
  "heard": [],
  "spoken": [],
  "spokenSource": "virtual-screen-reader",
  "findingIds": ["F2", "F3"]
}
```

屏幕上出现了"Card number is invalid"，虚拟读屏器一个字都没说。中栏和右栏并排放，差异一目了然。修复版同一步 `spoken` 是 `["assertive: Card number is invalid"]`。

### findings：问题清单

已经按严重程度排好序（`block` 在前），被判定为无关的问题已经去掉。

| 字段 | 说明 |
|---|---|
| `id` | F1、F2……在本报告内唯一 |
| `impact` | `block` = 任务走不下去；`degrade` = 能走但困难 |
| `summary` | 一句话描述问题（给工程师看） |
| `userImpact` | 一句话描述用户的遭遇（给产品、法务看）。judge 关闭时为空字符串，此时不显示 |
| `wcag` | 对应的 WCAG 条款，例如 `["4.1.3", "3.3.1"]` |
| `layer` | `presence` 信息根本不存在 / `association` 没有关联到对应控件 / `announcement` 变化时没有播报 / `operation` 键盘无法操作 |
| `detector` | 哪个检测器发现的。目前有 `unannounced`、`association`、`trap`、`unnamed`、`weak-name`、`focus-lost`、`focus-visible`、`pointer-only`，**以后还会增加，遇到不认识的值请原样显示** |
| `steps` | 作为证据的步骤编号，可以做成"跳到这一步" |
| `evidence.text` | 涉及的屏幕文字，例如 "Card number is invalid" |
| `evidence.screenshot` | 证据截图 |
| `axeAlsoFound` | axe 是否也发现了这个问题。我们的问题大多是 false，这正是差异化所在 |
| `judged` | false 表示没有经过 AI 审核，严重程度是默认值 |
| `fix` | 修复方案。没跑修复、或者这条问题的 edit 一条都没应用成功时为 null（原因见 `fixes[].errors`）。`fix.edits` 是 `[{file, old, new}]`，**只包含真正应用到修复副本上的 edit**，可以直接显示成"修改前 / 修改后"的对比；`fix.rationale` 是 fixer 的一句话理由 |
| `hint`、`candidateId`、`evidence.selector`、`evidence.barrierId` | 技术细节，可以不显示 |

### fixes 和 rerun：修复后重跑

`fixes` 是每条修复的执行结果：`{finding, applied, errors, rationale}`，每条要修复的问题一项（默认是全部阻断问题；通过 API 指定 `findingIds` 时只有这些，见 `API.md`）。每次修复都从原站点重新复制，所以上一次修复留下的 `findings[].fix` 会清空，只保留这一次的。`applied` 为 0 表示这条修复没成功；`applied` 大于 0 时 `errors` 也可能不为空（例如某条 edit 因为会删掉可见文字被拒绝，其余的应用了）。运行 `fix` 后，后端会重新生成 `report.json`，`fixes` 和 `findings[].fix` 就有值了，`rerun` 此时为 null（修复变了，旧的重跑结果作废）。

`rerun` 是修复后用同一个任务重跑的对比：

| 字段 | 说明 |
|---|---|
| `closedLoop` | **为 true 表示修复前读屏用户无法完成、修复后可以完成**，这就是"修复后通过"的总结论 |
| `before` / `after` | 修复前后的两个结论，结构和 `verdicts` 一样。适合并排显示"否 → 能" |
| `status` | 每条原有问题的状态：`resolved` 已解决 / `persists` 仍存在，`id` 对应本报告的 findings |
| `introduced` | 修复后新出现的问题（id 指向重跑那次运行自己的报告） |
| `runDir` | 重跑那次运行的目录，相对仓库根目录，例如 `runs/2026-09-27T00-54-18-rerun`，它的报告在 `/runs/<运行目录名>/report.json`。固定数据（`fixtures/`）里的 `runDir` 指向没有提交的运行，链接会打不开 |

`status[].key` 是后端内部用的匹配键，**请不要解析它**。

### fixPolicy：修复的限制

修复页可以直接展示这些规则，文字和后端的真实行为一致（`src/fix/policy.mjs` 是唯一出处）：

```json
"fixPolicy": {
  "enforced":   [{ "id": "keep-visible-text", "rule": "An edit may add text but may not remove any visible text or string literal." }, "..."],
  "instructed": [{ "id": "attributes-and-small-js", "rule": "Only add or change attributes (aria-*, role, tabindex, id) or add small JavaScript (focus management, key handlers)." }, "..."]
}
```

| 字段 | 说明 |
|---|---|
| `enforced` | **代码强制执行**：违反的 edit 一定不会被应用，原因写在 `fixes[].errors` 里（错误信息末尾就是对应规则的 `rule` 原文）。目前三条：不能删除可见文字和字符串（`keep-visible-text`）、被替换的内容在文件里必须只出现一次（`unique-match`）、只改修复副本里的文件（`site-copy-only`） |
| `instructed` | **只写在给模型的 prompt 里**，代码不检查。例如"只改 ARIA 属性或加少量 JavaScript"属于这一类，展示时不要说成强制规则 |

每条是 `{id, rule}`：`rule` 是一句英文，可以直接显示；`id` 稳定，可以用来做图标或翻译。当前完整内容见 `docs/report.example.json`。

### stats

`calls`（成功的模型调用次数）、`ms`（总耗时，毫秒）、`cacheHits`（从缓存回放的次数）、`llmFailures`、`llmTimeouts` 等。按预录按键运行时没有这些模型统计。可以放在页脚，例如"本次审计调用模型 15 次，用时 31 秒"。

`spokenAgreement`（例子来自 `fixtures/testpage-fixed`）：我们的规则和虚拟读屏器对"这条新出现的文字有没有被播报"各自给出判断，这里是两者的一致情况，适合做成"两种独立方法结论一致 N/M"的标注。只在至少有一步运行了虚拟读屏器时出现（旧报告没有）。

```json
"spokenAgreement": {
  "compared": 10, "agreed": 8, "fallbackSteps": 0,
  "disagreements": [{ "step": 4, "text": "Card number Pay", "rules": true, "virtualScreenReader": false },
                    { "step": 13, "text": "Card number Pay", "rules": true, "virtualScreenReader": false }]
}
```

| 字段 | 说明 |
|---|---|
| `compared` | 参与比较的步数：虚拟读屏器在运行、且屏幕上出现了新文字 |
| `agreed` | 其中两者对每条新文字的判断都相同的步数。一致率 = `agreed / compared` |
| `fallbackSteps` | 虚拟读屏器没在运行、只能用规则推算的步数 |
| `disagreements` | 每条判断不同的文字：`step` 是 `timeline[].i`，`rules` / `virtualScreenReader` 分别表示规则、读屏器认为它被播报了。可以做成跳转链接 |

testpage 上唯一的不一致是弹窗打开那一步：焦点移进弹窗时，规则把弹窗里的文字都算作听到了，虚拟读屏器只说弹窗名字和焦点所在的输入框。

## 4. 坐标和截图

- `rect` 和 `focusRect` 的单位是页面的 **CSS 像素**。截图上的像素 = CSS 像素 × `timeline[].shotSize.dpr`。
- 画框时：`缩放比 = 显示宽度 / shotSize.w`，框在显示图上的位置 = `rect × shotSize.dpr × 缩放比`（x、y、w、h 都这样算）。
- 本地模式固定是 `{w: 1280, h: 800, dpr: 1}`，所以 CSS 像素就是截图像素，按"显示宽度 / 1280"缩放即可。
- 真实网站模式（`meta.mode: "real"`）连的是用户自己的 Chrome，窗口大小和 dpr 都不固定：例如 Mac 的 Retina 屏上 dpr 是 2，截图宽度是 CSS 宽度的两倍。**不要假定 1280×800**；每一步都可能不同（用户中途调整了窗口）。
- 没有 `shotSize`（旧报告）时按本地模式处理。任何 `rect` 都可能是 `null`，这时不画框。

## 5. 兼容性约定

- 后端对 `report.json` **只新增字段，不改名、不删除**。
- 遇到不认识的字段请忽略；遇到不认识的枚举值（例如新的 `detector`）请原样显示。
- `null` 表示"没有这项数据"，**不等于 0**，也不等于"没问题"。
- 需要新字段时告诉后端，由后端加进 `report.json`，前端不要去读 `trace.jsonl` 等内部文件：它们的格式随时可能改变。

## 6. 即将新增的字段

以下字段正在开发中，出现之后可以直接使用，没出现时请兼容：

| 字段 | 内容 | 来源 |
|---|---|---|
| 新的 `detector` 值 | 弹窗相关的检测，例如背景没有被隔离、弹窗没有正确标记 | 讨论中 |

## 7. 目前的已知情况

- 修复相关的展示可以用 `fixtures/testpage-fixloop/report.json`（真实数据）开发。testpage 上只有一条阻断问题，所以那里只有一条修复；`docs/report.example.json` 里有两条（手写示意）。
- `viewer/sample/report.json` 的 timeline 里缺少 `seenNoise` 字段，真实报告里始终有这个字段。
