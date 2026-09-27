# 后端需要补充的接口（给后端）

## 背景

前端的流程一共 8 步：输入网址和任务 → 运行（实时画面）→ 报告 → 问题详情 → 修复 → 应用 → 复测 → 合规报告。

现在后端的形式是：命令行启动运行，结束后生成一个 `report.json`。前端会完全按 `REPORT_FORMAT.md` 读取 `report.json`，这部分**不需要改**。

但只有 `report.json` 的话，前端有三件事做不到：

| 前端需要 | 现在的情况 | 结果 |
|---|---|---|
| 用户在网页上输入网址和任务，点 "Start audit" 开始运行 | 只能用命令行启动 | 按钮点了没有反应，只能让用户手动填运行目录名 |
| 运行过程中实时显示 AI 每一步做了什么、看到什么、听到什么 | 运行结束后才有数据 | 只能在运行结束后回放，没有实时画面 |
| 用户点"修复"和"应用并复测" | 修复和重跑只能用命令行 | 这两步只能展示已经跑好的结果 |

下面是解决这三件事的**最小改动**。原则：

- `report.json` 仍然是唯一的最终结果，格式不变，只新增字段。
- 不引入新的数据格式：运行中的进度直接复用 `timeline[]` 里每一步的结构。
- 不需要 WebSocket 或 SSE：前端每秒读一次进度文件就够了，这样和现有的静态文件服务器（`npm run serve`，端口 8080）最契合。

## 优先级

| 优先级 | 内容 | 解决什么 |
|---|---|---|
| **P0** | `POST /api/runs` + `progress.json` | 网页上能启动运行，并且能看到实时画面 |
| **P1** | `POST /api/runs/<runDir>/fix`（可选同时复测） | 网页上能触发修复和复测 |
| **P2** | `GET /api/runs`，以及第 5 节里的几个新增字段 | 历史运行列表，展示更准确 |

P0 做完，前端的"开始 → 实时画面 → 报告 → 问题详情"就是真实流程；P1 做完，整个 8 步都是真实流程。

---

## 1. P0：启动运行

```
POST /api/runs
Content-Type: application/json

{
  "url": "http://localhost:8080/testpage/original/",
  "goal": "Buy the canvas tote bag. Pay with card number 4242 4242."
}
```

响应（运行在后台开始，接口立即返回）：

```
202 Accepted

{
  "runDir": "2026-09-26T21-24-50-audit"
}
```

要求：

- 在后台启动现有的审计命令，效果等同于用命令行跑，`runDir` 就是命令行结束时会打印的那个目录名。
- **接口返回之前**就要创建好运行目录，并写入第一版 `progress.json`（`state: "running"`，`timeline: []`）。这样前端拿到 `runDir` 后马上去读，不会碰到 404。
- `mode`（local / real）由后端按网址自己判断，前端不传。如果需要前端传，告诉我们。
- 参数检查：`url` 只允许 `http://` 和 `https://`；`goal` 不能为空。不合格时返回 `400`，格式见第 4 节。
- 如果同一时间只能跑一个运行，已有运行在跑时返回 `409`，前端会提示"已有运行在进行中"。

## 2. P0：运行进度 `progress.json`

运行过程中，后端在运行目录里**持续更新**一个 `progress.json`：

```
GET /runs/<runDir>/progress.json
```

前端每秒读一次，直到 `state` 变成 `done` 或 `failed`。

### 格式

```json
{
  "state": "running",
  "step": 7,
  "maxSteps": 30,
  "timeline": [
    { "i": 0, "action": { "kind": "start", "reason": "open page" }, "...": "..." },
    {
      "i": 7,
      "action": { "kind": "press", "key": "Enter", "reason": "Submitting payment" },
      "url": "http://localhost:8080/testpage/original/",
      "focus": "button \"Pay\"",
      "focusRect": { "x": 771, "y": 364, "w": 39, "h": 21 },
      "seen": [{ "text": "Card number is invalid", "rect": { "x": 470, "y": 401, "w": 339, "h": 19 } }],
      "seenNoise": [],
      "heard": [],
      "screenshot": "shots/0007.png",
      "findingIds": []
    }
  ],
  "rerunDir": null,
  "error": null,
  "updatedAt": "2026-09-26T21:25:31.000Z"
}
```

