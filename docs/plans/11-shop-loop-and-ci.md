# 11 — 假站修复闭环与 CI

**目标：** demo 主线在假站上完整成立：发现 → 修复 → 重跑通过；CI 改为检查假站。

**依赖：** 04、05　**预计：** 1 小时

**先读：** `docs/plans/04-fix-loop-testpage.md` 的结果、`src/fix/**`、`.github/workflows/a11y-audit.yml`

**可以改：** `src/fix/**`、`src/agent/prompts/fixer.md`、`.github/workflows/a11y-audit.yml`
**不要改：** `sites/shop/original/`、`sites/shop/fixed/`

## 步骤

1. 在假站 original 主流程上跑带 judge 的 audit → `fix --site sites/shop/original` → `rerun`。
2. 对照 `sites/shop/fixed/` 检查 fixer 的每条 edit，方向不对就调 `fixer.md`（不要写死假站的具体元素）。
3. 连续跑 2 次都得到 `closedLoop: true` 才算通过。把最终那次的 run 目录名记在本文件"结果"一节，12 的 demo 回放会用它。
4. CI：把 workflow 里的 testpage 换成假站 fixed 的主流程（`--script eval/keys.shop.main.json --no-judge --fail-on block`），push 后确认 Actions 变绿。

## 验收

- 假站主流程 `closedLoop: true`，两次都成立。
- 原来的 block 问题全部 resolved，没有 new。
- GitHub Actions 在假站 fixed 上通过。

## 结果

（完成后填写：用于 demo 的 run 目录名、fixer 和人工修复版的差异）
