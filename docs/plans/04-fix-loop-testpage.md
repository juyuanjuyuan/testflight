# 04 — 修复闭环（testpage）

**目标：** 在 testpage 上跑通"发现 → 生成修复 → 应用到副本 → 同一 goal 重跑 → 任务完成"，并让 viewer 能看到修复 diff。

**依赖：** 01（fix/rerun 已拆到 `src/fix/commands.mjs`）、03（rerun 需要 planner）　**预计：** 1 小时

**先读：** `docs/ARCHITECTURE.md` §8、`src/fix/*.mjs`、`src/agent/prompts/fixer.md`、`src/report/compare.mjs`、`src/report/build.mjs`

**可以改：** `src/fix/**`、`src/agent/prompts/fixer.md`、`src/report/compare.mjs`
**不要改：** `src/fix/apply.mjs` 里的文案保护逻辑（只能加强，不能放宽）、`sites/testpage/original/`、`sites/testpage/fixed/`

## 步骤

1. 在 original 上跑一次带 judge 的 audit（goal 同 03），得到 `runs/<id>`。
2. `node cli.mjs fix --run runs/<id> --site sites/testpage/original`。检查 `sites/testpage/patched/` 和 `runs/<id>/fixes.json`：每条 block 问题是否 `applied ≥ 1`、有没有被保护规则拒绝的 edit。
3. **补功能**：`runFix` 结束后重新生成 `report.json`（用同目录下的 `trace.jsonl`、更新后的 `findings.json`、`axe.json`、`meta.json` 调 `buildReport` + `writeReport`），这样 findings 里带 `fix.edits`，viewer 才能显示 diff。
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
