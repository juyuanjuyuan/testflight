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
python3 -m http.server 8090   # 在仓库根目录；或者用任意静态服务器
# 打开 http://localhost:8090/viewer/index.html?run=../fixtures/testpage-original/
# 打开 http://localhost:8090/viewer/index.html?run=../fixtures/testpage-fixed/
```

- original：顶部显示读屏用户“不能完成”、block 数；左栏有每步按键和 reason，出问题的步骤标红；中栏截图上画出 `focusRect` 和 `seen[].rect`；右栏显示 `heard`。
- fixed：显示“能完成”，没有 findings。
- 浏览器控制台没有报错；断网状态下也能打开。

## 结果

（完成后填写：截图路径、report 中缺的字段）
