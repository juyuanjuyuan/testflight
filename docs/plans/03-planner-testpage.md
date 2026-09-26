# 03 — planner 在 testpage 上自主运行

**目标：** 不用预录按键，让 planner 自己在 testpage 上完成购买。这是评委第一眼看到的 AI 部分，也是 08 真实网站预跑的前提。

**依赖：** 02　**预计：** 1–1.5 小时　**关键路径：周六 18:00 前完成**

**先读：** `AGENTS.md`（信息隔离）、`docs/ARCHITECTURE.md` §4、`src/agent/observation.mjs`、`src/agent/planner.mjs`、`src/agent/prompts/planner.md`、`src/audit.mjs`、`sites/testpage/*/index.html`

**可以改：** `src/agent/planner.mjs`、`src/agent/prompts/planner.md`、`src/agent/observation.mjs`（不能破坏信息隔离测试）、`test/pipeline.test.mjs`（执行时补充：CODING_STANDARDS §6 要求修 bug 先加回归测试）
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

2026-09-26，DeepSeek 做 planner，`--no-judge`，`LLM_CACHE=off`，goal 为步骤 1 中的命令。耗时是整条命令的墙钟时间（含浏览器启动、axe）。

| 版本 | 次 | outcome | SR 用户能完成 | 步数 | 耗时 | LLM 调用 / 用时 |
|---|---|---|---|---|---|---|
| fixed | 1 | done | true | 8 | 18 s | 8 / 9.6 s |
| fixed | 2 | done | true | 8 | 16 s | 8 / 8.5 s |
| fixed | 3 | done | true | 8 | 80 s | 8 / 9.9 s |
| original | 1 | stuck | false | 11 | 26 s | 11 / 16.2 s |
| original | 2 | stuck | false | 10 | 25 s | 10 / 15.5 s |
| original | 3 | stuck | false | 10 | 24 s | 10 / 15.7 s |

- **fixed：** 3/3 次 done，平均 8 步，平均 38 s（不算第 3 次约 17 s）。第 3 次 LLM 用时正常，多出的约 60 s 在 LLM 之外（浏览器启动或关闭），没有复现，先记在这里。
- **original：** 3/3 次 `screenReaderUserCanComplete: false`，平均 10.3 步，约 25 s。3 次都靠猜按了 🛒（符合预期），然后 Checkout → 输入卡号 → Pay。Pay 后焦点落到 body，"Order confirmed"没有播报，于是报 stuck，理由是"按了 Pay 但没听到确认"。
- 注意：`--no-judge` 下 block 数是 0，original 的 false 来自 outcome=stuck，不是 block finding。

改了什么（都是通用规则，不含 testpage 元素名）：
1. **bug：** `type` 是追加输入（`keyboard.type`），planner 又听不到输入框里已有的内容，所以把卡号输了两遍，结果卡号无效，fixed 上失败。修复：`buildObservation` 新增 `focusValue`，内容是 planner 自己此前在当前焦点字段里输入的文字（从它自己的 action 推出，不读 `changes`，对应读屏在聚焦时读出的值）。先加了回归测试。prompt 说明 type 会追加，每个值只输一次。
2. original 最初在 🛒 没反馈后就报 stuck，到不了付款。改为：中间步骤同一控件最多按两次，之后继续往下走。
3. original 在 Pay 后焦点落到 body，又从头重做了一遍流程，把 25 步用完。改为：完成目标的最后一步没听到确认，直接报 stuck，不回头重做之前的步骤。
