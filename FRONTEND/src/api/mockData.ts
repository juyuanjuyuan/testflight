// Demo 数据：原来写死在 App.tsx 里的 Acme 场景，改写成后端契约的形状。
// 只被 mock.ts 使用；接上真实后端后这个文件不会被读取。

import type { Box, Finding, Patch } from "./types";

export const DEMO_URL = "https://demo.example.com";
export const DEMO_GOAL =
  "Complete the primary task using a keyboard and screen reader";

// ---------- 模拟截图（SVG，替代证据记录器的真实截图） ----------

const W = 1440;
const H = 900;

const box = (x: number, y: number, w: number, h: number): Box => [
  x / W,
  y / H,
  w / W,
  h / H,
];

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "#ffffff",
  stroke = "#aaa69e",
) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}"/>`;

const text = (
  x: number,
  y: number,
  value: string,
  size = 20,
  fill = "#1d1f1b",
  extra = "",
) =>
  `<text x="${x}" y="${y}" font-family="ui-monospace, monospace" font-size="${size}" fill="${fill}" ${extra}>${value}</text>`;

const serif = (x: number, y: number, value: string, size: number) =>
  `<text x="${x}" y="${y}" font-family="Georgia, serif" font-size="${size}" fill="#1d1f1b">${value}</text>`;

