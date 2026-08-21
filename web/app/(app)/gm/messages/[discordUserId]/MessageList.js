"use client";

import { useEffect, useRef } from "react";
import MarkdownContent from "../../../../components/MarkdownContent";

export default function MessageList({ messages }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={containerRef} className="panel message-list flex flex-col gap-3 p-4">
      {messages.map((m) => (
        <div
          key={m.id}
          className="flex flex-col"
          style={{ alignItems: m.direction === "OUTBOUND" ? "flex-end" : "flex-start" }}
        >
          <div
            className="max-w-md rounded-md px-3 py-2 text-sm"
            style={{
              background: m.direction === "OUTBOUND" ? "var(--accent)" : "var(--field-bg)",
              color: m.direction === "OUTBOUND" ? "var(--bg)" : "var(--text)",
              border: m.direction === "OUTBOUND" ? "none" : "1px solid var(--border)",
            }}
          >
            <MarkdownContent content={m.content} />
          </div>
          <span className="mt-1 text-xs text-muted">
            {m.createdAt.toLocaleString()}
          </span>
        </div>
      ))}
      {messages.length === 0 && (
        <p className="text-sm text-muted">
          No messages yet.
        </p>
      )}
    </div>
  );
}
