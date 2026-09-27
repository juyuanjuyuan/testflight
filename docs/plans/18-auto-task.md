# 18 — 自动生成任务（用户只填网址也能审计）

**目标：** `goal` 变为可选。用户不填时，系统先判断这个网站最关键的用户任务，再照常审计。同时提供一个"建议任务"接口，让前端可以先展示建议、由用户确认或修改。

**依赖：** 17（API 已完成）　**预计：** 1.5 小时

**先读：** `docs/API.md`、`docs/progress.schema.json`、`docs/REPORT_FORMAT.md`、`src/api/runs.mjs`、`src/audit.mjs`、`src/agent/planner.mjs`（尤其是"输入值必须出现在 goal 里"的检查）、`src/agent/llm.mjs`、`src/runner/observe.mjs`（`pageText`）、`eval/groundtruth/*.yaml`（demo 站点已有的任务）、`AGENTS.md`

**可以改：** 新建 `src/agent/tasker.mjs`、`src/agent/prompts/tasker.md`、新建 `config/test-data/*.json`、`src/api/**`、`src/audit.mjs`、`cli.mjs`、`src/report/progress.mjs`、`src/contracts.mjs`（只加常量）、`test/`、`docs/API.md`、`docs/progress.schema.json`、`docs/report.schema.json`、`docs/REPORT_FORMAT.md`、`docs/report.example.json`
**不要改：** `src/agent/prompts/planner.md` 和 planner 的输入值检查（只能加强）、`src/agent/judge.mjs` 和 judge prompt、`src/fix/`、`viewer/`、`sites/`、`docs/frontend/`

## 设计原则

1. **任务只写"做什么"，不写"怎么做"。** 可以是"Buy a canvas tote bag"，不能是"Click the cart button, then…"。否则等于把页面结构的线索透露给 planner，破坏信息隔离。
2. **测试数据由代码拼接，模型不写具体的值。** 模型只说明任务需要哪类数据（例如 `payment_card`、`email`），具体的值由代码从测试数据配置里取出并拼进 goal。这样 planner 的"只能输入 goal 里出现过的值"规则自然成立，任何环节都不会编造卡号。
3. **生成任务的模型只能看到读屏用户能读到的内容**：起始页的网址、标题和 AX 树文本（`pageText`），和 planner 在第 0 步能获得的信息一样。不传截图、不传 DOM。
4. **demo 站点优先用已有的任务。** `eval/groundtruth/*.yaml` 里已经有经过验证的任务（包括"第一张卡被拒"的设定），对这些站点直接返回它们，结果稳定、可复现；只有它们之外的网址才调用模型生成。
5. **记录任务从哪里来。** 报告里写明任务是用户填的、预设的还是 AI 生成的，以及理由。

## 测试数据配置

- `config/test-data/default.json`：通用的测试数据，例如成功的测试卡号 `4242 4242 4242 4242`、测试邮箱、测试姓名和地址。只用公开的测试值，不放任何真实信息。
- `config/test-data/<站点目录>.json`（例如 `shop.json`）：站点专用，覆盖默认值。假电商站的"先用会被拒的卡、再换成功的卡"写在这里。
- 每类数据配一句拼进 goal 的英文模板，例如 `payment_card` → `Pay with card 4242 4242 4242 4242.`。
- 真实网站模式下，**不拼接任何支付和个人数据**；任务也要求在付款之前结束（和 guard 的停止规则一致）。

## 实现

### 1. `src/agent/tasker.mjs`

- `suggestTasks({ url, title, pageText, mode, siteKey })`：
  - 如果 `siteKey` 对应的站点在 `eval/groundtruth/` 里有任务，返回这些任务，`source: "curated"`，不调用模型；
  - 否则调用模型（使用 judge 的模型路由），要求只返回 JSON：`{ "suggestions": [{ "goal", "reason", "needs": ["payment_card", …] }] }`，最多 3 条；
  - 代码对每条建议做检查：长度不超过 goal 的上限；不能包含操作步骤类的词（例如 click、tap、press、tab、scroll、button、link、menu、icon，写成常量列表）；不能包含任何数字串（值只能由代码拼接）；`needs` 里只能是已知的数据类别。不合格的建议丢弃，全部不合格时重试一次，仍然不合格就报错；
  - 按 `needs` 从测试数据配置里拼出最终的 goal，`source: "generated"`。
- prompt 放在 `src/agent/prompts/tasker.md`，写明上面的原则；真实网站模式下要求任务在付款前结束。

### 2. API

- `POST /api/tasks/suggest { url }`：同步返回 `200 { suggestions: [{ goal, source, reason, needs }] }`。网址检查和 `POST /api/runs` 相同（P0 仍然只接受本服务器的站点）。需要打开浏览器读取起始页时，设置超时（常量），超时返回 `504`，code `suggest_timeout`。
- `POST /api/runs`：`goal` 改为可选。
  - 不传时，progress 的第一个状态是新增的 `planning_task`，子进程先生成任务，把选中的 goal 写进 progress 的 `goal` 字段，再进入 `running`；
  - 生成失败时写 `failed`，`error` 说明原因（例如"Could not work out a task for this page. Please describe one."）。
- `planning_task` 是**新增的状态值**，需要同步更新 `docs/progress.schema.json` 和 `docs/API.md`，并在"结果"一节注明要通知前端（前端需要能显示这个状态）。

### 3. CLI

- `node cli.mjs suggest --url <url>`：打印建议任务，用于调试。
- `node cli.mjs audit --url <url>` 在不传 `--goal` 时自动生成任务（等同于 API 的行为）。

### 4. 报告

`meta` 新增可选字段：`goalSource`（`user` / `curated` / `generated`）、`goalReason`、`testDataProfile`（用了哪份测试数据配置）。按规则 13 同步 schema、REPORT_FORMAT.md 和 report.example.json。

## 测试

- tasker（用假的 LLM client，不启动浏览器）：
  - demo 站点直接返回预设任务，不调用模型；
  - 生成的建议里包含 click / button 等词、或包含数字时被丢弃；
  - 最终 goal 里的卡号等值来自测试数据配置，并且能通过 planner 的"输入值必须出现在 goal 里"检查；
  - 真实网站模式下 goal 不包含任何支付或个人数据。
- API：`/api/tasks/suggest` 的正常返回、网址不合格、超时；`POST /api/runs` 不带 goal 时 progress 依次为 `planning_task` → `running` → … → `done`，生成失败时为 `failed`。
- progress.json 在 `planning_task` 状态下符合 `progress.schema.json`。

## 验收

- `curl -X POST localhost:8080/api/tasks/suggest -d '{"url":"http://localhost:8080/shop/original/"}'` 返回预设任务。
- 用一个不在 `eval/groundtruth/` 里的本地站点（例如 `testpage/fixed`，如果它没有预设任务；否则临时用一个只在测试里使用的站点目录），调用建议接口，返回的是 AI 生成的任务，且不包含操作步骤、卡号来自配置。
- `POST /api/runs` 只传 `url`，能跑到 `done`，报告里 `meta.goalSource` 正确。
- `npm test`、`npm run smoke` 通过。

## 注意

- 自动生成的任务每次可能不同，会让 LLM 缓存失效。demo 主流程继续使用固定任务，自动生成作为"只需一个网址"的亮点单独演示一次。
- 这个计划改变了 `POST /api/runs` 的行为和 progress 的状态集合，完成后要通知前端。

## 结果

（完成后填写）