function page(body: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#eeeae1"/>
    ${serif(80, 88, "NORTH / CO.", 30)}
    ${text(1060, 84, "SHOP", 18)}${text(1150, 84, "JOURNAL", 18)}
    ${rect(1300, 52, 60, 46, "#f7f4ee", "#cfc9bd")}
    <text x="1330" y="84" font-size="24" text-anchor="middle">🛒</text>
    <line x1="80" y1="124" x2="1360" y2="124" stroke="#cfc9bd"/>
    ${body}
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const checkoutBody = (card: string, error: boolean) => `
  ${serif(80, 220, "Complete your order.", 52)}
  ${text(80, 272, "EMAIL", 14, "#6b6a64")}
  ${rect(80, 282, 700, 56)}${text(100, 318, "you@example.com", 18, "#8b8a84")}
  ${text(80, 372, "SHIPPING ADDRESS", 14, "#6b6a64")}
  ${rect(80, 382, 700, 56)}${text(100, 418, "12 Garden St, Cambridge", 18, "#8b8a84")}
  ${text(80, 474, "CARD DETAILS", 14, "#6b6a64")}
  ${rect(80, 484, 700, 60)}${text(100, 522, card, 20)}${text(700, 522, "VISA", 18, "#1d1f1b", 'font-weight="700"')}
  ${
    error
      ? `${rect(80, 560, 700, 96, "#fff2ef", "#df5a46")}
         <circle cx="116" cy="596" r="14" fill="#df5a46"/>${text(111, 603, "!", 18, "#ffffff")}
         ${text(144, 602, "Card number is invalid", 20, "#9b3126", 'font-weight="700"')}
         ${text(144, 632, "Check your card details and try again.", 16, "#9b3126")}`
      : ""
  }
  ${rect(80, 680, 700, 64, "#20221e", "#20221e")}${text(360, 720, "PAY $68.00", 18, "#ffffff")}
  ${rect(880, 180, 480, 420, "#e6e1d6", "#d3cdc0")}
  ${text(910, 222, "ORDER SUMMARY", 14, "#6b6a64")}
  ${rect(910, 244, 140, 140, "#d8cfbd", "#d8cfbd")}
  ${text(910, 430, "Canvas Market Tote", 20, "#1d1f1b", 'font-weight="700"')}
  ${text(910, 460, "Natural / One size", 16, "#6b6a64")}
  ${text(910, 520, "Subtotal", 16)}${text(1250, 520, "$62.00", 16)}
  ${text(910, 560, "Total", 16, "#1d1f1b", 'font-weight="700"')}${text(1250, 560, "$68.00", 16, "#1d1f1b", 'font-weight="700"')}
`;

const frames = {
  home: page(`
    ${serif(80, 230, "Everyday goods, made well.", 56)}
    ${rect(80, 280, 640, 64)}${text(110, 320, "Search products", 20, "#8b8a84")}
    ${rect(80, 400, 400, 380, "#ddd6c8", "#ddd6c8")}
    ${rect(520, 400, 400, 380, "#d6cebd", "#d6cebd")}
    ${rect(960, 400, 400, 380, "#ddd6c8", "#ddd6c8")}
  `),
  results: page(`
    ${serif(80, 230, "Results for “canvas tote”", 52)}
    ${rect(80, 290, 400, 460, "#ffffff", "#cfc9bd")}${rect(100, 310, 360, 320, "#d8cfbd", "#d8cfbd")}
    ${text(100, 680, "Canvas Market Tote", 20, "#1d1f1b", 'font-weight="700"')}${text(100, 715, "$62.00", 18, "#6b6a64")}
    ${rect(520, 290, 400, 460, "#ffffff", "#cfc9bd")}${rect(540, 310, 360, 320, "#e2dccf", "#e2dccf")}
    ${text(540, 680, "Canvas Weekender", 20)}${text(540, 715, "$98.00", 18, "#6b6a64")}
    ${rect(960, 290, 400, 460, "#ffffff", "#cfc9bd")}${rect(980, 310, 360, 320, "#d8cfbd", "#d8cfbd")}
    ${text(980, 680, "Canvas Pouch", 20)}${text(980, 715, "$24.00", 18, "#6b6a64")}
  `),
  product: page(`
    ${rect(80, 170, 620, 640, "#d8cfbd", "#d8cfbd")}
    <path d="M290 380h200l30 300H260z" fill="#c7b89c"/><path d="M330 380c0-60 120-60 120 0" fill="none" stroke="#a8977a" stroke-width="10"/>
    ${serif(760, 250, "Canvas Market Tote", 52)}
    ${text(760, 310, "$62.00", 24)}
    ${text(760, 350, "Natural / One size", 18, "#6b6a64")}
    ${rect(760, 400, 420, 70, "#20221e", "#20221e")}${text(900, 443, "ADD TO CART", 18, "#ffffff")}
  `),
  cart: page(`
    ${serif(80, 230, "Your cart", 56)}
    ${rect(80, 280, 1280, 140)}${rect(100, 300, 100, 100, "#d8cfbd", "#d8cfbd")}
    ${text(230, 345, "Canvas Market Tote — Natural", 20, "#1d1f1b", 'font-weight="700"')}${text(230, 380, "Qty 1", 16, "#6b6a64")}
    ${text(1250, 345, "$62.00", 20)}
    ${rect(940, 480, 420, 70, "#20221e", "#e3dfd6")}${text(1085, 523, "CHECKOUT", 18, "#ffffff")}
  `),
  checkout: page(checkoutBody("4111 1111 1111 1112", false)),
  checkoutError: page(checkoutBody("4111 1111 1111 1112", true)),
  checkoutRetry: page(checkoutBody("4242 4242 4242 4242", true)),
  confirmed: page(`
    <circle cx="720" cy="360" r="70" fill="#dcebd4"/><path d="M685 360l25 25 45-50" fill="none" stroke="#3c792c" stroke-width="10"/>
    <text x="720" y="520" font-family="Georgia, serif" font-size="56" text-anchor="middle" fill="#1d1f1b">Order confirmed.</text>
    <text x="720" y="570" font-family="ui-monospace, monospace" font-size="20" text-anchor="middle" fill="#6b6a64">A receipt is on its way.</text>
  `),
};

// ---------- 读屏代理的每一轮（D2 意图 → D1 命令 → 校验 → 执行 → 播报） ----------

export type MockTurn = {
  intent: string;
  commands: { summary: string; rejected?: string }[];
  heard: string[];
  frame: string;
  pageUrl: string;
  focus?: Box;
};

const home = `${DEMO_URL}/`;
const product = `${DEMO_URL}/products/canvas-market-tote`;
const checkout = `${DEMO_URL}/checkout`;

export function buildTurns(fixed: Set<string>): MockTurn[] {
  const cartFixed = fixed.has("AR-198");
  const errorFixed = fixed.has("AR-201");

  const turns: MockTurn[] = [
    {
      intent: "Open the store and get oriented.",
      commands: [{ summary: `navigate ${DEMO_URL}` }],
      heard: [
        "NORTH / CO., web content",
        "Everyday goods, made well., heading level 1",
      ],
      frame: frames.home,
      pageUrl: home,
      focus: box(80, 170, 760, 80),
    },
    {
      intent: "Find the search box and look for a canvas tote.",
      commands: [{ summary: 'sr.find { role: "searchbox" }' }],
      heard: ["Search products, search text field"],
      frame: frames.home,
      pageUrl: home,
      focus: box(80, 280, 640, 64),
    },
    {
      intent: "Type the product name and search.",
      commands: [{ summary: 'keyboard.type "canvas tote" + Enter' }],
      heard: ["Results for canvas tote, heading level 1", "3 products"],
      frame: frames.results,
      pageUrl: `${DEMO_URL}/search?q=canvas+tote`,
      focus: box(80, 180, 720, 70),
    },
    {
      intent: "Open the first result.",
      commands: [
        {
          summary: 'sr.activate { name: "Canvas tote" }',
          rejected:
            "No element named “Canvas tote” in the current accessibility snapshot.",
        },
        { summary: 'sr.next { role: "link" } → sr.activate' },
      ],
      heard: ["Canvas Market Tote, heading level 1", "$62.00"],
      frame: frames.product,
      pageUrl: product,
      focus: box(760, 200, 560, 70),
    },
    {
      intent: "Add it to my cart.",
      commands: [
        { summary: 'sr.activate { role: "button", name: "Add to cart" }' },
      ],
      heard: ["Add to cart, button", "Added to cart"],
      frame: frames.product,
      pageUrl: product,
      focus: box(760, 400, 420, 70),
    },
    {
      intent: "Now go to the cart.",
      commands: [
        {
          summary: 'sr.find { role: "button", name: /cart/i }',
          rejected: "Regex selectors are not allowed. Use an exact role and name.",
        },
        { summary: 'sr.next { role: "button" }' },
      ],
      heard: cartFixed ? ["View cart, 1 item, button"] : ["shopping cart, button"],
      frame: frames.product,
      pageUrl: product,
      focus: box(1300, 52, 60, 46),
    },
    {
      intent: cartFixed
        ? "Open the cart."
        : "It only says “shopping cart”. I'm not sure it opens my cart, but I'll try.",
      commands: [{ summary: "sr.activate (focused element)" }],
      heard: ["Your cart, heading level 1", "Canvas Market Tote, Natural, $62.00"],
      frame: frames.cart,
      pageUrl: `${DEMO_URL}/cart`,
      focus: box(80, 170, 400, 80),
    },
    {
      intent: "Proceed to checkout.",
      commands: [{ summary: "keyboard.press Tab ×2" }],
      heard: ["Checkout, button"],
      frame: frames.cart,
      pageUrl: `${DEMO_URL}/cart`,
      focus: box(940, 480, 420, 70),
    },
    {
      intent: "Start checkout and fill in my email.",
      commands: [{ summary: 'sr.activate "Checkout" → sr.find { role: "textbox" }' }],
      heard: ["Complete your order., heading level 1", "Email, edit text"],
      frame: frames.checkout,
      pageUrl: checkout,
      focus: box(80, 282, 700, 56),
    },
    {
      intent: "Enter my card number.",
      commands: [{ summary: 'keyboard.type "4111 1111 1111 1112"' }],
      heard: ["Card number, edit text, 4111 1111 1111 1112"],
      frame: frames.checkout,
      pageUrl: checkout,
      focus: box(80, 484, 700, 60),
    },
    {
      intent: "Pay for the order.",
      commands: [
        { summary: 'sr.activate { role: "button", name: "Pay $68.00" }' },
      ],
      heard: errorFixed
        ? ["alert, Card number is invalid. Check your card details and try again."]
        : [],
      frame: frames.checkoutError,
      pageUrl: checkout,
      focus: box(80, 680, 700, 64),
    },
  ];

  if (errorFixed) {
    turns.push(
      {
        intent: "The card number is wrong. Let me correct it.",
        commands: [{ summary: 'sr.find "Card number" → keyboard.type "4242 4242 4242 4242"' }],
        heard: [
          "Card number, edit text, invalid entry, Card number is invalid",
          "4242 4242 4242 4242",
        ],
        frame: frames.checkoutRetry,
        pageUrl: checkout,
        focus: box(80, 484, 700, 60),
      },
      {
        intent: "Pay again.",
        commands: [
          { summary: 'sr.activate { role: "button", name: "Pay $68.00" }' },
        ],
        heard: ["Order confirmed., heading level 1"],
        frame: frames.confirmed,
        pageUrl: `${DEMO_URL}/order/confirmed`,
        focus: box(420, 460, 600, 80),
      },
    );
  } else {
    turns.push({
      intent: "I pressed Pay and heard nothing. Did it work? Let me read around the form.",
      commands: [{ summary: 'sr.readFrom { name: "Card number" }' }],
      heard: ["Card number, edit text, 4111 1111 1111 1112", "Pay $68.00, button"],
      frame: frames.checkoutError,
      pageUrl: checkout,
      focus: box(80, 484, 700, 60),
    });
  }

  return turns;
}

// ---------- Judge 之后的问题列表 ----------

export const demoFindings: Finding[] = [
  {
    id: "AR-201",
    severity: "critical",
    title: "Form error is not announced to screen readers",
    impact: "Users cannot identify the error or understand how to recover.",
    taskImpact: "blocking",
    wcag: [
      { id: "4.1.3", name: "Status Messages" },
      { id: "3.3.1", name: "Error Identification" },
    ],
    turn: 11,
    page: "Form",
    confidence: 0.98,
    fixable: true,
    evidence: {
      screenshotUrl: frames.checkoutError,
      focusBox: box(80, 560, 700, 96),
      heard: [],
      userIntent:
        "I submitted the form but received no announcement. I will review the fields.",
      userImpact:
        "A screen reader user selects Pay, hears no response, and has no way to know which field needs attention.",
      explanation:
        "The new error message is never announced and is not associated with the card input.",
      facts: ["#card-error", "aria-live: missing", "aria-describedby: none"],
    },
  },
  {
    id: "AR-198",
    severity: "critical",
    title: "Icon button has no descriptive accessible name",
    impact:
      "Screen reader users cannot determine the button's purpose.",
    taskImpact: "degrading",
    wcag: [
      { id: "4.1.2", name: "Name, Role, Value" },
      { id: "2.4.6", name: "Headings and Labels" },
    ],
    turn: 6,
    page: "Main content",
    confidence: 0.94,
    fixable: true,
    evidence: {
      screenshotUrl: frames.product,
      focusBox: box(1300, 52, 60, 46),
      heard: ["button, button"],
      userIntent:
        "The button has no clear name. I will try it to learn what it does.",
      userImpact:
        "The user has to guess what the button does. The agent only continued by trial and error.",
      explanation:
        "The button has no accessible name that describes its purpose.",
      facts: ["button.icon-action", "accessible name: empty", "aria-label: none"],
    },
  },
  {
    id: "AR-184",
    severity: "moderate",
    title: "Keyboard focus indicator lacks contrast",
    impact: "Keyboard users may lose track of their position on the page.",
    taskImpact: "minor",
    wcag: [{ id: "2.4.7", name: "Focus Visible" }],
    turn: 8,
    page: "Page navigation",
    confidence: 0.9,
    fixable: true,
    evidence: {
      screenshotUrl: frames.cart,
      focusBox: box(940, 480, 420, 70),
      heard: ["Continue, button"],
      userImpact:
        "Sighted keyboard users can barely see which control is focused.",
      explanation:
        "The focus outline blends into the background. Screen reader output is unaffected.",
      facts: ["button.continue:focus", "outline contrast 1.4:1", "required ≥ 3:1"],
    },
  },
];

// ---------- Fixer 的受限修改 ----------

export const fixStages = [
  "Reading the site copy",
  "Locating DOM nodes from evidence",
  "Generating a constrained patch",
  "Checking against the constraints",
  "Preparing the diff",
];

const constraints = [
  "Only ARIA attributes and accessible names may change",
  "No visible copy, layout, or styling changes",
  "No script or business-logic edits",
  "Scoped to the elements named in the finding",
];

export const demoPatches: Record<string, Omit<Patch, "id">> = {
  "AR-201": {
    findingIds: ["AR-201"],
    target: "checkout/index.html",
    diff: `--- a/checkout/index.html
+++ b/checkout/index.html
@@ -118,8 +118,9 @@
   <div class="field">
     <label for="card-number">Card details</label>
-    <input id="card-number" name="card" inputmode="numeric">
+    <input id="card-number" name="card" inputmode="numeric"
+           aria-describedby="card-error">
   </div>
-  <p id="card-error" class="error" hidden>
+  <p id="card-error" class="error" role="alert" hidden>
     Card number is invalid. Check your card details and try again.
   </p>`,
    headline: "Two attributes. Full recovery.",
    summary:
      "The error message will now be announced immediately and linked to the card input.",
    explanation: [
      {
        title: "Announce the error",
        detail:
          'role="alert" tells assistive technology to announce the message as soon as it appears.',
      },
      {
        title: "Connect it to the field",
        detail:
          "aria-describedby makes the error available whenever the card input receives focus.",
      },
    ],
    constraints,
    checks: [
      { label: "HTML validates", passed: true },
      { label: "Constraints respected", passed: true },
      { label: "0 other nodes changed", passed: true },
    ],
  },
  "AR-198": {
    findingIds: ["AR-198"],
    target: "partials/header.html",
    diff: `--- a/partials/header.html
+++ b/partials/header.html
@@ -24,5 +24,7 @@
   <nav class="site-nav">
     <a href="/shop">Shop</a>
     <a href="/journal">Journal</a>
-    <button class="cart-icon">🛒</button>
+    <button class="cart-icon" aria-label="View cart, 1 item">
+      <span aria-hidden="true">🛒</span>
+    </button>
   </nav>`,
    headline: "A name that says what it does.",
    summary:
      "The cart button now announces its action and item count instead of an emoji.",
    explanation: [
      {
        title: "Give the button a real name",
        detail: "aria-label replaces the emoji description with “View cart, 1 item”.",
      },
      {
        title: "Hide the decoration",
        detail: 'aria-hidden="true" stops the emoji from being read twice.',
      },
    ],
    constraints,
    checks: [
      { label: "HTML validates", passed: true },
      { label: "Constraints respected", passed: true },
      { label: "0 other nodes changed", passed: true },
    ],
  },
  "AR-184": {
    findingIds: ["AR-184"],
    target: "assets/buttons.css",
    diff: `--- a/assets/buttons.css
+++ b/assets/buttons.css
@@ -42,6 +42,8 @@
 .button.continue:focus {
-  outline: 2px solid #d9dccf;
-  outline-offset: 0;
+  outline: 3px solid #1f4d2b;
+  outline-offset: 2px;
 }
+.button.continue:focus:not(:focus-visible) { outline: none; }
+.button.continue:focus-visible { outline: 3px solid #1f4d2b; }`,
    headline: "A focus ring you can actually see.",
    summary:
      "The Continue button's focus outline now reaches 7.2:1 contrast and only shows for keyboard users.",
    explanation: [
      {
        title: "Raise the outline contrast",
        detail: "A darker, thicker outline lifts contrast from 1.4:1 to 7.2:1, above the 3:1 minimum.",
      },
      {
        title: "Keep mouse clicks unchanged",
        detail: ":focus-visible shows the ring for keyboard focus only, so the visual design is otherwise untouched.",
      },
    ],
    constraints: [
      "Only focus-state styles may change",
      "No visible copy, layout, or default-state styling changes",
      "No script or business-logic edits",
      "Scoped to the elements named in the finding",
    ],
    checks: [
      { label: "CSS validates", passed: true },
      { label: "Focus contrast ≥ 3:1", passed: true },
      { label: "0 other selectors changed", passed: true },
    ],
  },
};
