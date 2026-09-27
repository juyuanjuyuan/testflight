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

### P0（2026-09-27 完成；P1、P2 未做，所以 README 里还没勾选）

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
