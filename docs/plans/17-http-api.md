# 17 — HTTP API 与实时进度（对齐前端的 BACKEND_CHANGES.md）

**目标：** 让前端能在网页上启动审计、实时看到每一步、触发修复和复测。`report.json` 仍然是唯一的最终结果；新增一个运行中的 `progress.json` 和几个 `/api` 接口，全部由现有的 `npm run serve`（8080）提供。

**依赖：** 04（fix 已能写回 report.json）　**预计：** P0 约 2 小时，P1 约 1 小时，P2 约 45 分钟
**分三个阶段做，每个阶段单独验收、单独 commit。** P0 完成后先通知前端，不必等 P1。

**先读：** 前端的需求文档（放在 `docs/frontend/BACKEND_CHANGES.md`）、`docs/REPORT_FORMAT.md`、`docs/report.schema.json`、`src/server.mjs`、`scripts/serve.mjs`、`src/audit.mjs`、`src/fix/commands.mjs`、`src/report/build.mjs`、`cli.mjs`、`AGENTS.md`（规则 13）

**可以改：** `src/server.mjs`、新建 `src/api/**`、`src/audit.mjs`、`src/report/**`、`src/fix/**`、`cli.mjs`、`scripts/serve.mjs`、`scripts/smoke.mjs`、`src/contracts.mjs`（只加常量和可选字段）、`test/`、`docs/API.md`（新建）、`docs/progress.schema.json`（新建）、`docs/report.schema.json`、`docs/REPORT_FORMAT.md`、`docs/report.example.json`、`fixtures/`
**不要改：** `viewer/`、`sites/shop/`、`docs/frontend/`；guard 的限制只能加强

## 和前端文档的差异（先定下来，写进 docs/API.md 并告诉前端）

| 前端文档 | 后端的决定 | 原因 |
|---|---|---|
| `maxSteps` 示例是 30 | 实际是 25（`contracts.mjs` 的 `MAX_STEPS`） | 以代码为准 |
| `mode` 由后端按网址判断 | P0 只接受本服务器提供的站点（`localhost` / `127.0.0.1` 且端口是本服务器），其他网址返回 `400`，code `real_site_cli_only` | 真实网站需要人先在 Chrome 里处理验证码，再在终端按回车，网页上做不到。真实网站的运行照常用命令行跑，结果同样出现在运行列表里 |
| `fix.constraints` 或一份文档 | 报告顶层新增 `fixPolicy`，分成两部分：`enforced`（代码强制执行的规则）和 `instructed`（只写在 prompt 里的要求） | 前端要求"必须和后端的真实行为一致"。代码强制的只有：不能删除可见文字和字符串、`old` 必须唯一匹配、只能改站点副本内的文件；"只改 ARIA 属性"只是 prompt 里的要求，不能说成强制规则 |
| 服务器监听所有网卡 | **改为只监听 127.0.0.1** | 加了能启动浏览器的接口之后，监听所有网卡意味着同一个 Wi-Fi 下的任何人都能让我们的电脑去访问任意网址。WSL 到 Windows 的 localhost 转发不受影响 |

## P0：启动运行 + progress.json

### 1. 运行在子进程里执行

- `POST /api/runs` 由 `src/api/` 处理：校验参数 → 生成 runDir 名 → **先创建目录并原子写入第一版 progress.json**（`state: "running"`、`timeline: []`）→ 用 `child_process.spawn` 启动 `node cli.mjs audit --url … --goal … --run-dir <runDir> --progress` → 立即返回 `202 { runDir }`。
- 子进程退出时，如果 progress.json 的 `state` 还不是 `done` 或 `failed`，由服务器写入 `failed` 和一句 `error`（进程崩溃时前端也不会一直卡在"运行中"）。
- 同一时间只允许一个运行（包括 P1 的修复和复测），已有运行时返回 `409`，code `run_in_progress`。
- 用子进程而不是在服务器进程里直接调用 `audit()`：浏览器或模型出问题时不会拖垮服务器，也方便处理崩溃。

### 2. audit() 和 CLI 的改动

