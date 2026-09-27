# 04 — 修复闭环（testpage）

**目标：** 在 testpage 上跑通"发现 → 生成修复 → 应用到副本 → 同一 goal 重跑 → 任务完成"，并让 viewer 能看到修复 diff。

**依赖：** 01（fix/rerun 已拆到 `src/fix/commands.mjs`）、03（rerun 需要 planner）　**预计：** 1 小时

**先读：** `docs/ARCHITECTURE.md` §8、`src/fix/*.mjs`、`src/agent/prompts/fixer.md`、`src/report/compare.mjs`、`src/report/build.mjs`

**可以改：** `src/fix/**`、`src/agent/prompts/fixer.md`、`src/report/compare.mjs`、`docs/report.schema.json`、`docs/REPORT_FORMAT.md`、`docs/report.example.json`
**不要改：** `src/fix/apply.mjs` 里的文案保护逻辑（只能加强，不能放宽）、`sites/testpage/original/`、`sites/testpage/fixed/`

## 步骤

1. 在 original 上跑一次带 judge 的 audit（goal 同 03），得到 `runs/<id>`。
2. `node cli.mjs fix --run runs/<id> --site sites/testpage/original`。检查 `sites/testpage/patched/` 和 `runs/<id>/fixes.json`：每条 block 问题是否 `applied ≥ 1`、有没有被保护规则拒绝的 edit。
3. **补功能**：`runFix` 结束后重新生成 `report.json`（用同目录下的 `trace.jsonl`、更新后的 `findings.json`、`axe.json`、`meta.json` 调 `buildReport` + `writeReport`），这样 findings 里带 `fix.edits`，viewer 才能显示 diff。report.json 里 `fixes` 和 `findings[].fix` 从此有值：同步更新 `docs/report.schema.json`、`REPORT_FORMAT.md` 和 `report.example.json`（新字段在 schema 里必须是可选的，`npm test` 的 `test/report-schema.test.mjs` 会检查）。
4. `node cli.mjs rerun --run runs/<id>`（URL 会自动把 `/original/` 换成 `/patched/`）。看输出里的 `closedLoop` 和每条问题的 resolved/persists/new。
5. 把 fixer 的 edits 和 `sites/testpage/fixed/index.html` 对照，不一致就调 `fixer.md`。

## 验收

- `report.rerun.closedLoop === true`：修复前读屏用户无法完成，修复后可以完成。
- 原来的 block 问题全部 `resolved`，没有 `new`。
- `runs/<id>/report.json` 的 findings 里至少一条带 `fix.edits`。
- `git status` 里没有 `sites/testpage/patched/`。

## 注意

- 修复后如果错误提示直接不出现了、但任务仍然失败，算**未解决**。保护规则已经禁止删文案，别绕过它。
- rerun 用的是 planner，结果有随机性：跑 2 次都通过才算过。

## 结果

2026-09-27，judge、fixer、planner 都用 DeepSeek（GLM 的 deployment ID 还没拿到）。goal 同 03：`Buy the canvas tote bag. Pay with card number 4242 4242 4242 4242.`

**本次按要求超出了"可以改"的范围：** 新增 `test/fix.test.mjs`、`fixtures/testpage-fixloop/`，修改 `test/report-schema.test.mjs`（把真实的修复闭环结果加进 schema 校验）。

### 运行

1. audit（带 judge，`--site sites/testpage/original`）→ `runs/2026-09-27T00-50-04-fixloop-original`：stuck，`screenReaderUserCanComplete: false`。1 条 block（F1 `unannounced` #toast，T2），2 条 degrade（F2 `weak-name` #add，F3 `focus-lost` #pay）。这次 planner 直接输入了 16 位卡号，没有触发 T3 的错误提示，也没去试 Escape，所以 T3、T4 没出现。planner 的 10 次决策是从 `.cache/` 回放的（`cacheHits: 10`），浏览器是真实运行的。
2. fix：F1 `applied 1`，没有被保护规则拒绝的 edit。edit 是给 `#toast` 加 `role="status" aria-live="polite" aria-atomic="true"`，与 `sites/testpage/fixed/` 的 `role="status"` 等价（多出的两个属性是 `status` 的默认值），所以 `fixer.md` 不用改。
3. rerun，3 次都 `LLM_CACHE=off`：

