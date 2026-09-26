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

（完成后填写）
