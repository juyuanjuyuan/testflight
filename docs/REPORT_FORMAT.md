# report.json 格式说明（给前端）

后端每跑完一次审计，会在运行目录里生成一个 `report.json`。**前端只需要读这一个文件**，外加它引用的截图。

- 机器可读的完整定义：`docs/report.schema.json`（JSON Schema 2020-12，可以用来校验或生成 TypeScript 类型，例如 `npx json-schema-to-typescript docs/report.schema.json`）
- 字段齐全的示例：`docs/report.example.json`（基于真实运行数据；judge 的文字和修复部分是按真实格式手写的示意）
- 真实运行结果：`fixtures/testpage-original/report.json`（读屏用户无法完成）、`fixtures/testpage-fixed/report.json`（可以完成）

## 1. 怎么读取

`npm run serve` 之后，报告和截图都通过同一个服务器访问：

| 内容 | 地址 |
|---|---|
| 某次运行的报告 | `http://localhost:8080/runs/<运行目录名>/report.json` |
| 测试用的固定数据 | `http://localhost:8080/fixtures/testpage-original/report.json` |
| 截图 | 报告所在目录 + `timeline[].screenshot`，例如 `/runs/<运行目录名>/shots/0007.png` |

运行目录名形如 `2026-09-26T21-24-50-audit`，后端命令行在运行结束时会打印出来。目前没有"列出所有运行"的接口，需要的话告诉后端。

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

### verdicts：两个核心结论

| 字段 | 说明 | 建议展示 |
|---|---|---|
| `screenReaderUserCanComplete` | **结论一：读屏用户能否完成任务**。= AI 完成了任务，并且路径上没有阻断级问题 | 最大、最醒目 |
| `agentCanComplete` | **结论二：只靠结构信息的 AI agent 能否完成**（只用键盘和读屏器能获得的信息） | 紧挨着结论一 |
| `outcome` | `done` 完成 / `stuck` 卡住 / `max-steps` 步数用完 | 小字 |
| `blockingFindings` | 阻断级问题的 id 列表 | 可以链接到问题清单 |
| `unexplainedStuck` | AI 卡住了，但没有检测器能解释原因 | 为 true 时提示"需要人工查看" |

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
| `action.kind` | `start` / `press` / `type` / `done` / `stuck` | 步骤列表 |
| `action.key` | 按下的键（`press` 时），如 `Tab`、`Enter`、`Escape` | 步骤列表 |
| `action.text` | 输入的文字（`type` 时） | 步骤列表 |
| `action.replace` | 为 true 表示替换了输入框原有内容 | 可选 |
| `action.reason` | **AI 这一步的想法**，例如 "Pressed Pay and heard nothing" | 步骤列表，建议显示，这是"AI 在想什么" |
| `screenshot` | 截图路径，相对于报告所在目录；为 `null` 表示截图失败 | **中栏：屏幕上看到的** |
| `focusRect` | 焦点元素在截图上的位置 `{x, y, w, h}`，可能为 null | 在截图上画焦点框 |
| `seen` | 这一步之后**屏幕上新出现的文字**：`[{text, rect}]` | 中栏：列出文字，并在截图上画框 |
| `seenNoise` | 被识别为噪音的变化（轮播、倒计时） | 可选，灰色显示 |
| `focus` | 读屏器对当前焦点的描述，例如 `button "Pay"` | **右栏：辅助技术获知的** |
| `heard` | 这一步读屏用户**听到的所有内容**。**空数组 = 什么都没听到**，要醒目显示，例如"（无）" | 右栏 |
| `findingIds` | 这一步涉及的问题 id | 步骤有问题时标红或标色 |

**demo 最关键的一帧**（`fixtures/testpage-original` 第 7 步，按下 Pay 之后）：

