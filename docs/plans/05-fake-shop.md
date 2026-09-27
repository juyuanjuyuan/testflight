# 05 — 假电商站

**目标：** 搭 demo 主舞台兼主评测集：一个可控、可复现、埋有 10 个左右障碍的小电商站，外加人工修复版。

**依赖：** 01　**预计：** 2 小时

**先读：** `sites/shop/README.md`（约定）、`eval/groundtruth/shop-main.yaml`（模板）、`sites/testpage/*`（参考写法）、`docs/ARCHITECTURE.md` §5（检测器能抓什么）

**可以改：** `sites/shop/original/**`、`sites/shop/fixed/**`、`eval/groundtruth/shop*.yaml`、新建 `eval/keys.shop*.json`
**不要改：** `src/**`

## 设计

四个页面：商品列表 → 商品详情 → 购物车弹窗 → 结账表单。纯静态 HTML/JS，无外部请求，无构建步骤。

**两条任务流**（很重要）：阻断型障碍会让 planner 走不到后面，所以分开放：

| 任务流 | goal | 放哪些障碍 |
|---|---|---|
| 主流程（demo 用） | "Buy a canvas tote bag. Pay with card 4000 0000 0000 0002; if it is declined, use 4242 4242 4242 4242." | 能走下去但听不到/看不到的障碍：emoji 按钮名、加购未播报、数量更新未播报、删除商品后焦点丢失、**卡被拒的错误未播报且未关联**、焦点不可见、文字印在图片上 |
| 第二流程（评测用） | 例如 "Apply the coupon SAVE10 at checkout" | 真正阻断的障碍：弹窗陷阱（无关闭按钮、Esc 无效）、只能鼠标点的"Apply"按钮 |

**卡被拒必须确定性触发**：第一张卡（4000…0002）永远被拒，第二张永远成功。不要依赖 planner 打错字。

## 步骤

1. 先写 `sites/shop/fixed/`（正确的无障碍版本），确认用键盘能完成两条任务流。
2. 复制成 `sites/shop/original/`，逐个埋入障碍。每个障碍元素（或其容器）加 `data-barrier="B<n>"`，并按所属流程登记到 `shop-main.yaml` 或 `shop-second.yaml`：`id`、`kind`、`wcag`、`impact`、`flow`（main/second）、`detectable`（`ours` / `vision-only`）。两条流程分开计分：`score.mjs` 不按流程过滤，所以一个文件只放一条流程的障碍。
3. 加一个一直在轮播的促销横幅（噪音，不是障碍，不登记）。
4. 为两条任务流各写一个预录按键脚本 `eval/keys.shop.main.json`、`eval/keys.shop.second.json`，先在 fixed 上确认能走到终点。
5. 建 `eval/groundtruth/shop-second.yaml`（格式同 `shop-main.yaml`，`flow: second`，goal 与第二流程一致）和 `eval/groundtruth/shop-fixed.yaml`（`barriers: []`，两条流程的 fixed 都用它）。

## 验收

```bash
node cli.mjs audit --url http://localhost:8080/shop/original/ --goal "<主流程 goal>" --script eval/keys.shop.main.json --no-judge --label shop-main
node cli.mjs score --run runs/<id> --groundtruth eval/groundtruth/shop-main.yaml
node cli.mjs audit --url http://localhost:8080/shop/original/ --goal "<第二流程 goal>" --script eval/keys.shop.second.json --no-judge --label shop-second
node cli.mjs score --run runs/<id> --groundtruth eval/groundtruth/shop-second.yaml
# fixed：两条流程各跑一次，都对 shop-fixed.yaml 计分
node cli.mjs score --run runs/<id> --groundtruth eval/groundtruth/shop-fixed.yaml
```

- original：每条流程对自己的标准答案文件，所有 `detectable: ours` 的障碍都被检出（D5、D6 相关的等 06、07 完成后再算；`vision-only` 算作漏检）。
- fixed：两条流程 0 误报。
- original 和 fixed 的可见文案完全一致（fixer 不允许改文案，参考答案也不能改）。

## 注意

- 最好由没写检测器的人埋障碍，并在 README 里如实说明，避免被质疑过拟合。
- 页面上别出现真实品牌名和 logo。

## 结果（已完成）

- 页面：`index.html`（列表）→ `product.html?id=tote`（详情）→ 购物车弹窗（列表页、详情页都有）→ `checkout.html` → `confirmation.html`。购物车存在 sessionStorage 里，默认带一顶"上次留下"的 Wool Beanie，用来埋"删除后焦点丢失"。
- 障碍：主流程 B1–B8（`shop-main.yaml`），第二流程 B9、B10（`shop-second.yaml`）。第二流程会经过购物车弹窗，所以共用障碍 B5 在两份文件里都登记了。
- 按键脚本：主流程 original 和 fixed 共用 `eval/keys.shop.main.json`（23 步，没超过 MAX_STEPS=25）。第二流程在 original 上会卡死，所以 fixed 单独一份 `eval/keys.shop.second.fixed.json`。
- 验收（--no-judge）：shop-main 检出 6/8，漏掉 B3（vision-only）和 B8（等 07）；shop-second 检出 2/3，漏掉 B10（等 06）；fixed 两条流程都是 0 误报，axe 0。两个版本的可见文字完全一样，脚本比较过。
- **给 09 的噪音问题**：轮播横幅只放在列表页。recorder 只在 `start()` 做 2 秒空闲基线，页面跳转后的新页面没有基线。轮播放在详情页或结账页时，前几步会被 D1 报成 unannounced，fixed 上会出现误报。修法是跳转后也做一次基线，这属于 `src/`，所以这次没改。
- 埋障碍的人也看过检测器代码，这一点已经在 `sites/shop/README.md` 里说明。