| 字段 | 说明 |
|---|---|
| `state` | 当前阶段，见下表 |
| `step` | 当前步骤编号（和 `timeline[].i` 一致） |
| `maxSteps` | 步数上限，前端用来画进度条。拿不到时给 `null` |
| `timeline` | 到目前为止的所有步骤，**每一步的结构和 `report.json` 的 `timeline[]` 完全一样**。运行中还没做检测，`findingIds` 给空数组即可 |
| `rerunDir` | 复测阶段（`state: "rerunning"`）时，复测那次运行的目录名；其他时候为 `null` |
| `error` | `state: "failed"` 时的错误原因（一句话，会显示给用户）；其他时候为 `null` |
| `updatedAt` | 最后更新时间 |

`state` 的取值：

| state | 含义 | 前端显示 |
|---|---|---|
| `running` | AI 正在一步步操作 | 实时画面 |
| `analyzing` | 操作结束，正在跑检测器、axe 和 judge | "正在分析证据" |
| `fixing` | 正在生成并应用修复（P1） | "正在生成修复" |
| `rerunning` | 正在副本上用同一个任务重跑（P1） | 实时画面，读 `rerunDir` 的进度 |
| `done` | 全部完成，`report.json` 已经写好 | 跳转到报告页 |
| `failed` | 出错终止 | 显示 `error` |

### 写入要求（很重要）

1. **每完成一步就更新一次**：步骤结束、截图保存好之后再写。
2. **原子写入**：先写到 `progress.json.tmp`，再重命名为 `progress.json`。否则前端可能读到写了一半的文件，JSON 解析会失败。`report.json` 也请用同样的方式写。
3. **截图先落盘**：`timeline[].screenshot` 指向的图片在写入 `progress.json` 之前就要存在，否则前端会显示图片加载失败。
4. **顺序**：先写完 `report.json`，再把 `state` 改成 `done`。前端看到 `done` 就会去读 `report.json`。
5. **异常退出也要写 `failed`**：进程崩溃、模型超时、页面打不开时，尽量把 `state` 改成 `failed` 并写上 `error`。否则前端会一直停在"运行中"。

## 3. P1：修复和复测

前端的交互是：用户在问题详情页点"生成修复"，看到修改前后的对比，再点"应用并复测"。

```
POST /api/runs/<runDir>/fix
Content-Type: application/json

{
  "findingIds": ["F2"],
  "rerun": true
}
```

| 字段 | 说明 |
|---|---|
| `findingIds` | 要修复的问题。不传时修复所有 `block` 级问题 |
| `rerun` | `true` = 修复完成后自动用同一个任务在副本上重跑 |

响应：`202 Accepted`，`{ "runDir": "<同一个 runDir>" }`

要求：

- 执行过程中更新**原运行目录**的 `progress.json`：`state` 依次为 `fixing` → `rerunning` → `done`。
- 进入 `rerunning` 时，在原目录的 `progress.json` 里写上 `rerunDir`。复测运行在它自己的目录里同样维护一个 `progress.json`（第 2 节的格式），前端会切过去读，实现复测过程的实时画面。
- 完成后把结果写回**原运行的** `report.json`：`findings[].fix`、`fixes`、`rerun`（就是 `REPORT_FORMAT.md` 第 7 节提到的"计划 04"）。
- `meta.mode` 为 `real` 时返回 `409`，错误信息写"真实网站只检测，不修复"。

如果"只修复、不复测"和"修复并复测"分开做更方便，也可以拆成两个接口，告诉我们路径即可。

## 4. 错误格式

所有 `/api/*` 接口出错时统一返回：

```json
{ "error": { "code": "invalid_url", "message": "URL must start with http:// or https://" } }
```

| HTTP 状态 | 场景 |
|---|---|
| `400` | 参数不合格 |
| `404` | `runDir` 不存在 |
| `409` | 已有运行在进行中；真实网站模式不能修复 |
| `500` | 其他错误 |

