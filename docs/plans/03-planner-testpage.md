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

### 补充（2026-09-26，第二个 commit）：可替换输入 + focusValue 改读 AX 树

本次按要求超出了上面"可以改"的范围：`src/contracts.mjs`、`src/runner/{act,observe,guard}.mjs`、`src/audit.mjs`、`scripts/smoke.mjs`、`eval/keys.testpage.replace.json`、`docs/ARCHITECTURE.md` §3。

1. **replace：** Action 的 `type` 新增可选 `replace: boolean`，`validateAction` 只在 type 上接受布尔值。`act.mjs` 在输入前先按 `ControlOrMeta+A`。guard 新增 `blockAction(action, focus)`，audit 的 real 模式改用它，所有 type（含 replace）遇到敏感输入框一律拒绝。prompt 新增通用规则：需要更正或换掉内容时用 `"replace":true`。终端日志里显示为 `type (replace)`。
2. **focusValue 改读 AX 树：** `observe.mjs` 把 AX 节点的 `value` 写进 FocusInfo（新增可选字段 `value`，没有 value 的节点，如按钮，不写这个字段）。`buildObservation` 的 `focusValue` 只取 `focusAfter.value`，删掉了之前的"planner 自己输入过什么"推断。smoke 验证了密码框的值被 Chrome 遮蔽为 `•••••••`。
3. **测试（先写的失败测试）：** `npm test` 新增 4 条（validateAction 的 replace、guard 的 replace、focusInfo 读 AX value、focusValue 只来自 AX value）。`npm run smoke` 新增 2 个用例：fixed 上用脚本先输短卡号、被拒后用 replace 换成 16 位并听到"Order confirmed"，每步 AX value 与预期一致；密码框 value 已记录且不含明文。

LLM 验收（`LLM_CACHE=off`，`--no-judge`，改 prompt 后三组都重跑）：

| 用例 | 次 | outcome | SR 用户能完成 | 步数 | 耗时 | LLM 调用 / 用时 |
|---|---|---|---|---|---|---|
| fixed，先短卡后 16 位¹ | 1 | done | true | 13 | 29 s | 13 / 18.8 s |
| 同上 | 2 | done | true | 14 | 36 s | 14 / 23.3 s |
| 同上 | 3 | done | true | 13 | 27 s | 13 / 15.1 s |
| fixed，原 goal | 1 | done | true | 8 | 44 s | 8 / 35.7 s |
| fixed，原 goal | 2 | done | true | 8 | 21 s | 8 / 13.3 s |
| fixed，原 goal | 3 | done | true | 8 | 15 s | 8 / 7.1 s |
| original，原 goal | 1 | stuck | false | 10 | 21 s | 10 / 11.9 s |
| original，原 goal | 2 | stuck | false | 10 | 42 s | 10 / 33.2 s |
| original，原 goal | 3 | stuck | false | 10 | 21 s | 10 / 11.7 s |

¹ goal：`Buy the canvas tote bag. First try card number 4242 4242. If that card is rejected, pay with card number 4242 4242 4242 4242.`
3 次都是：输入 `4242 4242` → Pay → 听到"Card number is invalid" → Shift+Tab 回到输入框 → `replace` 换成 16 位（AX value 正好是 `4242 4242 4242 4242`）→ Pay → 听到"Order confirmed"。其中 2 次在 replace 后又原样 replace 了一次（多 1 步，因为 replace 是幂等的，所以无害）。

### fixed 第 3 次运行 80 s 的原因

用 `runs/2026-09-26T23-11-55-accept-fixed-3/trace.jsonl` 的 `t` 算相邻步间隔：步骤 0→7 每步 1.0–2.8 s；**7→8 用了 64.9 s**。第 8 步就是 planner 判断"done"的那一次调用。整次运行记录的 LLM 总用时只有 9.9 s（`stats.ms`），因为 `llm.mjs` 只统计成功的那次尝试，超时和报错的尝试既不计时也不记录。planner 的超时是 20 s，每个模型重试 2 次后换备用模型。64.9 s ≈ 3 次 20 s 超时 + 1 次约 5 s 的成功调用，所以结论是：**Sciforium 上 DeepSeek 偶发超时，被静默重试掩盖**，不是浏览器的问题。第二轮验收里同样出现过（fixed 原 goal 第 1 次：第 5 步 29 s，`stats.ms` 35.7 s）。因为失败的尝试没有日志，没法逐次确认，这个结论是推断。
**后续建议**（`src/agent/llm.mjs` 不在本计划范围内）：把失败的尝试记进 `stats`（如 `stats.llmRetries`、`stats.llmErrors`），否则违反 CODING_STANDARDS §3 的"降级要写进输出"；也可以考虑把 planner 的超时从 20 s 降到 8–10 s，让重试更早发生。

### 补充（第三轮）：LLM 重试不再静默

- `chatJSON` 每次尝试都记进 `stats`：`llmAttempts`（尝试次数）、`llmFailures`（失败次数）、`llmTimeouts`（超时次数）、`llmFailedMs`（失败尝试耗费的时间）、`llmErrorTypes`（按类型计数：`timeout` / `http-<状态码>` / `connection` / `parse`）。原有的 `calls`/`ms` 仍只统计成功的调用。这些字段随 `stats` 写进 `report.json`，都是新增字段。
- 超时改为 `contracts.mjs` 里的 `LLM_TIMEOUT_MS`：planner 8 s，judge/fixer/vision 60 s。
- 回退的模型列表先去重：planner 和 judge 配同一个模型时，只在这个模型上试 2 次，而不是 4 次。之前最坏情况 4×20 s = 80 s，现在是 2×8 s = 16 s。
- `test/llm.test.mjs` 用假 client 测试（先写的失败测试）：超时和解析失败会被记录并分类，同一个模型不会重复尝试，各角色的超时值正确。实跑一次 fixed：`{"llmAttempts":8,"calls":8,"ms":8362}`（那次没有失败）。
