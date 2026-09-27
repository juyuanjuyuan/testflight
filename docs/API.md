# HTTP API 与 progress.json（给前端）

对应前端的需求文档 `docs/frontend/BACKEND_CHANGES.md`，后端计划 17。**P0**（启动运行 + 实时进度）、**P1**（修复和复测，以及报告里的 `fixPolicy`）、**P2**（运行列表，报告里的 `meta.startedAt` / `finishedAt` / `maxSteps` 和 `timeline[].t`）都已完成。
计划 18 之后：`POST /api/runs` 的 `goal` 变为可选（不传时先自动确定任务，progress 多一个状态 `planning_task`），并新增 `POST /api/tasks/suggest`（§2.1）。**前端需要能显示 `planning_task` 状态。**
之后又给 `POST /api/tasks/suggest` 加了可选的 `generate`（§2.1）：`true` 时即使是有预设任务的演示站点也由模型生成。
**缺少测试数据（2026-09-27，需要通知前端）：** ① 用户填的 `goal` 里没有任何数字、而站点有自己的测试数据配置（目前是 shop）时，后端把测试卡号等拼在后面（§2），progress 的 `goal` 和报告的 `meta.goal` 是拼接后的完整任务，用户原文在新的可选字段 `meta.goalInput`，另有 `meta.testDataAppended: true`；② 因为任务里缺少需要输入的值而停下的运行不再判为"不能完成"：报告里 `verdicts.screenReaderUserCanComplete` 和 `agentCanComplete` **可能是 `null`**，同时有新字段 `verdicts.inconclusiveReason: "missing_test_data"`（`rerun.before` / `after` 也一样）。**前端要区分 `true` / `false` / `null`，`null` 显示"无法判断"并说明原因，不能用 `!verdict` 当成"不能完成"**；运行列表（§4）里已完成的运行也可能是 `null`。详见 `REPORT_FORMAT.md` 的 verdicts 一节。
前端反馈之后（计划 17 结果一节）：运行列表每项新增 `progress`（`ok` / `missing` / `corrupt`），响应新增 `skippedReasons`；新增两个 `state`：`unknown`（只出现在列表里，表示 progress.json 损坏）和 `waiting_for_user`（真实网站模式等人按回车）；排序改为按开始时间、同一秒按后缀数字。**前端需要能显示这两个新状态。**

所有接口都由 `npm run serve`（默认 8080 端口）提供，和 `/runs`、`/fixtures`、`/viewer` 是同一个服务器。`report.json` 仍然是唯一的最终结果，格式见 `REPORT_FORMAT.md`。

## 1. 和前端文档不一致的地方