`message` 会直接显示给用户，请写成一句能看懂的话。

## 5. P2：新增字段和列表接口

以下都是**新增字段**，符合 `report.json` "只新增、不改名"的约定。

| 字段 | 内容 | 为什么需要 |
|---|---|---|
| `GET /api/runs` | 返回 `[{ runDir, url, goal, generatedAt, screenReaderUserCanComplete }]`，最新的在前 | 做"历史运行"列表；`REPORT_FORMAT.md` 里提到可以加 |
| `meta.startedAt` / `meta.finishedAt` | 整次运行的开始和结束时间 | `stats.ms` 只是模型调用耗时，前端没法显示"本次审计用时" |
| `meta.maxSteps` | 步数上限 | 报告页显示"用了 14 / 30 步" |
| `timeline[].t` | 这一步距离运行开始的毫秒数 | 回放时显示时间轴，例如 00:12 |
| `timeline[].shotSize` | 截图实际宽高（已在计划 08 中） | 换算框的位置 |
| `fix.constraints` 或一份文档 | Fixer 的修改限制，例如"只改 ARIA 属性，不改可见文字和业务逻辑" | 前端想在修复页展示这些规则，但必须和后端的真实行为一致，没有依据前端就不展示 |

## 6. 跨域和部署

- 开发阶段：前端在 8443 端口，会用 Vite 代理把 `/api`、`/runs`、`/fixtures` 转发到 8080，**后端不需要处理跨域**。
- 如果之后前后端分开部署，需要给 `/api/*`、`/runs/*` 加上 `Access-Control-Allow-Origin` 响应头。

## 7. 安全检查

- `runDir` 来自网址路径，**必须校验格式**（例如只允许 `^[\w.-]+$`），防止 `../` 读到运行目录以外的文件。
- `url` 只允许 http / https，不接受 `file://` 等协议。
- 真实网站模式下，Runner 已有的安全限制（例如强制替换输入内容）保持不变。

## 8. 验收方法

P0 完成后，下面这组命令应该能跑通：

```bash
# 1. 启动
curl -s -X POST localhost:8080/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:8080/testpage/original/","goal":"Buy the canvas tote bag. Pay with card number 4242 4242."}'
# → {"runDir":"2026-09-26T21-24-50-audit"}

# 2. 马上读进度：已存在，state=running，timeline 为空或只有第 0 步
curl -s localhost:8080/runs/2026-09-26T21-24-50-audit/progress.json

# 3. 每秒读一次：step 递增，timeline 变长，截图可以访问
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/runs/2026-09-26T21-24-50-audit/shots/0003.png   # → 200

# 4. 最终：state 从 analyzing 变成 done，这时 report.json 可以读取且格式符合 schema
curl -s localhost:8080/runs/2026-09-26T21-24-50-audit/report.json
```

P1 完成后：

```bash
curl -s -X POST localhost:8080/api/runs/2026-09-26T21-24-50-audit/fix \
  -H 'Content-Type: application/json' -d '{"findingIds":["F2","F4"],"rerun":true}'
# progress.json：fixing → rerunning（带 rerunDir）→ done
# report.json 里 findings[].fix、fixes、rerun 都已填好，rerun.closedLoop 为 true
```

## 9. 前端这边会做的

后端不需要配合，列出来方便对齐：

- 前端改为读取 `report.json`，严格遵守 `REPORT_FORMAT.md` 的约定：`null` 不当作 0，`axeViolations` 为 `null` 时显示"axe 不可用"，不认识的 `detector` 原样显示，不认识的字段忽略。
- 不读 `trace.jsonl` 等内部文件。
- 修复前后的对比只用 `rerun.status` 和 `rerun.introduced`，不靠问题 id 在两次运行之间匹配，也不解析 `status[].key`。
- 在 P0 上线之前，前端先用"选择已有运行目录 + 回放 timeline"的方式开发，数据用 `docs/report.example.json` 和两个 fixtures。

有任何字段名或接口路径想改，直接改，告诉我们就行；只要保持第 2 节"原子写入"和"先写 report.json 再标 done"这两条，前端就能对接。
