import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { AnalysisStage, Box, RunEvent, RunOutcome } from "../api/types";

export type AgentNode = "decider" | "translator" | "guard" | "screenReader";

export type RunState = {
  events: RunEvent[];
  url?: string;
  goal?: string;
  maxTurns: number;
  viewport?: { width: number; height: number };
  turn: number;
  latestFrame?: { screenshotUrl: string; pageUrl: string; focusBox?: Box };
  lastHeard?: { turn: number; announcements: string[] };
  activeNode: AgentNode | null;
  ended?: { outcome: RunOutcome; turns: number };
  analysis: {
    stage?: AnalysisStage;
    detected?: { axe: number; deterministic: number };
    judged?: { kept: number; dropped: number };
  };
  reportReady: boolean;
  error?: string;
};

/** 每类循环事件之后轮到哪个节点工作 */
const nextNode: Partial<Record<RunEvent["type"], AgentNode>> = {
  "run.started": "decider",
  "turn.intent": "translator",
  "turn.command": "guard",
  "turn.rejected": "translator",
  "turn.executed": "screenReader",
  "turn.frame": "screenReader",
  "turn.heard": "decider",
};

function summarize(events: RunEvent[]): RunState {
  const state: RunState = {
    events,
    maxTurns: 1,
    turn: 0,
    activeNode: null,
    analysis: {},
    reportReady: false,
  };

  for (const event of events) {
    if (nextNode[event.type]) state.activeNode = nextNode[event.type]!;

    switch (event.type) {
      case "run.started":
        state.url = event.url;
        state.goal = event.goal;
        state.maxTurns = event.maxTurns;
        state.viewport = event.viewport;
        break;
      case "turn.intent":
        state.turn = event.turn;
        break;
      case "turn.frame":
        state.latestFrame = event;
        break;
      case "turn.heard":
        state.lastHeard = event;
        break;
      case "run.ended":
        state.ended = event;
        state.activeNode = null;
        break;
      case "analysis.stage":
        state.analysis.stage = event.stage;
        break;
      case "analysis.detected":
        state.analysis.detected = event;
        break;
      case "analysis.judged":
        state.analysis.judged = event;
        break;
      case "report.ready":
        state.reportReady = true;
        break;
      case "error":
        state.error = event.message;
        break;
    }
  }

  return state;
}

const noEvents: RunEvent[] = [];

/** 订阅一个 run 的事件流，并汇总成页面需要的状态 */
export default function useRunStream(runId: string | null): RunState {
  // 事件带上所属 runId，切换 run 的那一帧不会读到上一个 run 的状态
  const [stream, setStream] = useState<{ runId: string | null; events: RunEvent[] }>({
    runId: null,
    events: [],
  });

  useEffect(() => {
    setStream({ runId, events: [] });
    if (!runId) return;

    return api.subscribeRun(runId, (event) => {
      // 后端重连时会从 run.started 重放，此时丢弃旧事件
      setStream((previous) => ({
        runId,
        events:
          event.type === "run.started" ? [event] : [...previous.events, event],
      }));
    });
  }, [runId]);

  const events = stream.runId === runId ? stream.events : noEvents;
  return useMemo(() => summarize(events), [events]);
}