| 前端文档 | 后端的实际行为 | 原因 |
|---|---|---|
| `maxSteps` 示例是 30 | 实际是 **40**（`src/contracts.mjs` 的 `MAX_STEPS`，第 0 步 `start` 不计入）；命令行跑的真实网站模式是 **80**（`MAX_STEPS_REAL`） | 以代码为准 |
| `mode` 由后端按网址判断 | 网页上**只能审计本服务器提供的站点**：主机是 `localhost` 或 `127.0.0.1`、协议是 `http`、端口就是这个服务器的端口，并且路径的前两段对应 `sites/` 下的一个目录（例如 `/shop/original/`）。其他网址返回 `400`，code `real_site_cli_only`；本服务器上不存在的站点返回 `400`，code `unknown_site` | 真实网站需要人先在 Chrome 里处理验证码，再在终端按回车，网页上做不到。真实网站照常用命令行跑 |
| 服务器监听所有网卡 | **只监听 127.0.0.1** | 接口能让服务器启动浏览器访问网址，不能让同一网络里的其他人调用。WSL 到 Windows 的 localhost 转发不受影响；Vite 代理请指向 `http://localhost:8080` 或 `http://127.0.0.1:8080` |
| `goal` 必填 | **可选**（计划 18）：不传时后端先确定任务（演示站点用预设任务，其他站点由 AI 生成），progress 先是 `planning_task`，见 §2 | 用户只填网址也能审计 |
| 请求体只有 `url`、`goal` | 另有可选的 `script`（见 §2），前端正常使用时不要传 | demo 和测试用的确定性运行，不调用模型 |
| 错误状态码 400/404/409/500 | 另有 `405`（方法不对）；请求体超过 16KB 也是 `400`（code `body_too_large`） | 保持在前端文档的状态码范围内 |
| progress.json 示例里 `step` 总是数字 | 还没有任何步骤时 `step` 是 `null` | 第 0 步（打开页面）也要一两秒 |
| `fix.constraints` 或一份文档 | 报告顶层的 **`fixPolicy`**，分 `enforced`（代码强制）和 `instructed`（只写在 prompt 里）两部分，格式见 `REPORT_FORMAT.md` 的 fixPolicy 一节 | 代码强制的只有：不能删除可见文字、`old` 必须唯一匹配、只能改站点副本内的文件；"只改 ARIA 属性"只是 prompt 里的要求，不能说成强制规则 |
| `message` "会直接显示给用户"；真实网站修复的 message 写"真实网站只检测，不修复" | 所有 `message` 都是**英文**一句话，例如 `real_site_no_fix` 是 "Real websites are only audited, not fixed."。需要中文界面时请按 `code` 自己翻译 | 所有接口的错误信息保持同一种语言；`code` 是稳定的，适合做翻译的键 |
| 修复接口的错误只有 409 两种（已有运行、真实网站） | 另有 `400 invalid_findings` / `invalid_rerun`，`409 not_fixable` / `nothing_to_fix` / `run_not_finished`，见 §6 | 在前端文档的状态码范围内细分原因 |
| `rerunDir` 只在 `rerunning` 时有值，其他时候为 null | 进入 `rerunning` 后，之后的 `done` / `failed` **保留** `rerunDir` | 复测结束后前端仍能找到复测目录；`report.json` 的 `rerun.runDir` 里也有 |
| `GET /api/runs` 返回数组 `[{ runDir, url, goal, generatedAt, screenReaderUserCanComplete }]` | 返回**对象** `{ "runs": [...], "skipped": 0, "skippedReasons": {} }`，每项多一个 `state` 和 `progress`，见 §4 | 计划要求把读不出来的目录数放进响应（`skipped`），数组放不下；`state` 用来区分运行中、修复中、失败 |
| 运行列表只有 `runs/` 下的运行 | 命令行跑的真实网站在 `runs/real/` 下，也会列出，`runDir` 形如 `real/2026-09-27T01-02-03-audit` | 真实网站的运行照常只用命令行跑，但结果要在网页上能看到 |
| 不传 `findingIds` 时修复所有 `block` 问题 | 同上；但如果这次运行**没有** `block` 问题，返回 `409 nothing_to_fix`，请用 `findingIds` 指定（可以指定 `degrade` 问题） | 不做"什么都没修就重跑"的空操作 |

## 2. `POST /api/runs`：启动审计

```
POST /api/runs
Content-Type: application/json

{ "url": "http://localhost:8080/testpage/original/", "goal": "Buy the canvas tote bag. Pay with card number 4242 4242." }
```

→ `202 Accepted`，`{ "runDir": "2026-09-26T21-24-50-audit" }`

| 字段 | 要求 |
|---|---|
| `url` | 必填，见 §1：只接受本服务器上的站点 |
| `goal` | 可选。传了就不能为空（去掉空白后），最多 500 个字符。**不传（或传 `null`）时自动确定任务**，见下文 |
| `script` | 可选。`eval/` 下已有的按键脚本文件名，例如 `"keys.testpage.json"`。传了之后按脚本按键，**不调用 planner 和 judge**（`meta.script: true`、`meta.judge: false`）。其他值一律 `400 invalid_script` |