- `audit()` 新增选项 `runDir`（使用已创建好的目录，不再自己生成）和 `onProgress(progress)` 回调。`audit()` 本身只调用回调，不关心进度写到哪里。
- 新建 `src/report/progress.mjs`：`createProgressWriter(runDir)`，负责组装 progress 对象并原子写入。CLI 的 `--progress` 参数把它接到 `onProgress`。
- 状态顺序：每完成一步（截图已落盘）写一次 `running` → 操作结束写 `analyzing` → **先原子写完 report.json，再写 `done`** → 出错写 `failed`。
- **progress 里的 timeline 每一步必须和 report.json 的 `timeline[]` 用同一个函数生成**：从 `build.mjs` 里抽出 `timelineEntry(step, findings)` 供两边共用，运行中 `findingIds` 为 `[]`。不要写第二份转换逻辑。

### 3. 原子写入

新建一个 `writeJsonAtomic(file, obj)`（写到同目录的 `.tmp` 再 `rename`），`progress.json` 和 `report.json` 都改用它。先写失败的测试。

### 4. 参数校验与错误格式

- `url`：必须是 `http://` 或 `https://`；P0 只接受本服务器的站点（见上表）。本地站点的 `meta.site` 由网址路径推出（例如 `/shop/original/` → `sites/shop/original`），这样之后才能修复。
- `goal`：非空，最长 500 字符。
- 请求体最大 16KB，必须是 JSON。
- 可选的 `script` 字段：只接受 `eval/` 下存在的 `keys.*.json` 文件名，用于 demo 时的确定性运行和测试。不在白名单里一律 `400`。
- 所有 `/api/*` 错误统一返回 `{ "error": { "code", "message" } }`，`message` 是一句能直接给用户看的话。状态码按前端文档第 4 节。
- 路径里的 `runDir` 必须匹配 `^[\w.-]+$` 且目录存在，否则 `404`。

### 5. 文档

- 新建 `docs/API.md`：三个接口、progress.json 的字段和状态、写入顺序保证、上面的差异表。
- 新建 `docs/progress.schema.json`，其中 timeline 的每一步直接 `$ref` 到 `report.schema.json` 的 `timelineStep`，保证两者结构一致。

### P0 验收

- 前端文档第 8 节 P0 的 curl 流程全部跑通（用 `script` 字段跑一次不需要模型的版本，再用 planner 跑一次）。
- 测试：用注入的假"启动子进程"函数测 API（参数校验、409、runDir 校验、崩溃后写 failed），不启动浏览器；progress.json 在每个状态下都符合 `progress.schema.json`；report.json 仍符合 schema。
- `npm run smoke` 增加一个用例：通过 `POST /api/runs`（带 `script`）跑 testpage，轮询到 `done`，检查 report.json 与命令行跑出来的结果一致。
- 服务器只监听 127.0.0.1：在测试里断言。

## P1：修复和复测

- `POST /api/runs/<runDir>/fix`，请求体 `{ findingIds?, rerun? }`。`findingIds` 不传时修复所有 `block` 问题；传了就只修这些（`runFix` 增加过滤参数）。`meta.mode` 为 `real` 时返回 `409`，code `real_site_no_fix`，message "真实网站只检测，不修复"。
- 同样用子进程执行 `node cli.mjs fix … --rerun --progress`，更新**原运行目录**的 progress：`fixing` → `rerunning`（写入 `rerunDir`）→ `done`。
- 复测运行在自己的目录里维护自己的 progress.json（和 P0 相同的格式）。复测目录要在写 `rerunDir` 之前创建好，并写好第一版 progress.json。
- 结果写回原运行的 report.json（`findings[].fix`、`fixes`、`rerun`、`fixPolicy`），`rerun.runDir` 保持相对路径。

### P1 验收

- 前端文档第 8 节 P1 的 curl 流程跑通，`rerun.closedLoop` 为 `true`。
- 测试覆盖：`findingIds` 过滤、real 模式返回 409、progress 状态顺序、复测目录的 progress 在 `rerunDir` 写出之前就存在。

## P2：列表接口和新增字段