| 次 | rerun 目录 | outcome | SR 用户能完成 | 步数 | LLM 调用 / 用时 | closedLoop | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | `2026-09-27T00-52-46-rerun` | done | true | 9 | 9 / 11.6 s | true | F1 resolved，F2、F3 persists，无 new |
| 2 | `2026-09-27T00-53-05-rerun` | done | true | 9 | 9 / 15.7 s | true | 同上 |
| 3 | `2026-09-27T00-54-18-rerun` | done | true | 9 | 9 / 13.7 s | true | 同上 |

第 3 次是修了 `runDir` 之后跑的，结果存为 `fixtures/testpage-fixloop/`。3 次里 planner 都是按 Pay 后听到"Order confirmed"才报 done。F2、F3 是 degrade，fixer 只修 block，所以 persists 是预期的。

### 改了什么

- **`fix` 之后重新生成 report.json**（`commands.mjs` 的 `reportWithFixes`）：用 `trace.jsonl`、更新后的 `findings.json`、`axe.json`，加上原 report 的 `meta`（`meta.json` 里没有 `judge`）和 `stats`，调 `buildReport` + `writeReport`。`fixes` 和 `findings[].fix` 从此有值；`rerun` 重置为 null，因为补丁变了，旧的重跑结果作废。`replay` 生成的运行没有 `axe.json`，此时 axe 为 null，和原报告一致。
- **`findings[].fix.edits` 只列出真正应用了的 edit**：`applyEdits` 额外返回 `appliedEdits`（保护逻辑没动），一条都没应用时 `fix` 为 null，原因在 `fixes[].errors`。之前 `fix` 存的是 LLM 最后一次提出的全部 edit，被保护规则拒绝的也在里面，viewer 会把没生效的改动显示成 diff。
- **路径不再依赖 cwd**：`meta.site` 是相对仓库根目录的路径（如 `sites/testpage/original`），之前 `fixSite` 按 cwd 解析，从别的目录运行会失败。现在用 `ROOT` 解析，`--patched` 也一样。
- **`rerun.runDir` 改成相对仓库根目录**（`runs/<id>`）：之前是本机绝对路径，会把本机路径带进 report.json 和 fixture，和文档里的 `runs/<id>` 也不一致。`rerun` 命令现在输出完整的 `report.rerun`（包含 `runDir`）。
- **测试（先写的失败测试）**：`test/fix.test.mjs` 用假的 LLM client：从另一个 cwd 运行 `runFix`，report.json 带上 `fixes` 和 `fix`；只列出应用了的 edit；没应用成功的为 null；保留 meta 和 stats；原版站点不动；删掉可见文字的 edit 一律被拒绝。`test/report-schema.test.mjs` 新增：`fixtures/testpage-fixloop/report.json` 通过 schema 校验；fixture 里不含本机绝对路径，引用的截图都存在（这条在修 `runDir` 之前是失败的）；fixloop fixture 里有 `fixes`、`fix.edits` 和 `closedLoop: true`。
- **文档**：report.json 的字段没有增删，变的是取值：schema 里 `fixes`、`fix`、`runDir` 的说明，REPORT_FORMAT.md 的 fix/fixes/runDir 说明，新增 fixture 的介绍，删掉"fix 暂时不写回"那条已知情况。`report.example.json` 的 F2 修复加了一条被保护规则拒绝的 error，用来示范"`applied` 大于 0 时 `errors` 也可能不为空"。

### 给前端（不在本计划范围内，没改 viewer）

- `fixtures/testpage-fixloop/report.json` 是真实的修复闭环数据，可以直接用来开发修复 diff 和前后对比的展示。
- `rerun.runDir` 在 fixture 里指向没有提交的运行，链接会打不开。