- 返回之前运行目录已经创建好，里面已经有第一版 `progress.json`（`state: "running"`、`timeline: []`；不传 `goal` 时是 `state: "planning_task"`、`goal: null`），拿到 `runDir` 马上读不会 404。
- **不传 `goal`**：子进程打开起始页（第 0 步照常记录，所以 `planning_task` 时 `timeline` 里可能已经有第 0 步），用和 planner 第 0 步完全相同的信息（网址、标题、读屏能读到的页面文字）确定任务，把它写进 progress 的 `goal`，再进入 `running`。演示站点有预设任务时直接用预设（稳定、不调用模型）；否则由模型生成（会多花约 5–10 秒）。确定不了时写 `failed`，`error` 以 "Could not work out a task for this page. Please describe one." 开头。报告里 `meta.goalSource` / `goalReason` / `testDataProfile` 记录任务从哪里来（见 `REPORT_FORMAT.md`）。
- 自动生成的任务每次可能不同（LLM 缓存也就用不上），demo 主流程请继续传固定的 `goal`。
- **传了 `goal`，但里面没有任何数字**，并且站点有自己的测试数据配置（`config/test-data/<站点>.json`，目前只有 `shop.json`）：后端把配置里的测试数据按计划 18 的模板拼在后面，例如 `"buy one thing"` → `"buy one thing. Pay with the test card 4000 0000 0000 0002. If it is declined, try 4242 4242 4242 4242."`。第一版 progress.json 起 `goal` 就是拼接后的完整任务；报告里 `meta.goal` 是完整任务，`meta.goalInput` 是用户原文，`meta.testDataAppended` 为 `true`，`meta.testDataProfile` 是配置名。`goal` 里有数字（例如自己写了卡号）时原样使用。前端可以显示原文并注明"已自动补充测试数据"。
- 同一时间只有一个运行。已有运行时返回 `409 run_in_progress`（修复和复测也共用这个限制，见 §3）。
- 审计在子进程里执行（`node cli.mjs audit … --run-dir <runDir> --progress`），它的输出记在运行目录的 `cli.log`，仅供后端排查，前端不要读。
- 同一秒内启动两次，第二个目录名会带 `-2` 后缀，不会共用目录。

## 2.1 `POST /api/tasks/suggest`：建议任务

```
POST /api/tasks/suggest
Content-Type: application/json

{ "url": "http://localhost:8080/shop/original/" }
```

→ `200`，同步返回（不创建运行目录）。下面是不传 `generate` 的结果：

```json
{ "suggestions": [
  { "goal": "Buy a canvas tote bag. Pay with the test card 4000 0000 0000 0002. If it is declined, try 4242 4242 4242 4242.",
    "source": "curated", "reason": "Preset task of this demo site (main flow, eval/groundtruth/shop-main.yaml).", "needs": [] }
] }
```

| 字段 | 说明 |
|---|---|
| `url` | 必填，检查和 `POST /api/runs` 完全相同（只接受本服务器的站点，错误码也相同） |
| `generate` | 可选，布尔值，默认 `false`。`true` = 跳过 `eval/groundtruth/` 的预设任务，一律由模型根据起始页生成（`source` 都是 `generated`）；测试数据照常按站点从 `config/test-data/` 拼接（假电商站用 `shop.json`：先被拒的卡、再成功的卡），检查规则和没有预设的站点完全相同。不是布尔值（包括 `null`、`"true"`）→ `400 invalid_generate`。`false` 或不传时和以前完全一样 |
| `suggestions` | 1–3 条，最重要的在前。前端可以展示出来让用户确认或修改，再把选中的 `goal` 传给 `POST /api/runs` |
| `goal` | 最终任务文本，可以直接用。只写"做什么"，不写"怎么做"（不含 click、button 之类）；卡号、邮箱等测试数据由后端从 `config/test-data/` 拼接，模型不写任何具体的值 |
| `source` | `curated` = 演示站点预设的任务（`eval/groundtruth/`，不调用模型，结果固定）；`generated` = 模型根据起始页生成 |
| `reason` | 一句英文，为什么选这个任务 |
| `needs` | 这个任务实际拼接的测试数据类别（`payment_card` / `email` / `name` / `address` / `phone`），只会是站点配置 `needs` 里有的（shop 只有 `payment_card`）；`curated` 时为 `[]` |
| `kind` | 只在 `generated` 时有（新增，可选）：任务类型，`purchase` / `search` / `cart_edit` / `newsletter` / `info`。同一次返回里各条的 `kind` 不重复；有 `purchase` 时它一定是第一条。站点配置里没有某类任务需要的数据时（例如 shop 没有邮箱 → 不会有 `newsletter`），这类建议会被丢弃 |