- `GET /api/runs`：扫描 `runs/`，返回 `[{ runDir, url, goal, generatedAt, screenReaderUserCanComplete, state }]`，最新的在前；正在运行的条目从 progress.json 取 `state`，`screenReaderUserCanComplete` 为 `null`。跳过 `runs/real/` 以外无法解析的目录，不报错但计数记进响应的 `skipped`。
- `meta.startedAt`、`meta.finishedAt`、`meta.maxSteps`。
- `timeline[].t`：距离运行开始的毫秒数（由 trace 里的时间戳算出）。
- `fixPolicy`（见差异表）：规则文字放在 `src/fix/` 里的一个常量中，`apply.mjs` 的检查和报告里的说明都从它引用，避免两边说法不一致。
- `timeline[].shotSize` 属于计划 08，不在这里做。

### P2 验收

- 所有新增字段写进 schema（新字段在 schema 里都是可选的）、REPORT_FORMAT.md 和 report.example.json；report-schema 测试通过。
- `GET /api/runs` 有测试，包括正在运行的条目和损坏的目录。

## 注意

- 规则 13：每个阶段只要改了 report.json 的内容，就在同一个 commit 里同步 schema、REPORT_FORMAT.md 和 report.example.json。
- 前端的文档放在 `docs/frontend/`，属于前端，后端只读不改。和前端文档不一致的地方写进 `docs/API.md`，并在"结果"一节列出来，方便转告前端。
- 真实网站的运行照常只在本地，`runs/real/` 不提交。

## 结果

### P0（2026-09-27 完成；P2 未做，所以 README 里还没勾选）

**做了什么**
- `POST /api/runs`（`src/api/runs.mjs`）：校验 → `newRunDir` → 先原子写第一版 progress.json → 子进程 `node cli.mjs audit … --run-dir <dir> --site <site> --progress`（`src/api/spawn.mjs`，输出记到运行目录的 `cli.log`）→ `202 { runDir }`。一次只允许一个运行（`409 run_in_progress`）；子进程退出时如果 progress 不是 done/failed，服务器补写 `failed`（保留 timeline）。
- `audit()` 新增 `runDir`、`onProgress`（以及仅供测试的 `openSession` 注入）；状态顺序 running（每步之后）→ analyzing → done（report.json 写完之后）/ failed（一句话 error 后重新抛出）。
- `src/report/build.mjs` 抽出 `timelineEntry(step, findings)`，report.json 和 progress.json 共用；`writeReport` 改为原子写入（`src/report/atomic.mjs`）。`src/report/progress.mjs`：`createProgressWriter`、`readProgress`、`markFailedIfUnfinished`。
- 服务器只监听 127.0.0.1（`src/server.mjs` 的 `HOST` + `listen()`，`scripts/serve.mjs` 使用它）。
- `newRunDir` 同一秒内再建目录时加 `-2` 后缀，不再静默复用已有目录。
- 文档：新建 `docs/API.md`、`docs/progress.schema.json`（timeline 每一步 `$ref` 到 `report.schema.json#/$defs/timelineStep`）；`REPORT_FORMAT.md` §1 加了指向 API.md 的一句。report.json 的内容没有变化，所以 schema 和 example 不用改。

**验收**
- `npm test`：新增 `test/api.test.mjs`（注入假的"启动子进程"函数：参数校验、script 白名单、409 与释放、崩溃后 failed、done 不被覆盖、spawn 抛错 → 500、runDir 校验、监听 127.0.0.1）和 `test/progress.test.mjs`（原子写入、各状态符合 schema、用 fixture trace 和假 session 跑真实的 `audit()` 验证状态顺序、report.json 先于 done、两边 timeline 一致、失败写 failed）。
- `npm run smoke`：新增 `api` 用例，通过 `POST /api/runs`（带 `script`）跑 testpage，轮询到 `done`，每次轮询都校验 progress schema，检查截图可访问、report.json 符合 schema，并与直接运行的结果一致（比较结论、计数、findings、每一步的动作/焦点/听到/看到的文字；轮播噪音和 "appeared Nms after" 里的毫秒数每次不同，不参与比较）。
- 前端文档第 8 节 P0 的 curl 流程在临时端口上手动跑通：带 `script`（running → done，截图 200）；不带 `script`（planner + judge，running → analyzing → done，12 次模型调用，约 20 秒）；运行中再 POST 返回 409；运行中 `kill -9` 子进程 → `failed`，error 为 "The audit stopped unexpectedly: killed by SIGKILL"，之后可以再次启动。

