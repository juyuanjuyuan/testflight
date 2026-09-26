# 12 — demo 回放与演练

**目标：** 保证周日下午的 5 分钟 demo 在断网、模型挂掉的情况下也能完整跑完。

**依赖：** 以上全部（13 除外）　**预计：** 1 小时　**周日 12:30 前完成**

**先读：** Test Flight 方向文档的 "Demo 脚本" 和 "真实网站段的边界"、`src/agent/llm.mjs`（缓存机制）

**可以改：** 新建 `scripts/demo.sh`、`README.md`
**不要改：** 功能代码（12:30 之后只修 bug）

## 步骤

1. **确定 demo 电脑**，之后所有缓存都在这台上生成。
2. 在这台电脑上用 `LLM_CACHE=readwrite` 把 demo 要跑的全部内容完整跑一遍：假站主流程 audit、fix、rerun、评测表。
3. 写 `scripts/demo.sh`：设 `LLM_CACHE=readonly`，按 demo 顺序执行上述命令。readonly 下缓存未命中会直接报错，不会访问网络。
4. **断网测试**：关掉 Wi-Fi 跑 `scripts/demo.sh`，必须完整跑通（假站在 localhost，模型走缓存）。
5. 确认真实网站段用的是 08 缓存好的结果，准备好"这是今天早些时候的真实运行"的说法。
6. 补完 README 的所有 TODO：队名、队员、结果表、what's real vs mocked、prior work。
7. 按方向文档的时间分配完整演练两遍并计时。

## 验收

- 断网状态下 `scripts/demo.sh` 完整跑通。
- README 没有 TODO。
- 两遍演练都控制在规定时间内（先向 staff 确认每队展示时长）。