- 预设任务不需要浏览器，立即返回；生成任务要打开起始页并调用一次模型，大约 5–15 秒。
- 生成任务的模型调用和其他调用一样走 LLM 缓存（`.cache/llm`，按起始页的网址、标题和页面文字）。服务器用默认的 `LLM_CACHE=readwrite` 或 `readonly` 运行时，同一个页面第二次起直接返回第一次生成的结果（1–3 秒，每次相同）；只有 `LLM_CACHE=off` 才每次都重新生成。
- 超过 90 秒（`SUGGEST_TIMEOUT_MS`）返回 `504 suggest_timeout`；模型两次都给不出合格的任务返回 `502 suggest_failed`。两种情况都请让用户自己填任务。
- 不受"同一时间只有一个运行"的限制（它不写任何运行目录）。
- 用户采用建议后，报告里的 `meta.goalSource` 是 `user`（任务是用户确认后提交的）；只有不传 `goal` 时才会是 `curated` / `generated`。

## 3. `POST /api/runs/<runDir>/fix`：修复（和复测）

```
POST /api/runs/2026-09-26T21-24-50-audit/fix
Content-Type: application/json

{ "findingIds": ["F2", "F4"], "rerun": true }
```

→ `202 Accepted`，`{ "runDir": "2026-09-26T21-24-50-audit" }`（就是原来的运行目录）

| 字段 | 要求 |
|---|---|
| `findingIds` | 可选。要修复的问题 id（这次运行的 `report.json` 里的 id），不能为空数组、不能重复；可以包含 `degrade` 问题。不传时修复所有 `block` 问题 |
| `rerun` | 可选，默认 `false`。`true` = 修复后用同一个任务在修复副本（`/<站点>/patched/`）上重跑 |

- 返回之前原运行的 `progress.json` 已经改成 `state: "fixing"`（`timeline` 保留审计时的步骤），前端不会先读到旧的 `done`。
- 进度写在**原运行目录**：`fixing` →（`rerun: true` 时）`rerunning` → `done`，出错时 `failed`。
- 进入 `rerunning` 时写入 `rerunDir`（复测运行的目录名，和 `runDir` 一样只是名字）。**复测目录和它的第一版 `progress.json`（`running`，空 timeline）在写出 `rerunDir` 之前就已经存在**，前端马上切过去读不会 404；复测自己的进度格式和 §5 完全相同。
- 原运行的 `report.json` 会被重写：修复完成时写入 `fixes`、`findings[].fix`、`fixPolicy`（`rerun` 此时为 `null`），复测完成时再写入 `rerun`（`rerun.runDir` 是 `runs/<复测目录名>`，相对仓库根目录）。先写完 `report.json` 再写 `done`。
- 每次修复都从原站点重新复制一份副本，所以之前修复留下的 `findings[].fix` 会被清空，只保留这一次修复的问题。
- 复测是否使用 judge 跟原运行一致（`meta.judge`）；复测总是由 planner 决定按键，不使用按键脚本。
- 修复和复测都在子进程里执行（`node cli.mjs fix … --progress`），输出追加到原运行目录的 `cli.log`。子进程崩溃或被杀时，服务器把原运行和复测运行都补写成 `failed`（`error` 形如 "The fix stopped unexpectedly: …" / "The rerun stopped unexpectedly: …"）。
- 和审计共用"同一时间只有一个运行"的限制：修复或复测进行中再启动审计或修复，都返回 `409 run_in_progress`。
- 修复需要调用模型（fixer），复测不传脚本时也需要（planner）；整个流程在 testpage 上大约 1–2 分钟。

## 4. `GET /api/runs`：运行列表

```
GET /api/runs
```

→ `200`

```json
{
  "runs": [
    { "runDir": "2026-09-27T03-10-02-audit", "url": "http://localhost:8080/shop/original/", "goal": "Buy the canvas tote bag",
      "generatedAt": null, "screenReaderUserCanComplete": null, "state": "running", "progress": "ok" },
    { "runDir": "real/2026-09-27T01-02-03-audit", "url": "https://…", "goal": "…",
      "generatedAt": "2026-09-27T01:05:40.000Z", "screenReaderUserCanComplete": false, "state": "done", "progress": "missing" }
  ],
  "skipped": 1,
  "skippedReasons": { "report_invalid": 1 }
}
```

