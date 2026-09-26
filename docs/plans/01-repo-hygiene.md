# 01 — 仓库卫生与 smoke 测试

**目标：** 修掉两个会让后续计划互相踩脚的问题，并加一个会启动浏览器的回归测试。

**依赖：** 无　**预计：** 30 分钟

**先读：** `cli.mjs`、`src/audit.mjs`、`scripts/serve.mjs`、`eval/score.mjs`、`.gitignore`

**可以改：** `.gitignore`、`cli.mjs`、新建 `src/fix/commands.mjs`、新建 `scripts/smoke.mjs`、`package.json`（只加 `smoke` 脚本）
**不要改：** `src/contracts.mjs`、`src/runner/**`、`src/detect/**`

## 步骤（每项单独 commit）

1. **`.gitignore`**：把 `sites/shop/patched/` 改成 `sites/*/patched/`。现在在 testpage 上跑 `fix` 会生成 `sites/testpage/patched/`，会被误提交。
2. **拆出 fix/rerun**：把 `cli.mjs` 里 `fix` 和 `rerun` 两个分支的逻辑原样移到 `src/fix/commands.mjs`，导出 `runFix(args)` 和 `runRerun(args)`；`cli.mjs` 只负责解析参数和转发。**行为不变**，这一步只是为了让修复相关的改动有自己的文件。
3. **`npm run smoke`**：新建 `scripts/smoke.mjs`，依次：
   - 在子进程里启动 `scripts/serve.mjs`（端口可用 `PORT` 环境变量指定，默认 8080），等它能访问；
   - 分别对 `testpage/original` 和 `testpage/fixed` 跑 `audit --script eval/keys.testpage.json --no-judge`（直接 import `audit()`，不要再起 CLI 进程）；
   - 用 `eval/score.mjs` 的 `scoreRun` 断言：original 对 `eval/groundtruth/testpage.yaml` 检出 4/4、0 误报；fixed 对 `testpage-fixed.yaml` 0 误报；
   - 无论成功失败都关掉服务器；失败时退出码非 0，并打印哪一条没过。
   - `package.json` 加 `"smoke": "node scripts/smoke.mjs"`。

## 验收

```bash
npm test                      # 9/9 通过
npm run smoke                 # 打印两行结果，退出码 0
node cli.mjs fix --help 2>&1 | head -3   # CLI 仍能正常打印用法
git status --short            # 没有 runs/ 或 patched/ 出现
```

## 注意

- `scoreRun` 目前在 fixed 上用 `testpage.yaml` 会把所有障碍算作"漏检"，所以 fixed 一定要用 `testpage-fixed.yaml`。
- smoke 跑完会在 `runs/` 下留目录，已被 gitignore，不用清理。