**和前端文档不一致的地方（已写进 docs/API.md §1，需要转告前端）**
1. `maxSteps` 是 25，不是 30。
2. 网页上只能审计本服务器的站点（localhost/127.0.0.1 + 本服务器端口 + `sites/` 下存在的站点），其他网址 `400 real_site_cli_only`，本服务器上不存在的站点 `400 unknown_site`。前端不需要传 `mode`。
3. 服务器只监听 127.0.0.1：Vite 代理请指向 `localhost:8080` 或 `127.0.0.1:8080`。
4. 请求体多了可选的 `script`（`eval/keys.*.json` 的文件名，确定性运行，不调用模型），前端正常使用时不传。
5. 除了前端列的 400/404/409/500，还有 `405 method_not_allowed`；请求体超过 16KB 是 `400 body_too_large`。完整的 code 列表见 API.md §4。
6. 还没有任何步骤时 `progress.step` 是 `null`，不是数字。
7. 按脚本运行只要十秒左右，每秒轮询可能看不到 `analyzing`，会从 `running` 直接跳到 `done`。
8. 运行目录里多了一个 `cli.log`（后端排查用），前端不要读。
9. `fixPolicy`（替代 `fix.constraints`）、`GET /api/runs`、修复接口都还没有（P1/P2）。`GET /api/runs` 目前返回 405。

### P1（2026-09-27 完成，连同 P2 里的 `fixPolicy`）

**做了什么**
- `POST /api/runs/<runDir>/fix`（`src/api/runs.mjs`）：`{findingIds?, rerun?}` 校验 → 检查能否修复（`real_site_no_fix`、`not_fixable`、`nothing_to_fix`、`run_not_finished`）→ 和审计共用同一把锁 → **先**把原运行的 progress 写成 `fixing`（保留审计的 timeline，前端不会读到旧的 `done`）→ 子进程 `node cli.mjs fix --run <dir> --out <runsDir> --progress [--findings …] [--rerun] [--no-judge]` → `202 { runDir }`。子进程退出后，若原运行或复测运行的 progress 不是 done/failed，都补写 `failed`（"The fix/rerun stopped unexpectedly: …"）。`cli.log` 改为追加，修复的输出不会覆盖审计的。
- `src/fix/commands.mjs`：`runFixFlow`（CLI `fix` 的入口）按 fixing → rerunning → done / failed 报告进度；复测目录用 `newRunDir` 创建并写好第一版 progress（`running`、空 timeline）之后，才在原运行里写 `rerunDir`。`runFix` 支持 `--findings F2,F4`（未知 id 报错）；`runRerun` 接受 `runDir`/`onProgress`/`script`，复测网址由站点目录名推出（`/original/` → `/patched/`，推不出时要求 `--url`，不再静默重测原站点），复测的 `meta.site` 记为修复副本。
- `fixSite`：只修选中的问题；每次从原站点重新复制副本，所以先把所有 `findings[].fix` 清空（否则会显示上一次修复、但副本里已经不存在的 diff）。**另外修了一个危险的问题**：修复副本目录和站点目录重合（例如通过 API 审计 `/testpage/patched/` 再修复）时，`fixSite` 会先删掉副本目录，也就是站点源码本身。现在直接报错，API 返回 `409 not_fixable`。
- `fixPolicy`（原属 P2，修复接口会重写 report.json，放在这里更自然）：`src/fix/policy.mjs` 的 `FIX_POLICY` 是唯一出处。`enforced` 三条，`apply.mjs` 拒绝 edit 时的错误信息末尾引用对应规则原文；`instructed` 两条，测试保证它们逐字出现在 `prompts/fixer.md` 里（prompt 本身没改）。`buildReport` 在每份报告里写入 `fixPolicy`；schema（可选字段）、`REPORT_FORMAT.md`、`report.example.json` 同步（规则 13），测试保证 example 里的内容和常量一致。
- progress writer：`rerunDir` 一旦写入就保留到 done/failed（和 `markFailedIfUnfinished` 的行为一致），`progress.schema.json` 的描述同步。

