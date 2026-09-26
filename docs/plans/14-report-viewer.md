# 14 — 报告 viewer

**目标：** 做 demo 的主画面：一个静态 `viewer/index.html`，读一份 `report.json`，把“屏幕上显示了什么”和“辅助技术传达了什么”并排展示。

**依赖：** 01　**预计：** 1.5 小时　**目标时间：周六 22:00**

**先读：** `viewer/README.md`（布局约定，以它为准）、`src/report/build.mjs`（report.json 的结构）、`fixtures/testpage-original/report.json`

**可以改：** `viewer/**`
**不要改：** `src/**`（report 缺字段就在本文件"结果"一节记下，交给对应计划处理，不要顺手改 `build.mjs`）

## 步骤

1. 按 `viewer/README.md` 的布局写 `viewer/index.html`（单文件，纯静态，不要构建步骤和外部请求：demo 要能断网运行）。通过 `?run=<目录>` 读取 `<目录>/report.json` 和 `<目录>/shots/`。
2. 开发时用 `fixtures/testpage-original/report.json`，再用 `fixtures/testpage-fixed/` 检查“能完成”状态下的显示。
3. 空值处理：`heard` 为空时显示 “(nothing)”；`counts.axeViolations === null` 时显示 “axe unavailable”，**绝不能显示成 0**；`screenshot` 为 null 时显示占位框；`fix` 或 `rerun` 为空时隐藏对应区域。
4. 有 `findings[].fix.edits` 时以 old/new 的 diff 形式展示（04 完成后才有真实数据，可以先手写一份测试用的 report 放在 `viewer/` 下）。

## 验收

```bash
npm run serve   # sites/ 加上只读的 /viewer、/runs、/fixtures，端口 8080
# 打开 http://localhost:8080/viewer/?run=/fixtures/testpage-original/
# 打开 http://localhost:8080/viewer/?run=/fixtures/testpage-fixed/
# 真实运行：http://localhost:8080/viewer/?run=/runs/<运行目录>/
```

- original：顶部显示读屏用户“不能完成”、block 数；左栏有每步按键和 reason，出问题的步骤标红；中栏截图上画出 `focusRect` 和 `seen[].rect`；右栏显示 `heard`。
- fixed：显示“能完成”，没有 findings。
- 浏览器控制台没有报错；断网状态下也能打开。

## 结果

完成于 2026-09-26。`viewer/index.html` 单文件、无外部请求；← → / j k 切换步骤，`#step=N` 可直接定位某一步。

**截图：** `viewer/screenshots/original-step2.png`（不能完成、step 2 听到 (nothing)、截图上有 focus/seen 框）、`fixed-step4.png`（能完成、画出 focus/seen 框）、`sample-fix-rerun.png`（fix diff + rerun + axe unavailable）。

**手写测试数据：** `viewer/sample/report.json`（`meta.note` 标明是手写的），覆盖 `fix.edits`、`rerun`、`fixes[].errors`、`axeViolations: null`、`screenshot: null`、`userImpact`。打开：http://localhost:8080/viewer/?run=/viewer/sample/。

**report / fixture 的缺口（交给对应计划，本计划没改 `src/`）：**
1. ~~`fixtures/testpage-original/report.json` 是旧版 build 生成的：`seen` 是字符串数组、没有 `focusRect`，所以 original 的截图上画不出框（fixed 的 fixture 是新格式，能画）。当前 `build.mjs` 输出是对的（replay 验证过）。需要重新跑 `node cli.mjs audit --url http://localhost:8080/testpage/original/ ... --no-judge` 并把 report.json + shots 覆盖到 fixture（replay 不行：会丢掉 axe 结果）。viewer 两种格式都兼容。~~ 已解决（2026-09-26）：用当前代码按 `eval/keys.testpage.json` 重跑并覆盖了 fixture，smoke 4/4、0 误报。
2. `viewer/README.md` 原来写 “`rerun.status` → passes after fix”，但 `rerun.status` 是逐条 finding 的数组；整体结论在 `rerun.after.screenReaderUserCanComplete` / `rerun.closedLoop`。viewer 按后者显示，README 已改。
3. `seen[].rect` / `focusRect` 是 1280×800 视口坐标；viewer 按截图原始尺寸缩放。如果以后截整页（fullPage）或 DPR≠1，框会错位，需要在 report 里带上截图的视口尺寸和滚动位置。
4. `userImpact` 在 judge 关闭时是空字符串，viewer 直接隐藏；demo 若想显示用户影响，需要开 judge 跑。
