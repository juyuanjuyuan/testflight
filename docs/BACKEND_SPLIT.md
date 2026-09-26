# 后端双人并行开发分工

Sep 26, 2026 · Eddie Wu

## 总览

后端按"AI 做判断、规则做测量"切成两条线：A 负责 AI 闭环，B 负责测量与评测。两人之间唯一的接口是 `trace.jsonl` 和 `findings.json`，格式已在 `src/contracts.mjs` 冻结，所以谁都不用等谁。

前提：假电商站（`sites/shop`）和 viewer 由另外两位队友负责。如果不是，需要调整分工。架构细节见 repo 里的 `docs/ARCHITECTURE.md`。

## 分工

|  | A：AI 闭环 | B：测量与评测 |
| --- | --- | --- |
| 负责的目录 | `src/agent/**`、`src/fix/**`（含新建的 `src/fix/commands.mjs`）、`src/report/compare.mjs`、`prompts/`、`scripts/smoke-llm.mjs`、`scripts/demo.sh` | `src/runner/**`、`src/detect/**`、`eval/**`、`scripts/` 其余文件、`.github/`、`cli.mjs`、`src/audit.mjs`、`.gitignore` |
| 最终交付 | planner 能自主跑完任务；judge 能过滤噪音；fix → rerun 闭环成立 | 检测器补全；真实网站模式可用；评测结果表（含 judge 开/关消融） |
| 是否需要 Sciforium key | 需要，拿到 key 就开始 | B1–B3 不需要，用 `--script --no-judge` 能跑通；B4 最终评测表和 B6 需要，key 私下发给 B |
| 对方完成前怎么开发 | 用 `fixtures/` 里的 trace 和 testpage 的真实运行结果 | 用预录按键脚本，不依赖 planner |

`fix` 和 `rerun` 两个命令的处理逻辑由 B 在 B0 中移到 `src/fix/commands.mjs`，之后归 A；`cli.mjs` 只负责转发。除此之外 A 不改 `cli.mjs` 和 `src/audit.mjs`，需要时先说一声。

## A 的任务（按顺序）

按表中从上到下的顺序做。A3 要等假电商站做好才有噪音可调，所以排在 A4 第一轮之后。

| # | 任务 | 验收标准 |
| --- | --- | --- |
| A1 | 测 Sciforium（拿到 key 立刻做）：写 `scripts/smoke-llm.mjs`，两个模型各调用 10 次；测 DeepSeek 能否接收图片 | 输出延迟中位数和 p90、JSON 解析失败次数；据此确定 `.env` 里各角色用哪个模型 |
| A2 | **关键路径，18:00 前完成。** planner 在 testpage 上自主运行；goal 里写明卡号（planner 只能从 goal 拿到卡号） | fixed 版 25 步内输出 done；original 版输出 stuck，或结论为"读屏用户无法完成"。B 今晚预跑真实网站依赖它 |
| A4 第一轮 | 在 testpage 上跑通 fix → rerun 闭环：在 `src/fix/commands.mjs` 里让 `fix` 之后重新生成 `report.json`，viewer 才能看到修复 diff；把 fixer 输出和 `sites/testpage/fixed/` 对照 | `closedLoop: true`；`report.json` 里的 findings 带 `fix.edits`；修复方向与人工版一致 |
| A3 | 假电商站好了之后，调 judge 的 prompt | 假站和真实网站 trace 上的噪音被过滤。消融数字由 B4 的评测流水线统一产出，A 不再单独做 |
| A4 第二轮 | 在假电商站上再跑一遍 fix → rerun，对照 `sites/shop/fixed/` | 假站上 `closedLoop: true` |
| A5 | 写 `scripts/demo.sh`，在 `LLM_CACHE=readonly` 下完整回放 | 断网也能完整跑完 demo |
| A6 | （可选）视觉层检查：识别印在图片上的价格等关键文字 | 主线全部完成后才做 |

## B 的任务（按顺序）

| # | 任务 | 验收标准 |
| --- | --- | --- |
| B0 | **先做，约 30 分钟，做完 A 才能安全开工。** ① `.gitignore` 规则改成 `sites/*/patched/`；② 把 `fix`、`rerun` 的处理逻辑从 `cli.mjs` 移到 `src/fix/commands.mjs`；③ 加 `npm run smoke`：用预录按键跑一遍 testpage，断言检出 4/4 | 三项合进 main 后通知 A；之后 B 每次提 PR 前跑 `npm run smoke`（`npm test` 不启动浏览器，改坏 runner 也能通过） |
| B1 | 补全真实网站模式：`audit.mjs` 在 real 模式下还没有"暂停，等人处理完验证码后按回车再开始"，需要补上；在 WSL 里用 WSLg 启动 Chrome，验证 `connectOverCDP` 能连上 | 能接管人工打开的 Chrome，按回车后 agent 开始运行 |
| B2 | D6（仅鼠标可用）：planner 输出 stuck 时，扫描"可点击但无法获得焦点"的元素（带 onclick 的 div、cursor 为 pointer 的元素），写入 `unreachableClickables` | 只在 testpage 的 original 版加一个只能用鼠标点击的 div，`testpage.yaml` 加 T5，D6 能检出并补上测试；修复版保持 0 误报。重新生成 fixture 后通知 A（步骤编号会变） |
| B3 | D5（焦点可见性）：接入 keyboard-a11y-tester，或做简化版（对比获得焦点前后的截图像素差异），写入 `step.focusVisible` | 焦点完全不可见的元素能被检出；修复版无误报 |
| B4 | 评测流水线：`eval/run.mjs` 一条命令跑假站 original/fixed、W3C BAD after（测误报）、axe 对比，**并包含 judge 开/关消融**，输出 Markdown 表；和负责假站的队友一起写 `eval/keys.shop.json` | 一条命令产出可直接贴进 README 的结果表。开启 judge 的那一列需要 key 和 A3 的 prompt |
| B5 | CI 切到假站：workflow 里的 testpage 换成 `sites/shop/fixed` | GitHub Actions 在假站修复版上通过 |
| B6 | 用预跑真实网站的 trace 调噪音相关参数（依赖 A2 的 planner 和 A3 的 judge） | 真实网站上的轮播、倒计时不再被报告 |