**验收**
- `npm test` 87 项通过。新增测试：`findingIds` 过滤（API 参数和 `runFix --findings`）、旧的 fix 被清空、副本目录与站点重合时拒绝、real 模式 409 及其他 409/400、审计和修复共用锁、状态顺序 fixing → rerunning → done（以及不复测时 fixing → done）、**写出 `rerunDir` 那一刻复测目录的 progress 已经存在且是 running**、复测失败时两边都是 failed、子进程被杀时两边都补写 failed、`fixPolicy` 与 apply.mjs 的错误信息和 prompt 一致。测试里的问题 id 一律按 detector + barrierId 查找，不写死 F 编号（fixture 重新生成后编号会变）。
- `npm run smoke` 全部通过（修复需要模型，所以 smoke 里没有修复用例）。
- rebase 到队友的计划 08 提交（`maxSteps` 按模式、`shotSize`、真实网站接管）之后，没有冲突，测试和 smoke 都通过。
- 前端文档第 8 节 P1 的 curl 流程在临时端口 8095 上手动跑通（运行目录都在本地 `runs/`，未提交）：
  1. 任务用前端文档的 "Buy the canvas tote bag. Pay with card number 4242 4242."，`{"findingIds":["F2","F4"],"rerun":true}`：202；运行中再 POST 返回 409；progress 依次 `fixing` → `rerunning`（带 `rerunDir`，复测目录的 progress 马上能读到，step 从 null 递增）→ `done`；report.json 里 `fixes`（两条都应用成功）、`findings[].fix`、`fixPolicy`、`rerun` 都有值。**但 `rerun.closedLoop` 为 `false`**，原因见下面的问题 1。
  2. 任务用 "Buy the canvas tote bag. Pay with card number 4242 4242 4242 4242."（和 `fixtures/testpage-fixloop` 相同）：这次 judge 把"下单成功提示没有播报"判成 degrade，没有 block 问题，所以 `{"rerun":true}` 正确返回 `409 nothing_to_fix`；改用 `{"findingIds":["F1","F3"],"rerun":true}`（提示没有播报 + 付款后焦点丢失）后 fixing → rerunning → done，**`rerun.closedLoop: true`**，`after.outcome: "done"`，`introduced: []`。
  3. 复测进行中 `kill -9` 修复子进程：原运行 `failed`，error "The fix stopped unexpectedly: killed by SIGKILL"，`rerunDir` 保留；复测运行 `failed`，error "The rerun stopped unexpectedly: killed by SIGKILL"；锁已释放，没有残留的浏览器进程。

**和前端文档不一致的地方（已写进 docs/API.md §1，需要转告前端）**
1. 所有错误 `message` 都是英文（包括 `real_site_no_fix` 的 "Real websites are only audited, not fixed."，计划里写的是中文"真实网站只检测，不修复"）。需要中文时按 `code` 翻译。
2. 新增错误码：`400 invalid_findings` / `invalid_rerun`，`409 not_fixable` / `nothing_to_fix` / `run_not_finished`。没有 `block` 问题又不传 `findingIds` 时是 `409 nothing_to_fix`。
3. `rerunDir` 进入 `rerunning` 之后，在 `done` / `failed` 里也保留（前端文档说其他时候为 null）。
4. `findingIds` 可以包含 `degrade` 问题；前端文档示例里的 `F2`、`F4` 只是示意，编号每次运行都不同。
5. 复测是否用 judge 跟原运行一致；复测总是由 planner 操作。
6. 报告顶层新增 `fixPolicy`（代替 `fix.constraints`），旧报告没有这个字段。

**问题 1（未处理，属于计划 03 的 planner prompt，之后单独做）：复测时模型输入了任务里没有的完整卡号**

任务是 "Buy the canvas tote bag. Pay with card number 4242 4242."（前端文档第 8 节的原话，8 位的卡号故意是无效的，用来触发"卡号无效"的错误）。

