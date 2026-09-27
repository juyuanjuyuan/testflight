// 前后端数据契约。后端（任务编排器 / Judge / 报告生成 / Fixer）按这些结构返回即可，
// 前端所有页面只从这里的数据渲染。

export type Severity = "critical" | "moderate" | "minor";
export type RunOutcome = "completed" | "blocked" | "budget_exhausted";

/** 屏幕上的矩形区域，取值为相对视口的比例 0–1：[x, y, width, height] */
export type Box = [number, number, number, number];

// ---------- 1 Connect ----------

/** POST /api/runs */
export type CreateRunRequest = {
  url: string;
  goal: string;
  /** 复测时传入：上一轮 run 的 id（网站副本上用相同目标重新运行） */
  parentRunId?: string;
};

export type CreateRunResponse = { runId: string };

// ---------- 2 Scan：GET /api/runs/:id/stream (SSE) ----------
// 每条 SSE message 的 data 是一个 RunEvent 的 JSON。
// t = 距离 run 开始的毫秒数。连接建立时后端应从头重放该 run 的全部事件。

export type RunEvent =
  | {
      type: "run.started";
      t: number;
      runId: string;
      url: string;
      goal: string;
      maxTurns: number;
      parentRunId?: string;
      viewport?: { width: number; height: number };
    }
  /** DeepSeek 2（用户决策者）：模拟用户这一轮想做什么 */
  | { type: "turn.intent"; t: number; turn: number; text: string }
  /** DeepSeek 1（操作翻译器）：结构化命令；summary 是给人看的一行描述 */
  | {
      type: "turn.command";
      t: number;
      turn: number;
      attempt: number;
      summary: string;
      command?: unknown;
    }
  /** 命令校验与安全限制：拒绝并退回 DeepSeek 1 */
  | {
      type: "turn.rejected";
      t: number;
      turn: number;
      attempt: number;
      reason: string;
    }
  /** Runner：执行结果 */
  | {
      type: "turn.executed";
      t: number;
      turn: number;
      ok: boolean;
      error?: string;
    }
  /** 反馈采集：本次新增播报（空数组 = 读屏器什么都没说） */
  | { type: "turn.heard"; t: number; turn: number; announcements: string[] }
  /** 证据记录器：本轮截图 */
  | {
      type: "turn.frame";
      t: number;
      turn: number;
      screenshotUrl: string;
      pageUrl: string;
      /** 读屏器当前焦点位置 */
      focusBox?: Box;
    }
  | { type: "run.ended"; t: number; outcome: RunOutcome; turns: number }
  // ---- 循环结束后的分析：trace → 确定性检测器 + axe-core → Judge → 报告 ----
  | {
      type: "analysis.stage";
      t: number;
      stage: AnalysisStage;
    }
  | {
      type: "analysis.detected";
      t: number;
      axe: number;
      deterministic: number;
    }
  | { type: "analysis.judged"; t: number; kept: number; dropped: number }
  /** 报告就绪，前端随后 GET /api/runs/:id/report */
  | { type: "report.ready"; t: number }
  | { type: "error"; t: number; message: string };

export type AnalysisStage = "trace" | "detect" | "judge" | "report";

// ---------- 3 Report / 4 Inspect：GET /api/runs/:id/report ----------

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  /** 一句话影响，用于列表 */
  impact: string;
  /** Judge 标注的任务影响 */
  taskImpact: "blocking" | "degrading" | "minor";
  wcag: { id: string; name: string }[];
  /** 发生在第几轮，对应 trace */
  turn: number;
  /** 所在页面，例如 "Checkout" */
  page: string;
  /** 0–1 */
  confidence: number;
  /** Fixer 能否在受限范围内修复 */
  fixable: boolean;
  /** 不可修复时的原因 */
  notFixableReason?: string;
  evidence: {
    /** 所见：该轮截图 */
    screenshotUrl?: string;
    focusBox?: Box;
    /** 所听：该轮读屏器播报，空数组 = 静默 */
    heard: string[];
    /** 该轮 DeepSeek 2 的原话 */
    userIntent?: string;
    /** 对用户的具体影响 */
    userImpact: string;
    /** 机制说明，例如"错误信息不在无障碍树中" */
    explanation: string;
    /** 确定性证据，例如 "#card-error"、"aria-live: missing" */
    facts: string[];
  };
};

export type Report = {
  runId: string;
  parentRunId?: string;
  url: string;
  goal: string;
  outcome: RunOutcome;
  headline: string;
  summary: string;
  durationMs: number;
  turns: number;
  pagesVisited: number;
  detected: { axe: number; deterministic: number };
  findings: Finding[];
  /** ISO 时间 */
  generatedAt: string;
  signature?: string;
};

// ---------- 5 Fix：POST /api/runs/:id/fixes → GET /api/fixes/:fixId/stream (SSE) ----------

export type CreateFixRequest = { findingIds: string[] };
export type CreateFixResponse = { fixId: string; stages: string[] };

export type FixEvent =
  | { type: "fix.stage"; index: number; label: string }
  | { type: "fix.ready"; patchId: string }
  | { type: "error"; message: string };

// ---------- 6 Apply：GET /api/patches/:id, POST /api/patches/:id/apply ----------

export type Patch = {
  id: string;
  findingIds: string[];
  /** 网站副本中被修改的资源 */
  target: string;
  /** unified diff */
  diff: string;
  headline: string;
  summary: string;
  explanation: { title: string; detail: string }[];
  /** Fixer 的受限规则 */
  constraints: string[];
  checks: { label: string; passed: boolean }[];
};

export type ApplyPatchResponse = { copyUrl: string };
