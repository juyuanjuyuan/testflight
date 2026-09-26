# 02 — Sciforium 连通性测试

**目标：** 在写任何 prompt 之前，先确认两个模型的延迟、JSON 输出稳定性和是否支持图片，据此配置 `.env`。

**依赖：** 无（需要队伍的 Sciforium key 和两个模型字符串）　**预计：** 30 分钟

**先读：** `src/agent/llm.mjs`、`.env.example`、Test Flight Builder Guide 的 Inference 一节

**可以改：** 新建 `scripts/smoke-llm.mjs`；`src/agent/llm.mjs`（只在发现兼容性问题时）
**不要改：** 其他文件；**不要把 key 写进任何文件或日志**

## 步骤

1. `cp .env.example .env`，填 `SCIFORIUM_API_KEY`、`MODEL_PLANNER`（DeepSeek）、`MODEL_JUDGE`（GLM）。模型字符串必须和发下来的完全一致。
2. 先用 guide 里的 curl 各测一次，确认 key 和模型字符串没问题（404 → base URL 应该停在 `/v1`；model not found → 字符串不对）。
3. 写 `scripts/smoke-llm.mjs`：对两个模型各调用 10 次 `chatJSON`（设 `LLM_CACHE=off`），prompt 要求返回形如 planner Action 的 JSON。输出每个模型的：延迟中位数、p90、JSON 解析失败次数、超时次数。
4. 再测一次图片输入：给 DeepSeek 发一张 `fixtures/testpage-original/shots/0001.png`（base64，OpenAI 的 `image_url` 格式），问图里按钮上是什么。记录是否支持。
5. 把结论写进本文件末尾的"结果"一节并 commit。

## 验收

- `node scripts/smoke-llm.mjs` 打印一张小表，两个模型都有数据。
- 本文件"结果"一节填好：延迟、失败率、图片是否支持、最终 `.env` 用哪个模型做 planner/judge。

## 注意

- 如果 JSON 失败率高：先看原始输出长什么样（是否带解释文字、是否有 `<think>` 之类的内容），在 `parseJSON` 里做兼容，不要换成 `response_format`。
- 如果 planner 延迟中位数超过 5 秒：25 步的任务会超过 2 分钟，demo 必须用缓存回放（见 12）。

## 结果

2026-09-26 跑 `LLM_CACHE=off node scripts/smoke-llm.mjs`（N=10，prompt 为真实 planner prompt + 由 `fixtures/testpage-original/trace.jsonl` 前缀构造的 observation，每次调用只路由到一个模型，不走跨模型回退）。

**模型字符串必须带 deployment 前缀。** Sciforium 已不再接受裸模型名（`deepseek-ai/DeepSeek-V4.1-Flash` → `400 Invalid model deployment target`），
必须写成 `/deployments/<ID>/<org>/<model>`，放在请求的 `model` 字段里，base URL 仍停在 `/v1`。**每个模型的 `<ID>` 不同**，要从发下来的配置里拿，
猜 `serverless` 不行（404）。OpenAI SDK 的报错只显示 `message`，真正的原因在响应体的 `details` 字段里，排查时用 curl/fetch 看原始响应。
`llm.mjs` 无需修改；`.env.example` 注释已写明。

| 角色 | 模型 | 延迟中位数 | p90 | 合法 Action | JSON 解析失败 | 超时 | 内部重试 |
|---|---|---|---|---|---|---|---|
| planner | DeepSeek V4.1 Flash | 2101 ms | 3560 ms | 10/10 | 0 | 0 | 0 |
| judge | GLM 5.3 | 待拿到 deployment ID 后补测 | | | | | |

- **JSON 稳定性：** 10/10 直接可解析且通过 `validateAction`，`parseJSON` 不需要兼容处理。
- **延迟：** 中位数约 2.1 s，低于 5 s 的红线；25 步约 1 分钟，demo 仍建议用缓存回放（12），但不是必须。
- **图片输入：** DeepSeek V4.1 Flash 支持 OpenAI `image_url`（base64 data URL）格式。对 `shots/0001.png` 能准确读出店名、价格、促销文案（不带图时返回空，确认不是猜的），约 0.8–1 s。
  注意：纯图标按钮 🛒 被它描述为 "Add to Cart"（按语义而非字面），13 做视觉检查时要考虑这一点。
- **最终 `.env`：** `MODEL_PLANNER` = DeepSeek V4.1 Flash（带 deployment 前缀）。`MODEL_JUDGE` **暂时也用同一个 DeepSeek 字符串**：
  GLM 的 deployment ID 还没拿到（`/models` 列表里只有 `zai-org/GLM-5.3`/`GLM-5.2`，没有 `GLM-5.3-Flash`）。拿到后更新 `.env` 并重跑本脚本补上 GLM 一行
  （两个模型字符串相同时脚本会跳过 judge 行）。
- 计划外改动：按用户要求在 `.env.example` 里加了前缀说明的注释（该文件不在"可以改"列表中）。
