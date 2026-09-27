import type {
  ApplyPatchResponse,
  CreateFixResponse,
  CreateRunRequest,
  CreateRunResponse,
  FixEvent,
  Patch,
  Report,
  RunEvent,
} from "./types";
import { createMockApi } from "./mock";

export type Unsubscribe = () => void;

export interface AuditApi {
  mode: "live" | "demo";
  createRun(request: CreateRunRequest): Promise<CreateRunResponse>;
  subscribeRun(runId: string, onEvent: (event: RunEvent) => void): Unsubscribe;
  getReport(runId: string): Promise<Report>;
  createFix(runId: string, findingIds: string[]): Promise<CreateFixResponse>;
  subscribeFix(fixId: string, onEvent: (event: FixEvent) => void): Unsubscribe;
  getPatch(patchId: string): Promise<Patch>;
  applyPatch(patchId: string): Promise<ApplyPatchResponse>;
  /** 合规报告下载地址；demo 模式下为 null */
  complianceUrl(runId: string): string | null;
  /** 仅 demo：跳过剩余动画 */
  skip?(runId: string): void;
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }

  return response.json() as Promise<T>;
}

function subscribe<E extends { type: string }>(
  url: string,
  onEvent: (event: E) => void,
  terminal: string[],
): Unsubscribe {
  const source = new EventSource(url);

  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as E;
    onEvent(event);
    // 收到终止事件后主动关闭，避免 EventSource 自动重连导致重放
    if (terminal.includes(event.type)) source.close();
  };

  source.onerror = () => {
    // 服务器正常结束流时也会触发 error；只在连接未建立时报错
    if (source.readyState === EventSource.CLOSED) {
      onEvent({ type: "error", t: 0, message: "Lost connection to the agent stream." } as unknown as E);
    }
  };

  return () => source.close();
}

function createLiveApi(base: string): AuditApi {
  return {
    mode: "live",
    createRun: (body) =>
      request(base, "/api/runs", { method: "POST", body: JSON.stringify(body) }),
    subscribeRun: (runId, onEvent) =>
      subscribe(`${base}/api/runs/${runId}/stream`, onEvent, ["report.ready", "error"]),
    getReport: (runId) => request(base, `/api/runs/${runId}/report`),
    createFix: (runId, findingIds) =>
      request(base, `/api/runs/${runId}/fixes`, {
        method: "POST",
        body: JSON.stringify({ findingIds }),
      }),
    subscribeFix: (fixId, onEvent) =>
      subscribe(`${base}/api/fixes/${fixId}/stream`, onEvent, ["fix.ready", "error"]),
    getPatch: (patchId) => request(base, `/api/patches/${patchId}`),
    applyPatch: (patchId) =>
      request(base, `/api/patches/${patchId}/apply`, { method: "POST" }),
    complianceUrl: (runId) => `${base}/api/runs/${runId}/compliance.pdf`,
  };
}

// 设置 VITE_API_BASE（例如 http://localhost:8000）即连接真实后端；
// 未设置或 URL 带 ?demo=1 时使用本地 mock 回放。
const apiBase = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");
const forceDemo = new URLSearchParams(window.location.search).has("demo");

export const api: AuditApi =
  apiBase && !forceDemo ? createLiveApi(apiBase) : createMockApi();