| 字段 | 说明 |
|---|---|
| `runDir` | 运行目录名，报告在 `/runs/<runDir>/report.json`。`runs/real/` 下的真实网站运行带 `real/` 前缀（它们不能修复，所以不会用在 `/api/runs/<runDir>/fix` 里） |
| `url` / `goal` | 有有效的 `report.json` 时取 `meta.url` / `meta.goal`（`goal` 一定是字符串）；运行中取 `progress.json` 的 `url` / `goal`，还不知道时为 `null` |
| `generatedAt` | `report.json` 的 `meta.generatedAt`（字符串或 `null`）；还没有报告时为 `null`。修复后报告会重新生成，这个时间会更新 |
| `screenReaderUserCanComplete` | `report.json` 的结论一：`true` / `false`，或者 `null`。还没有报告时（运行中、分析中、没跑完就失败）为 `null`，不是 `false`；**有报告也可能是 `null`**：无法判断（报告里有 `verdicts.inconclusiveReason`，例如 `missing_test_data`），这时 `state` 是 `done` 等已完成的状态，要显示"无法判断"，不能显示成"不能完成" |
| `state` | 有能读的 `progress.json` 就取它的 `state`（`waiting_for_user` / `planning_task` / `running` / `analyzing` / `fixing` / `rerunning` / `done` / `failed`，见 §5）。已经有报告、正在修复的运行是 `fixing` 或 `rerunning`，结论仍是审计的结论。有报告但没有 `progress.json` 的旧运行（命令行不带 `--progress` 跑的）是 `done`；有报告但 `progress.json` 损坏（不是 JSON、不是对象、`state` 不是上面这些值，或者 `url` / `goal` 不是字符串或 `null`）是 **`unknown`**：结论照常显示，但不知道现在是否还在修复。`unknown` 只出现在列表里，progress.json 里永远不会写它 |
| `progress` | `progress.json` 的情况：`ok`（能读，`state` 取自它）/ `missing`（没有这个文件，`state` 是 `done`）/ `corrupt`（损坏，`state` 是 `unknown`）。没有报告的条目一定是 `ok` |
| `skipped` | `runs/` 和 `runs/real/` 下**没有列出的目录**个数（原因见 `skippedReasons`）。这些目录不出现在 `runs` 里，也不会让接口报错 |
| `skippedReasons` | 按原因统计的 `skipped`，只列出现过的原因，没有跳过时是 `{}`，各项之和等于 `skipped`。原因：`report_invalid`（有 `report.json`，但不是 JSON，或者 `meta.goal` 不是字符串、`verdicts.screenReaderUserCanComplete` 不是布尔值（`null` 只在同时有字符串 `inconclusiveReason` 时有效）、`meta.generatedAt` 不是字符串或 `null`、`meta.url` 不是字符串或 `null`。**一律不做类型转换**，即使同时有正常的 progress.json 也不列出）；`done_without_report`（progress 是 `done` 但没有 `report.json`，不应该发生）；`progress_corrupt`（没有报告，progress.json 也损坏）；`no_report_or_progress`（两个文件都没有，例如中途被杀、没开 `--progress` 的命令行运行）。以后可能增加新的原因 |

没有报告时：progress.json 的 `state` 是 `failed` 的照常列出（`generatedAt`、`screenReaderUserCanComplete` 为 `null`），运行中的各个状态也照常列出，`done` 计入 `skipped`。

- 最新的在前：目录名形如 `<开始时间 UTC>-<标签>[-<n>]`，先按开始时间倒序；同一秒开始的运行按后缀数字**按数值**倒序（`-10` 在 `-9` 前面，没有后缀的算 1，排在 `-2` 后面）；再相同时按目录名倒序；不是这种格式的目录名排在最后。`runs/` 和 `runs/real/` 的条目统一排序。
- 只返回列表需要的这几个字段，详细内容请读各自的 `report.json`。
- 没有 `runs/` 目录时返回 `{ "runs": [], "skipped": 0, "skippedReasons": {} }`。
- 命令行运行被强行中断（Ctrl-C、关掉终端）时，服务器不知道它已经停了，它的 `state` 可能一直是 `running`。从网页启动的运行不会这样（服务器会补写 `failed`）。

