// Wire types for testflight docs/API.md and docs/report.schema.json.
// Optional fields allow reports recorded before plans 17/18 to remain readable.
export type Rect = { x: number; y: number; w: number; h: number };
export type ShotSize = { w: number; h: number; dpr: number };
export type TimelineStep = {
  i: number; t?: number | null; url?: string;
  action: { kind: string; reason: string; key?: string; text?: string; replace?: boolean; plannerError?: boolean };
  focus: string; focusRect?: Rect | null;
  seen: { text: string; rect?: Rect | null }[]; seenNoise?: string[]; heard: string[];
  screenshot?: string | null; shotSize?: ShotSize | null; findingIds: string[];
};
export type Verdicts = {
  outcome: string; agentCanComplete: boolean; screenReaderUserCanComplete: boolean;
  blockingFindings: string[]; unexplainedStuck: boolean;
};
export type Edit = { file: string; old: string; new: string };
export type Finding = {
  id: string; impact: string; summary: string; userImpact: string; detector: string; layer: string;
  wcag: string[]; steps: number[]; hint?: string; judged: boolean; axeAlsoFound: boolean;
  evidence: { selector?: string; barrierId?: string | null; text?: string; screenshot?: string | null };
  fix?: { edits: Edit[]; rationale?: string | null } | null;
};
export type FixResult = { finding: string; applied: number; errors: string[]; rationale?: string | null };
export type Rerun = {
  runDir: string; before: Verdicts; after: Verdicts; closedLoop: boolean;
  status: { id: string; status: string; key?: string }[];
  introduced: { id: string; status: string; key?: string }[];
};
export type AuditReport = {
  meta: { url?: string | null; goal: string; mode?: string; site?: string | null; script?: boolean; judge?: boolean;
    generatedAt?: string | null; startedAt?: string; finishedAt?: string; maxSteps?: number;
    goalSource?: string; goalReason?: string | null; testDataProfile?: string | null };
  verdicts: Verdicts; counts: { block: number; degrade: number; filteredOut: number; axeViolations: number | null; axeBestPractice?: number | null };
  timeline: TimelineStep[]; findings: Finding[]; fixes?: FixResult[] | null; rerun?: Rerun | null;
  fixPolicy?: { enforced: { id: string; rule: string }[]; instructed: { id: string; rule: string }[] };
  stats?: Record<string, unknown> | null;
};
export type Progress = {
  state: string; step: number | null; maxSteps: number | null; timeline: TimelineStep[];
  rerunDir: string | null; error: string | null; updatedAt: string; url?: string | null; goal?: string | null;
};
export type RunEntry = {
  runDir: string; url: string | null; goal: string | null; generatedAt: string | null;
  screenReaderUserCanComplete: boolean | null; state: string; progress?: string;
};
export type RunList = { runs: RunEntry[]; skipped: number; skippedReasons?: Record<string, number> };
export type Suggestion = { goal: string; source: string; reason: string; needs: string[] };
