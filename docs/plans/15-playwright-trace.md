# 15 — Playwright Trace（开发调试用）

**目标：** 加一个 `--trace` 参数，录制一次运行的完整浏览器过程（操作时间线、每步 DOM 快照、截图、控制台日志），用 Playwright 自带的 Trace Viewer 回看。用来排查 planner 为什么卡住、某个检测为什么触发。它是开发工具，**不是**给评委看的界面（那是前端的 viewer）。

**依赖：** 01　**预计：** 30 分钟　**可以随时做**，不要和 06、07、16 同时进行（都改 `session.mjs`）

**先读：** `src/runner/session.mjs`、`src/audit.mjs`、`cli.mjs`、`docs/CODING_STANDARDS.md` §3–4

**可以改：** `src/runner/session.mjs`、`src/audit.mjs`、`cli.mjs`、`test/`、`README.md` 的 Running it 一节
**不要改：** `src/contracts.mjs` 的已有字段、`viewer/`、`sites/shop/`

## 步骤

1. `openSession()` 增加选项 `trace`（布尔）。为真时，在 local 模式下创建 context 后调用 `context.tracing.start({ screenshots: true, snapshots: true, sources: false })`；`close()` 时先 `tracing.stop({ path: <runDir>/trace.zip })` 再关浏览器。
2. real 模式（`connectOverCDP`）下也尝试开启；失败时**不要吞掉**，把原因记进运行结果（例如 `meta.traceError`），运行照常继续。
3. `audit()` 透传 `trace` 选项，`meta.json` 里记录 `trace: "trace.zip"` 或 `traceError`。CLI 增加 `--trace` 参数。
4. 测试：给 `openSession` 的 trace 开关写一个不启动浏览器的单元测试（用假的 context 对象，断言 start/stop 的调用顺序和输出路径）。
5. README 的 Running it 里加一行用法。

## 验收

```bash
node cli.mjs audit --url http://localhost:8080/testpage/original/ --goal "Buy the canvas tote bag" \
  --script eval/keys.testpage.json --no-judge --trace
ls runs/<id>/trace.zip
npx playwright show-trace runs/<id>/trace.zip     # 在 WSL 里需要 WSLg 弹出窗口
```

- 不加 `--trace` 时行为和耗时与之前一致，`npm run smoke` 通过。
- WSL 弹不出窗口时，也可以在 Windows 浏览器打开 https://trace.playwright.dev ，把 `trace.zip` 拖进去（在本地浏览器里解析，不上传）。
- `npm test` 通过。

## 注意

- `trace.zip` 在 `runs/` 下，已被 gitignore，不要提交。
- 真实网站的 trace 里包含该网站的页面快照，同样不能提交。
