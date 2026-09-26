# 08 — 真实网站模式与预跑

**目标：** 让工具接管一个人手动打开的 Chrome，在真实电商网站上检测（不修复、不付款），并在周六晚上预跑 3–5 个网站、缓存结果，供 demo 第二段使用。

**依赖：** 01、03（真实网站没法预录按键，必须有 planner）　**预计：** 1–1.5 小时

**先读：** `docs/ARCHITECTURE.md` §10–11、原《工程架构》文档的"真实网站模式"一节、`src/runner/session.mjs`、`src/runner/guard.mjs`、`src/audit.mjs`

**可以改：** `src/audit.mjs`、`src/runner/session.mjs`、`src/runner/guard.mjs`、`cli.mjs`、新建 `scripts/real-chrome.sh`
**不要改：** 放宽 `guard.mjs` 的任何限制

## 步骤

1. **暂停等人**：real 模式下，`start()` 之后打印"处理完验证码/cookie 弹窗后按回车开始"，等终端回车再进入 agent 循环（用 `node:readline`）。**cookie 弹窗不要替它关**：它本身就是测试对象。
2. **启动 Chrome**：写 `scripts/real-chrome.sh`，用单独的用户目录启动带远程调试的 Chrome：
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/a11y-real-profile
   ```
   在 WSL 里通过 WSLg 显示窗口；如果 WSL 里没装 Chrome，按脚本注释安装。
3. **连通测试**：`node cli.mjs audit --mode real --cdp http://localhost:9222 --goal "Search for a tote bag and add it to the cart"`，确认能接管已打开的标签页、按回车后开始、到结账页自动停止。
4. **验证安全限制**：确认 `guard.mjs` 会拒绝在卡号、CVV、密码框里输入，URL 或标题出现 checkout/payment 时自动结束。
5. **预跑**：挑 3–5 个公开电商网站（避开 Glasswing portfolio 公司），goal 只到"加入购物车"为止。结果统一放 `runs/real/`（已 gitignore），挑结果最清晰、流程最稳定的一个作为 demo 用，在本文件"结果"一节记下选了哪个、为什么（**不要写公司名**，用"候选 1/2/3"代替）。

## 验收

- 能完整接管、暂停、运行、在结账前停止。
- 至少一个真实网站跑出"加购成功但未播报"之类的清晰问题，且缓存了完整结果。
- repo 里没有任何真实网站的运行结果或公司名。

## 注意

- 如果 WSL 连不上 Windows 那边的 Chrome（WSL2 NAT 网络的问题），就直接在 WSL 里用 WSLg 启动 Chrome，不要折腾网络配置。
- 被反爬拦截时如实记录，换下一个网站。
