import type { AuditReport, Progress, RunList, Suggestion } from "./contracts";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message); this.name = "ApiError"; this.code = code; this.status = status;
  }
}

// Same-origin by default: Vite proxies to the backend during development.
const base = (import.meta.env?.VITE_API_BASE ?? "").replace(/\/$/, "");

export function runPath(runDir: string): string {
  const parts = runDir.split("/");
  if (!parts.length || parts.some((p) => !/^[\w.-]+$/.test(p) || p.startsWith("."))) {
    throw new Error("Invalid run directory.");
  }
  return parts.map(encodeURIComponent).join("/");
}

export function rerunName(path: string): string {
  const name = path.replace(/^runs\//, "");
  runPath(name);
  return name;
}

export function artifactUrl(runDir: string, relative: string | null | undefined): string | undefined {
  if (!relative) return undefined;
  const parts = relative.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || /[\\:#?]/.test(p))) return undefined;
  return `${base}/runs/${runPath(runDir)}/${parts.map(encodeURIComponent).join("/")}`;
}

async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      signal, cache: "no-store", ...(body !== undefined ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      } : {}),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError("Cannot reach the audit service. Check that the backend is running.", "network_error", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error?.message || `The audit service returned HTTP ${response.status}.`, data?.error?.code || "request_failed", response.status);
  }
  if (!data || typeof data !== "object") throw new ApiError("The audit service returned an invalid response.", "invalid_response", response.status);
  return data as T;
}

export const liveApi = {
  list: (signal?: AbortSignal) => request<RunList>("/api/runs", signal),
  async start(url: string, goal: string) {
    return request<{ runDir: string }>("/api/runs", undefined, { url: url.trim(), ...(goal.trim() ? { goal: goal.trim() } : {}) });
  },
  // generate: ask the model for tasks even on demo sites that have eval/groundtruth presets.
  suggest: (url: string, signal?: AbortSignal, generate = true) => request<{ suggestions: Suggestion[] }>("/api/tasks/suggest", signal, { url: url.trim(), ...(generate ? { generate: true } : {}) }),
  progress: (id: string, signal?: AbortSignal) => request<Progress>(`/runs/${runPath(id)}/progress.json`, signal),
  report: (id: string, signal?: AbortSignal) => request<AuditReport>(`/runs/${runPath(id)}/report.json`, signal),
  fix: (id: string, findingIds?: string[]) => request<{ runDir: string }>(`/api/runs/${runPath(id)}/fix`, undefined, { rerun: true, ...(findingIds ? { findingIds } : {}) }),
};

export const SUGGEST_GENERATE_TIMEOUT_MS = 30_000;
export const SUGGEST_PRESET_TIMEOUT_MS = 15_000;
export type SuggestResult = { suggestions: Suggestion[]; generateError: string | null };
const DESCRIBE_TASK = "Describe a task yourself.";

// Runs one suggest request that the caller's signal or its own timeout can abort; reports which one did.
async function suggestWithin(url: string, generate: boolean, signal: AbortSignal | undefined, timeoutMs: number) {
  const attempt = new AbortController();
  const cancel = () => attempt.abort();
  signal?.addEventListener("abort", cancel);
  const timer = setTimeout(cancel, timeoutMs);
  try {
    return await liveApi.suggest(url, attempt.signal, generate);
  } catch (e) {
    if (signal?.aborted) throw e;
    if (attempt.signal.aborted) throw new ApiError("Task suggestions timed out.", "suggest_timeout", 0);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

// Model generation can fail, time out or return nothing. Presets need no model, so fall back to
// them; generateError records why so the page can say AI suggestions were unavailable.
// If the fallback also fails, the error asks the user to describe a task.
export async function suggestTasks(url: string, signal?: AbortSignal,
  timeoutMs = SUGGEST_GENERATE_TIMEOUT_MS, presetTimeoutMs = SUGGEST_PRESET_TIMEOUT_MS): Promise<SuggestResult> {
  let generateError: string;
  try {
    const result = await suggestWithin(url, true, signal, timeoutMs);
    if (result.suggestions?.length) return { suggestions: result.suggestions, generateError: null };
    generateError = "The model returned no suggestions.";
  } catch (e) {
    if (signal?.aborted) throw e;
    generateError = e instanceof Error ? e.message : "AI suggestions failed.";
  }
  let presets: { suggestions: Suggestion[] };
  try {
    presets = await suggestWithin(url, false, signal, presetTimeoutMs);
  } catch (e) {
    if (signal?.aborted) throw e;
    const reason = e instanceof Error ? e.message : "The request failed.";
    throw new ApiError(`Task suggestions are unavailable (${reason}) ${DESCRIBE_TASK}`, e instanceof ApiError ? e.code : "suggest_failed", e instanceof ApiError ? e.status : 0);
  }
  if (!presets.suggestions?.length) throw new ApiError(`No task suggestions are available for this page. ${DESCRIBE_TASK}`, "no_suggestions", 200);
  return { suggestions: presets.suggestions, generateError };
}
