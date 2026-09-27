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
  suggest: (url: string, signal?: AbortSignal) => request<{ suggestions: Suggestion[] }>("/api/tasks/suggest", signal, { url: url.trim() }),
  progress: (id: string, signal?: AbortSignal) => request<Progress>(`/runs/${runPath(id)}/progress.json`, signal),
  report: (id: string, signal?: AbortSignal) => request<AuditReport>(`/runs/${runPath(id)}/report.json`, signal),
  fix: (id: string, findingIds?: string[]) => request<{ runDir: string }>(`/api/runs/${runPath(id)}/fix`, undefined, { rerun: true, ...(findingIds ? { findingIds } : {}) }),
};
