"use client";

import { useEffect, useState } from "react";
import { MAX_REASON_LENGTH } from "@/lib/constants";

// The universal Requests popup. Every player action that takes effect without
// GM approval opens one of these: a required reason on top (the thing the GM
// reads later), then whatever type-specific fields the caller passes as
// children. See docs/systemdocs/REQUESTS.md §2.
//
// Deliberately a rendered component taking children rather than a
// promise-returning hook like useConfirm() — the second half is arbitrary
// JSX per call site, which a hook API handles badly. It reuses the same
// .modal-overlay/.modal-panel styling so it matches every other modal.
// The shell only mounts its body while open, so the reason field resets
// between openings for free — no effect syncing state to the open flag.
export default function RequestDialog({ open, ...props }) {
  if (!open) return null;
  return <RequestDialogBody {...props} />;
}

function RequestDialogBody({
  title,
  submitLabel = "Confirm",
  busy = false,
  error = null,
  canSubmit = true,
  onCancel,
  onConfirm,
  children,
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const trimmed = reason.trim();
  const ready = !busy && canSubmit && trimmed.length > 0;

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel?.()}>
      <div className="modal-panel" style={{ maxWidth: "34rem" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="section-title">{title}</h2>
        </div>

        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onConfirm?.(trimmed);
          }}
        >
          <label className="field">
            <span className="field-label">What is your reason?</span>
            <textarea
              name="reason"
              rows={3}
              required
              autoFocus
              maxLength={MAX_REASON_LENGTH}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="This goes to the GMs — say what happened."
            />
          </label>
          <p className="text-xs text-muted" style={{ marginTop: "-0.25rem" }}>
            This takes effect immediately. A GM reviews it afterwards and may undo or edit it.
          </p>

          {children && (
            <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              {children}
            </div>
          )}

          {error && (
            <p className="text-sm text-accent">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-3">
            <button type="button" className="btn-quiet" onClick={() => onCancel?.()} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={!ready}>
              {busy ? "Working…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