证据（`runs/2026-09-27T02-51-18-rerun/trace.jsonl`，本地运行，未提交）：
- `meta.json` 的 goal 就是上面这句，和原运行完全相同。
- 第 6 步：`{"kind":"type","text":"4242 4242 4242 4242","reason":"Typing the card number into the focused Card number field"}`，之后 `focusAfter.value` 是 `"4242 4242 4242 4242"`。这是**第一次**输入卡号，发生在任何错误提示之前，不是听到"卡号无效"后自己改的；`reason` 也没有提到改了卡号。
- 同一任务的原运行（`runs/2026-09-27T02-50-50-audit`）第 6 步输入的是 `"4242 4242"`（`replace: true`）。
- 复测的 `stats` 是 `{calls: 26, llmAttempts: 26}`，没有 `cacheHits`，所以是模型当场的回答，不是缓存里别的任务（例如 fixloop 用的 16 位卡号任务）的答案。另外，原运行有 11 次 `cacheHits`（重放了之前验证 P0 时同一任务的回答），它不能当作独立的第二次采样。
- 后果：有效卡号让付款成功、弹窗关闭，但"Order confirmed"提示没有播报（这次没选修复它），焦点落到 body（第 8 步）；模型之后在 Card number 和 Pay 之间来回 Tab / Shift+Tab，直到 25 步用完，第 25 步 stuck。复测判定 `unexplainedStuck: true`，`closedLoop: false`。所以这次 `closedLoop: false` 不是修复或 API 的问题，而是复测时 planner 没有按任务给的卡号操作，结果测的是另一条路径。
- 影响：同一个任务修复前后走的路径不同，前后对比就不可靠。之后在计划 03 的范围里处理（例如要求 planner 逐字使用任务里给出的输入值）。这次没有改 planner 的 prompt。

### P2（2026-09-27 完成；`fixPolicy` 已在 P1 做完。P0、P1、P2 都已完成，README 里勾选）

**做了什么**
- `GET /api/runs`（新建 `src/api/list.mjs`，`src/api/runs.mjs` 只加了路由）：扫描 `runs/` 和 `runs/real/`，返回 `{ runs: [{ runDir, url, goal, generatedAt, screenReaderUserCanComplete, state }], skipped }`，按目录名倒序（目录名以 UTC 开始时间开头）。每项只有这六个字段，不返回整份报告。
  - 有能解析的 `report.json`：字段取自报告；`state` 取 progress.json（例如正在修复的运行是 `fixing`，结论仍是审计的），没有 progress.json 的旧运行是 `done`。
  - 没有 `report.json`、有 progress.json（运行中、分析中、没跑完就失败）：`state` 取 progress，`generatedAt`、`screenReaderUserCanComplete` 为 `null`，`url` / `goal` 取 progress 里新增的同名字段。
  - 两个文件都读不出来，或者 `report.json` 损坏（不会因为有 progress 就当成"运行中"）：不列出，计入 `skipped`，接口不报错。`runs/` 不存在时返回空列表。
  - `runs/real/` 下的运行 `runDir` 带 `real/` 前缀（`/runs/real/<名字>/report.json` 能直接访问）；`real` 目录本身不算运行。
- progress.json 新增可选的 `url`、`goal`：`audit()` 的每次 `onProgress` 都带上（真实网站模式第 0 步之后才有网址），API 启动审计时的第一版也写入；写入器和 `markFailedIfUnfinished` 都会保留它们。修复写的进度里是 `null`（那时已经有 report.json）。`progress.schema.json` 同步（可选字段）。
- report.json：`meta.startedAt`（`audit()` 开始时）、`meta.finishedAt`（分析结束、写报告之前）、`meta.maxSteps`（本地 25 / 真实 80）；`replay` 没有自己的运行，不写这三个字段。修复后重新生成的报告沿用审计的 meta，所以保留审计的时间。`timeline[].t`：`timelineEntry` 多一个参数 `t0`（第 0 步的时间戳），`t = step.t - t0`，缺时间戳时为 `null`；report.json 和 progress.json 仍用同一个函数。
- 规则 13：`report.schema.json`（四个新字段都可选）、`REPORT_FORMAT.md`（meta 表、timeline 表、§1 里"没有列表接口"那句）、`report.example.json`（meta 三个字段和每一步的 `t`）同步。`docs/API.md` 新增 §4 列表接口（原 §4–§6 顺延为 §5–§7），progress 字段表加 `url` / `goal`，差异表加两行，405 的例子改掉。
- 没有改 `src/fix/`、judge、噪音常量、`viewer/`、`sites/shop/`、`docs/frontend/`。

