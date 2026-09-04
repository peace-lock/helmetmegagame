"use client";

import { useState } from "react";
import { decodeGribble, looksLikeGribble } from "@lifeweb/db/lib/gribble";

import Modal from "./Modal";

// The Read box — what the Literate tag actually does with a letter nobody else
// can make sense of. See docs/systemdocs/BIRD.md.
//
// The ONE control on the Actions grid that files no Request, calls no server
// action and writes nothing at all. It is a pure local transform: paste the
// runes, read the words. That is deliberate rather than an oversight — the
// letter has already been delivered, and decoding it is a thing a character
// can do, not a thing that happens to the world. Nothing to review, nothing to
// undo, and no reason to make a player wait on a round trip to read their own
// mail.
//
// Imported by path as @lifeweb/db/lib/gribble, never through the @lifeweb/db
// barrel, which would drag node:fs into this client bundle — the same rule
// LifewebRequestButtons.js follows for lib/lifeweb.
export default function ReadDialog({ open, onClose }) {
  if (!open) return null;
  return <ReadDialogBody onClose={onClose} />;
}

function ReadDialogBody({ onClose }) {
  const [raw, setRaw] = useState("");

  const trimmed = raw.trim();
  // Three states, not two. "Nothing pasted yet" and "that isn't a message" and
  // "that is a message I can't make sense of" all deserve different answers —
  // collapsing them makes an empty box look like a failure.
  const plain = trimmed.length > 0 ? decodeGribble(trimmed) : null;
  const status =
    trimmed.length === 0
      ? "empty"
      : plain !== null
        ? "decoded"
        : looksLikeGribble(trimmed)
          ? "garbled"
          : "notascript";

  return (
    <Modal title="Read" onClose={onClose}>
      <div className="mt-3 flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Paste what you were shown</span>
          <textarea
            rows={4}
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="The whole thing. Anything that isn't script is ignored."
          />
        </label>

        {status === "decoded" && (
          <div className="field">
            <span className="field-label">It says</span>
            {/* Not a textarea: this is read, not edited, and it has to wrap and
                grow with a 900-character letter rather than scroll inside a box. */}
            <p
              className="panel"
              style={{ whiteSpace: "pre-wrap", padding: "0.75rem" }}
            >
              {plain}
            </p>
          </div>
        )}

        {status === "garbled" && (
          <p className="text-sm text-muted">
            This is script, but it&apos;s damaged — something was lost copying
            it. Ask for the whole thing again.
          </p>
        )}

        {status === "notascript" && (
          <p className="text-sm text-muted">
            This isn&apos;t written in any script you know.
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
