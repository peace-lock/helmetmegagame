"use client";

import { useState } from "react";
import IconButton from "@/app/components/IconButton";
import { MessageIcon } from "@/app/components/icons";
import { sendGmMessage } from "../actions";

// The per-row "message this player" affordance, shared by both tables: an
// icon button that expands one extra <tr> holding a composer, rather than
// opening a modal over a table the GM is scanning.
export default function MessageCell({ characterId, open, onToggle }) {
  return (
    <td>
      <IconButton
        icon={MessageIcon}
        label="Message this player"
        aria-expanded={open}
        onClick={() => onToggle(open ? null : characterId)}
      />
    </td>
  );
}

export function MessageComposerRow({ characterId, characterName, colSpan, onDone }) {
  const [sent, setSent] = useState(false);

  return (
    <tr>
      <td colSpan={colSpan}>
        <form
          action={async (formData) => {
            await sendGmMessage(formData);
            setSent(true);
            onDone?.();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="characterId" value={characterId} />
          <label className="field" style={{ flex: "1 1 20rem" }}>
            <span className="field-label">Message to {characterName}</span>
            <textarea name="message" rows={2} required />
          </label>
          <button type="submit" className="btn">
            Send
          </button>
          {sent && (
            <span className="text-xs text-positive">
              Sent.
            </span>
          )}
        </form>
      </td>
    </tr>
  );
}