**验收**
- `npm test` 100 项通过。新增测试（先确认失败再实现）：`GET /api/runs` 覆盖已完成（无 progress）、修复中、运行中、`runs/real/` 下的运行、损坏的 report.json、空目录、坏掉的真实网站目录、普通文件、只有 failed progress 的运行、`runs/` 不存在；检查每项只有六个字段、排序、`skipped` 计数、real 运行的报告能通过 `/runs/real/…` 访问。`audit()` 的 `startedAt ≤ finishedAt ≤ generatedAt`、`maxSteps`（本地和真实模式）、`timeline[].t`（第 0 步为 0，缺时间戳为 null）、progress 的 `url` / `goal` 在每个状态都符合 schema 并在 failed 里保留。
- `npm run smoke` 全部通过。`api` 用例的"与直接运行一致"比较忽略 `startedAt` / `finishedAt`（和 `generatedAt` 一样每次不同），另外检查 meta 的时间和 `maxSteps`、`timeline[].t` 从 0 递增、`GET /api/runs` 里这次运行是 `done` 且结论一致。
- 在临时端口上对本地真实的 `runs/`（212 个目录）调用 `GET /api/runs`：212 项，`skipped: 0`。
- 8080 上的 `npm run serve` 需要重启才有 `GET /api/runs`（旧进程返回 405）。

**和前端文档不一致的地方（已写进 docs/API.md §1 和 §4，需要转告前端）**
1. `GET /api/runs` 返回**对象** `{ runs: [...], skipped }`，不是数组；每项多一个 `state`。
2. 还没有报告的条目 `generatedAt`、`screenReaderUserCanComplete` 为 `null`（不是 `false`）；`url` / `goal` 也可能是 `null`（真实网站模式第 0 步之前、P2 之前写的 progress）。
3. 真实网站的运行也会列出，`runDir` 形如 `real/2026-…-audit`，里面有 `/`；它们不能修复，不要对它们调用修复接口（会返回 404）。
4. `meta.startedAt` / `finishedAt` / `maxSteps` 和 `timeline[].t` 在旧报告和 `replay` 生成的报告里没有；真实网站模式的 `startedAt` 包含人处理验证码的时间。
5. 用命令行跑、被 Ctrl-C 中断的运行，列表里可能一直是 `running`（没有服务器补写 `failed`）；网页启动的运行不会。
6. progress.json 新增 `url`、`goal`（修复写的进度里为 `null`）。

### 前端反馈：运行列表的三个问题（2026-09-27）

**做了什么**
- `src/api/list.mjs` 数据校验：报告字段严格按类型校验，不做类型转换——`meta.goal` 必须是字符串、`verdicts.screenReaderUserCanComplete` 必须是布尔值、`meta.generatedAt` 必须是字符串或 `null`（缺少也算无效），`meta.url` 必须是字符串或 `null`（可以缺少）；`report.json` 本身不是对象、`meta`/`verdicts` 不是对象也算无效。无效报告一律跳过，即使 progress.json 正常。progress.json 也校验：必须是对象、`state` 在 `PROGRESS_STATES` 里、`url`/`goal`（有的话）是字符串或 `null`。
  - 有效报告 + 没有 progress.json → `state: "done"`、`progress: "missing"`；有效报告 + progress.json 损坏或 `state` 不合法 → `state: "unknown"`、`progress: "corrupt"`；有效报告 + 正常 progress → 取其 `state`、`progress: "ok"`。
  - 没有报告：`done` → 跳过（`done_without_report`）；`failed` 和运行中的各状态 → 照常列出；progress 损坏 → 跳过（`progress_corrupt`）；两个都没有 → 跳过（`no_report_or_progress`）。
  - 响应保留 `skipped`，新增 `skippedReasons`（`{原因: 次数}`，只列出现过的原因，没有时 `{}`）。