```json
{
  "i": 7,
  "action": { "kind": "press", "key": "Enter", "reason": "Submitting payment" },
  "focus": "button \"Pay\"",
  "seen": [{ "text": "Card number is invalid", "rect": { "x": 470, "y": 401, "w": 339, "h": 19 } }],
  "heard": [],
  "findingIds": ["F2", "F3"]
}
```

屏幕上出现了"Card number is invalid"，读屏用户什么都没听到。中栏和右栏并排放，差异一目了然。

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
| `fix` | 修复方案，没跑修复时为 null。`fix.edits` 是 `[{file, old, new}]`，可以显示成"修改前 / 修改后"的对比 |
| `hint`、`candidateId`、`evidence.selector`、`evidence.barrierId` | 技术细节，可以不显示 |

### fixes 和 rerun：修复后重跑

`fixes` 是每条修复的执行结果：`{finding, applied, errors, rationale}`，`applied` 为 0 表示这条修复没成功。

`rerun` 是修复后用同一个任务重跑的对比：

| 字段 | 说明 |
|---|---|
| `closedLoop` | **为 true 表示修复前读屏用户无法完成、修复后可以完成**，这就是"修复后通过"的总结论 |
| `before` / `after` | 修复前后的两个结论，结构和 `verdicts` 一样。适合并排显示"否 → 能" |
| `status` | 每条原有问题的状态：`resolved` 已解决 / `persists` 仍存在，`id` 对应本报告的 findings |
| `introduced` | 修复后新出现的问题（id 指向重跑那次运行自己的报告） |
| `runDir` | 重跑那次运行的目录，可以链接过去查看它的完整报告 |

`status[].key` 是后端内部用的匹配键，**请不要解析它**。

### stats

`calls`（成功的模型调用次数）、`ms`（总耗时，毫秒）、`cacheHits`（从缓存回放的次数）、`llmFailures`、`llmTimeouts` 等。按预录按键运行时是空对象 `{}`。可以放在页脚，例如"本次审计调用模型 15 次，用时 31 秒"。

## 4. 坐标和截图

- `rect` 和 `focusRect` 的单位是截图上的像素。本地模式的截图固定是 1280×800，按"显示宽度 / 1280"等比缩放即可。
- 真实网站模式下截图尺寸可能不同，后端之后会在每一步加上截图的实际宽高（见第 6 节）。
- 任何 `rect` 都可能是 `null`，这时不画框。

## 5. 兼容性约定

- 后端对 `report.json` **只新增字段，不改名、不删除**。
- 遇到不认识的字段请忽略；遇到不认识的枚举值（例如新的 `detector`）请原样显示。
- `null` 表示"没有这项数据"，**不等于 0**，也不等于"没问题"。
- 需要新字段时告诉后端，由后端加进 `report.json`，前端不要去读 `trace.jsonl` 等内部文件：它们的格式随时可能改变。

## 6. 即将新增的字段

以下字段正在开发中，出现之后可以直接使用，没出现时请兼容：

| 字段 | 内容 | 来源 |
|---|---|---|
| `timeline[].spoken` | 开源虚拟读屏器（Guidepup）逐字输出的播报，例如 `"assertive: Card number is invalid"` | 计划 16 |
| `stats.spokenAgreement` | 虚拟读屏器与我们自己的判断的一致率，适合做成一个"两种方法结论一致"的标注 | 计划 16 |
| `timeline[].shotSize` | 每一步截图的实际宽高 `{w, h}`，用于换算框的位置 | 计划 08 |
| 新的 `detector` 值 | 弹窗相关的检测，例如背景没有被隔离、弹窗没有正确标记 | 讨论中 |

## 7. 目前的已知情况

- 运行 `fix` 之后，`findings[].fix` 暂时还不会自动写回 `report.json`，后端正在补（计划 04）。在那之前，修复相关的展示请先用 `docs/report.example.json` 开发。
- `viewer/sample/report.json` 的 timeline 里缺少 `seenNoise` 字段，真实报告里始终有这个字段。
