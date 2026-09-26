# 03 — planner 在 testpage 上自主运行

**目标：** 不用预录按键，让 planner 自己在 testpage 上完成购买。这是评委第一眼看到的 AI 部分，也是 08 真实网站预跑的前提。

**依赖：** 02　**预计：** 1–1.5 小时　**关键路径：周六 18:00 前完成**

**先读：** `AGENTS.md`（信息隔离）、`docs/ARCHITECTURE.md` §4、`src/agent/observation.mjs`、`src/agent/planner.mjs`、`src/agent/prompts/planner.md`、`src/audit.mjs`、`sites/testpage/*/index.html`

**可以改：** `src/agent/planner.mjs`、`src/agent/prompts/planner.md`、`src/agent/observation.mjs`（不能破坏信息隔离测试）
**不要改：** `src/contracts.mjs`、`src/runner/**`、`src/detect/**`

## 步骤

1. `npm run serve`（另一个终端），然后：
   ```bash
   node cli.mjs audit --url http://localhost:8080/testpage/fixed/ \
     --goal "Buy the canvas tote bag. Pay with card number 4242 4242 4242 4242." --no-judge --label planner-fixed
   ```
   goal 里必须写卡号：planner 只能从 goal 拿到它。
2. 看终端每一步的 `reason` 和 `runs/<id>/trace.jsonl`。常见问题和对应改法：
   - 输出非法动作 → 改 prompt 里的格式说明，或在 `nextAction` 里把非法原因回传重试（已有框架）；
   - 在同一个元素上反复按 Enter → prompt 强调"按了没听到反馈，最多再试一次"；
   - 不知道什么时候算完成 → 修复版里"Order confirmed"在 `role=status` 里，会出现在 `heardThisStep`；
   - 在文本框里一直按 Tab 却不输入 → prompt 强调"焦点在 textbox 且目标需要填写时用 type"。
3. fixed 稳定成功后，对 original 跑同样的命令。预期：planner 可能靠猜按下 🛒，但付款后听不到确认（"Order confirmed"没有播报），应输出 stuck，或 `screenReaderUserCanComplete: false`。
4. 每个版本连续跑 3 次（`LLM_CACHE=off`），记录成功次数和总耗时，写进本文件"结果"一节。

## 验收

- fixed：3 次中至少 3 次在 25 步内 `outcome: done`。
- original：3 次都 `screenReaderUserCanComplete: false`。
- `npm test` 通过（信息隔离测试不能被改坏或删掉）。

## 注意

- **绝不能**为了让 planner 成功而把 `changes`、截图或 DOM 传给它。planner 在 original 上失败正是产品要证明的东西。
- 不要在 prompt 里写 testpage 的具体元素名（比如"找 Checkout 按钮"），否则换到假站和真实网站就失效。

## 结果

（完成后填写：每个版本的成功次数、平均步数、平均耗时）