- 排序：按目录名里的开始时间倒序；同一秒按后缀数字按数值倒序（`-10` 在 `-9` 前面，无后缀算 1）；再相同时按目录名倒序；不是这种格式的目录名排最后。`runs/` 和 `runs/real/` 统一排序。
- 初始进度：`src/report/progress.mjs` 导出 `PROGRESS_STATES`（新增 `waiting_for_user`），测试保证与 schema 的 enum 一致。`src/audit.mjs` 新增 `firstState()`，`audit()` 在 `openSession()` 之前总是先写一版（real 模式 `waiting_for_user`，否则 `running` / 无 goal 时 `planning_task`）；real 模式把 `waitForUser` 包一层，人按回车之后才写 `running`（或 `planning_task`）。`cli.mjs audit --progress` 创建运行目录后马上写第一版（`goal`、`maxSteps`，real 模式 `url` 为 `null`、`step: null`、空 timeline），在调用 `audit()` 之前。
- 文档：`docs/progress.schema.json`（enum 加 `waiting_for_user`，说明里写了列表才有的 `unknown`）、`docs/API.md`（开头说明、§1 差异表、§4 字段表/排序/示例、§5 state 和写入顺序）。report.json 没有变化，所以 report schema/REPORT_FORMAT/example 不用改。

**验收**
- 先写测试并确认失败，再实现。`npm test` 132 项全部通过。新增：
  - 报告字段类型错误的 9 种情况（goal 是数字/缺少、verdict 是字符串 `"false"`/`null`/缺少、generatedAt 是数字/缺少、meta 是数组、没有 verdicts）+ report.json 是 `[]` / `null` + 报告无效但 progress 是 running，全部跳过并计为 `report_invalid`；`generatedAt: null` 的报告有效。
  - 有效报告 + progress 缺失 / 不是 JSON / state 不合法 / state 是数字 / 是数组 / 正常的 `fixing`。
  - 没有报告：done（跳过）、failed（列出，字段完整）、waiting_for_user（列出）、progress 损坏 / state 不合法 / goal 类型错误（`progress_corrupt`）、空目录。
  - 排序：同一秒的无后缀、`-2`、`-3`（在 `runs/real/`）、`-9`、`-10`，以及前后一秒和 `runs/real/` 里更新的一条。
  - `audit()`：`openSession()` 被调用时 progress.json 已存在（local：running，带 goal/url/maxSteps）；real 模式打开会话时和等待按回车期间都是 `waiting_for_user`（有 goal 和没有 goal 两种），按回车后是 `running` / `planning_task`，之后不再出现 `waiting_for_user`。
  - CLI：`cli.mjs audit --mode real --progress` 连到一个接受连接但永不回应的假 CDP 端口（`openSession()` 永远不返回），progress.json 已经是 `waiting_for_user`、goal、`maxSteps: 80`、`url: null`、`step: null`，并符合 schema。
  - 原有测试的变化：`audit()` 的状态序列最前面多一个 `running`（`step: null`）；列表测试多了 `progress` 和 `skippedReasons`。
- `npm run smoke` 全部通过（包括 `api` 用例）。
- 对本地真实的 `runs/`（241 个目录）调用 `listRuns`：241 项，`skipped: 0`。

**需要告诉前端**
1. 列表每项新增 `progress`：`"ok"` / `"missing"` / `"corrupt"`。
2. `state` 新增两个值：`"unknown"`（有报告但 progress.json 损坏；结论照常显示，只是不知道是否还在修复；只出现在列表里）和 `"waiting_for_user"`（命令行跑的真实网站模式，正在连接 Chrome、等人处理验证码并按回车；这时没有步骤、`url` 是 `null`，progress.json 里也会出现）。请给这两个状态准备显示方式，遇到不认识的 state 也请按"未知"显示。
3. 响应新增 `skippedReasons`（`{ report_invalid, done_without_report, progress_corrupt, no_report_or_progress }` 中出现过的原因 → 次数），以后可能增加原因。`skipped` 不变，等于各项之和。
4. 有报告的条目 `screenReaderUserCanComplete` 一定是布尔值、`goal` 一定是字符串；类型不对的报告不再出现在列表里（计入 `report_invalid`）。
5. 排序改为按开始时间 + 后缀数字（`-10` 在 `-9` 前面），不再是纯字符串倒序。
6. 命令行 `audit --progress` 的运行一开始就会出现在列表里（之前要等第 0 步）。
