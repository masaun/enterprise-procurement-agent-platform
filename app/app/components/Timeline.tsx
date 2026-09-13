"use client";

import type { TimelineEvent, TimelineEventKind } from "@/lib/types";

const ICONS: Partial<Record<TimelineEventKind, string>> = {
  "siwx.authenticated": "🔐",
  "identity.resolved": "🪪",
  "a2a.discovered": "📡",
  "a2a.invoked": "↔",
  "a2a.selected": "🎯",
  "ap2.mandate": "🧾",
  "policy.evaluated": "📋",
  "keeperhub.condition_checked": "🧮",
  "keeperhub.executed": "⚡",
  "task.completed": "✅",
  "task.failed": "✕",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="empty">No activity yet — submit a procurement request to see the pipeline run.</div>;
  }

  return (
    <div className="timeline">
      {events.map((event, i) => (
        <div className="tl-item" key={i}>
          <div className="tl-dot">{ICONS[event.kind] ?? "•"}</div>
          <div className="tl-body">
            <div className="tl-kind">{event.kind}</div>
            <div className="tl-label">{event.label}</div>
            {event.detail ? <div className="tl-detail">{formatDetail(event.detail)}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatDetail(detail: Record<string, unknown>): string {
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}