## 5. `progress.json`：运行进度

```
GET /runs/<runDir>/progress.json
```

完整定义：`docs/progress.schema.json`（其中 timeline 的每一步直接引用 `report.schema.json` 的 `timelineStep`，两者结构保证一致）。

```json
{
  "state": "running",
  "step": 7,
  "maxSteps": 40,
  "timeline": [ { "i": 0, "...": "和 report.json 的 timeline[] 完全相同的结构" } ],
  "rerunDir": null,
  "error": null,
  "url": "http://localhost:8080/testpage/original/",
  "goal": "Buy the canvas tote bag. Pay with card number 4242 4242.",
  "updatedAt": "2026-09-26T21:25:31.000Z"
}
```

| 字段 | 说明 |
|---|---|
| `state` | 审计：`running` → `analyzing` → `done`（不传 `goal` 时前面多一个 `planning_task`：正在确定任务，`goal` 还是 `null`。命令行跑的真实网站模式最前面多一个 `waiting_for_user`：正在连接 Chrome、等人处理验证码/登录并在终端按回车，此时还没有步骤，`url` 是 `null`；按回车后进入 `running`（或 `planning_task`））；修复（§3）：`fixing` →（复测时）`rerunning` → `done`。出错时 `failed` |
| `step` | 最后一步的编号（= `timeline` 最后一项的 `i`），还没有步骤时为 `null` |
| `maxSteps` | 步数上限（本地站点 40，真实网站模式 80）。请读这个字段，不要写死 |
| `timeline` | 目前为止的所有步骤。和 `report.json` 的 `timeline[]` 由同一个函数生成；运行中 `findingIds` 一律是 `[]`，最终的 id 以 `report.json` 为准 |
| `rerunDir` | 进入 `rerunning` 时写入复测运行的目录名，之后的 `done` / `failed` 保留它；此前为 `null`。复测目录在它写出之前就有 `progress.json` |
| `error` | `state: "failed"` 时的一句话原因，可以直接显示；其他时候为 `null` |
| `url` / `goal` | 审计的起始网址和任务（和 `report.json` 的 `meta.url` / `meta.goal` 相同），`report.json` 出来之前运行列表靠它们显示。还不知道时为 `null`（真实网站模式要等第 0 步之后才知道网址；`planning_task` 时 `goal` 是 `null`）；修复写的进度里一律是 `null`，请读 `report.json`。P2 之前写的 progress.json 里没有这两个字段 |
| `updatedAt` | 最后一次写入的时间 |

### 写入顺序保证

1. 每一步截图保存好之后才写入这一步（`screenshot` 指向的图片一定已经存在；截图失败时 `screenshot` 为 `null`）。
2. `progress.json` 和 `report.json` 都是原子写入（写到同目录的临时文件再重命名），不会读到写了一半的文件。
3. 先写完 `report.json`，再写 `state: "done"`。
4. 命令行 `audit --progress` 创建运行目录后马上写第一版（`step: null`、空 timeline、`goal`、`maxSteps`，还不知道的 `url` 为 `null`），在连接浏览器和等待按回车之前，所以列表里立刻能看到它。审计出错时写 `failed`；子进程崩溃或被杀时，由服务器补写 `failed`（`error` 形如 "The audit stopped unexpectedly: …"），保留已有的 timeline。
5. 按脚本运行时整个过程只有十秒左右，每秒读一次可能看不到 `analyzing`，直接从 `running` 跳到 `done`。

## 6. 错误格式

所有 `/api/*` 错误都是 `{ "error": { "code": "...", "message": "..." } }`，`message` 是一句英文，可以直接给用户看。