## 同步节点

| 时间 | A | B |
| --- | --- | --- |
| 周六 16:30 | 开始 A1 | B0 合进 main，通知 A |
| 周六 18:00 | 模型测试结果出来；**A2 planner 在 testpage 上跑通（关键路径）** | real 模式暂停功能可用；D6 完成 |
| 周六 20:00（离开办公室前） | A4 第一轮完成；假站好了就让 planner 在假站 original 上端到端跑通 | 所有检测器能在假站上运行；A2 已跑通则预跑 3–5 个真实网站并缓存结果，否则改到周日早上 |
| 周日 10:00 | A3、A4 第二轮完成 | 第一次完整评测表（含消融），写进 README |
| 周日 12:30 | 功能冻结，两人一起在 readonly 缓存下演练 demo | 同左 |

硬截止：周日 13:00 提交 submission PR，14:00 代码冻结（评委看 main 分支最新 commit）。

## 关键依赖

两人大部分时间可以并行，以下几处必须等对方：

| 等待方 | 等什么 | 原因 | 如果对方没按时完成 |
| --- | --- | --- | --- |
| A | B0 | `fix`/`rerun` 的代码要先移出 `cli.mjs`，A 才有自己的文件可改 | A 先做 A1、A2，这两项不涉及这些文件 |
| B（真实网站预跑、B6） | A2、A3 | 真实网站没法用预录按键跑，必须有 planner；调噪音需要 judge | 真实网站预跑改到周日早上 |
| A3、A4 第二轮、B4、B5 | 假电商站（其他队友） | testpage 上几乎没有噪音，也不是 demo 用的站点 | 继续在 testpage 上开发，假站一好就切换 |
| B4 最终评测表 | key、A3 | 开启 judge 那一列需要调用模型，且 prompt 要先调好 | 先产出关闭 judge 的数字 |

## 协作规则

**改 contract：** B 新增的 Step 字段（`unreachableClickables`、`focusVisible` 的实际值）都是可选的、只增不改。加字段时同步三处：

1. 更新 `src/contracts.mjs` 里的注释
2. 重新生成一份 fixture（`npm test` 要继续通过）
3. 在群里通知 A：fixture 重新生成后步骤编号会变

**Git 流程：**

- 各开一个分支，比如 `agent-loop`（A）和 `runner-eval`（B）
- 每完成一个任务发一个小 PR，合并前 `npm test` 必须通过；B 改了 `src/runner/` 还要跑 `npm run smoke`
- 每次开始新任务前先 `git pull --rebase origin main`
- `src/contracts.mjs`、`AGENTS.md`、`fixtures/` 是共用的，谁要改先在群里说一声
- 加依赖前先说一声，避免 `package-lock.json` 冲突
- A 跑 planner 出问题时，先跑 `npm run smoke`，排除是不是 runner 被改坏了

## 给 Claude Code 的第一个任务

在 repo 根目录运行 `claude`，粘贴对应的一段。

**A：**

> 读 docs/ARCHITECTURE.md 和 AGENTS.md。只改 src/agent、src/fix、src/report/compare.mjs、prompts，以及 scripts/smoke-llm.mjs、scripts/demo.sh。先写 scripts/smoke-llm.mjs：对 .env 里的两个模型各调用 10 次 chatJSON，输出延迟的中位数和 p90、JSON 解析失败次数，再测 DeepSeek 是否接受 image_url 输入。然后让 planner 在 http://localhost:8080/testpage/fixed/ 上自主运行（goal 里写明卡号），记录每步延迟，直到 25 步内输出 done。不要改 src/contracts.mjs、cli.mjs、src/audit.mjs。

**B：**

> 读 docs/ARCHITECTURE.md 和 AGENTS.md。只改 src/runner、src/detect、src/audit.mjs、cli.mjs、eval、.gitignore、.github，以及 scripts/ 下除 smoke-llm.mjs 和 demo.sh 以外的文件。先做 B0，每项单独 commit：① .gitignore 里把 sites/shop/patched/ 改成 sites/*/patched/；② 把 cli.mjs 里 fix 和 rerun 的处理逻辑移到新文件 src/fix/commands.mjs，cli.mjs 只负责转发，行为不变；③ 加 npm run smoke：启动 scripts/serve.mjs，用 eval/keys.testpage.json 在 testpage/original 上跑 audit --no-judge，用 score 断言检出 4/4、0 误报，然后关掉服务器。完成后再做 real 模式：start() 之后暂停，等用户在终端按回车再进入 agent 循环。每次改完都跑 npm test 和 npm run smoke。