| 状态 | code | 场景 |
|---|---|---|
| 400 | `invalid_body` | 不是 JSON、`Content-Type` 不是 `application/json`、不是对象 |
| 400 | `body_too_large` | 请求体超过 16KB |
| 400 | `invalid_url` | 不是完整网址，或者不是 http/https |
| 400 | `real_site_cli_only` | 不是本服务器的网址（真实网站请用命令行） |
| 400 | `unknown_site` | 本服务器上没有这个站点 |
| 400 | `invalid_goal` | 任务为空或超过 500 字符 |
| 400 | `invalid_script` | `script` 不是 `eval/keys.*.json` 里已有的文件 |
| 400 | `invalid_generate` | `/api/tasks/suggest`：`generate` 不是 `true` / `false` |
| 404 | `run_not_found` | 路径里的 `runDir` 格式不对（必须匹配 `^[\w.-]+$`，不能以 `.` 开头）或不存在 |
| 404 | `not_found` | 没有这个接口 |
| 400 | `invalid_findings` | `findingIds` 不是非空数组、有重复，或者包含这次运行没有的 id |
| 400 | `invalid_rerun` | `rerun` 不是 `true` / `false` |
| 405 | `method_not_allowed` | 方法不对，例如 `DELETE /api/runs`、`GET …/fix`、`GET /api/tasks/suggest` |
| 409 | `run_not_finished` | 运行还没有 `report.json`（没跑完或失败了），没有东西可修 |
| 409 | `real_site_no_fix` | 真实网站只检测，不修复 |
| 409 | `not_fixable` | 这次运行没有可修复的站点源码（例如审计的是修复副本 `/…/patched/` 本身，请修复原来那次运行） |
| 409 | `nothing_to_fix` | 没传 `findingIds`，而这次运行没有 `block` 问题 |
| 409 | `run_in_progress` | 已有运行在进行中 |
| 502 | `suggest_failed` | `/api/tasks/suggest`：模型给不出合格的任务（请让用户自己描述任务） |
| 504 | `suggest_timeout` | `/api/tasks/suggest`：打开起始页 + 生成任务超过 90 秒 |
| 500 | `internal_error` | 其他错误 |

## 7. 验收（前端文档第 8 节）

```bash
curl -s -X POST localhost:8080/api/runs -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:8080/testpage/original/","goal":"Buy the canvas tote bag","script":"keys.testpage.json"}'
curl -s localhost:8080/runs/<runDir>/progress.json
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/runs/<runDir>/shots/0003.png
curl -s localhost:8080/runs/<runDir>/report.json
```

去掉 `script` 就是 planner + judge 的真实运行（需要 `.env` 里的模型 key，大约 30 秒）。`npm run smoke` 里的 `api` 用例会自动跑一遍带 `script` 的流程，并检查结果和直接运行一致。

计划 18（只填网址）：

```bash
curl -s -X POST localhost:8080/api/tasks/suggest -H 'Content-Type: application/json' -d '{"url":"http://localhost:8080/shop/original/"}'  # 预设任务
curl -s -X POST localhost:8080/api/tasks/suggest -H 'Content-Type: application/json' -d '{"url":"http://localhost:8080/shop/fixed/"}'     # 生成任务（需要模型 key）
curl -s -X POST localhost:8080/api/tasks/suggest -H 'Content-Type: application/json' -d '{"url":"http://localhost:8080/shop/original/","generate":true}'  # 有预设也生成
curl -s -X POST localhost:8080/api/runs -H 'Content-Type: application/json' -d '{"url":"http://localhost:8080/testpage/fixed/"}'        # planning_task → running → … → done
```

P1（修复 + 复测，需要模型 key）：

```bash
curl -s -X POST localhost:8080/api/runs/<runDir>/fix \
  -H 'Content-Type: application/json' -d '{"findingIds":["F1","F3"],"rerun":true}'
curl -s localhost:8080/runs/<runDir>/progress.json          # fixing → rerunning（带 rerunDir）→ done
curl -s localhost:8080/runs/<rerunDir>/progress.json        # 复测自己的实时进度，rerunDir 一出现就能读到
curl -s localhost:8080/runs/<runDir>/report.json            # fixes、findings[].fix、fixPolicy、rerun 都已填好
```

`findingIds` 要用这次运行的 `report.json` 里的 id：问题编号每次运行都会变，前端文档示例里的 `F2`、`F4` 只是示意。`rerun.closedLoop` 是否为 `true` 取决于修了哪些问题和复测时模型的操作：在 testpage 上用任务 "Buy the canvas tote bag. Pay with card number 4242 4242 4242 4242." 并修复"下单成功提示没有播报"和"付款后焦点丢失"两个问题时为 `true`（见计划 17 的"结果"一节）。
