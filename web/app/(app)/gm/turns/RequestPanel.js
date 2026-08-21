"use client";

import { useState, useTransition } from "react";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import CharacterLink from "@/app/components/CharacterLink";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import { resolveRequest, killRequestTarget } from "./actions";

// The Request Adjudication Panel: a universal top half describing the
// request, then a type-specific bottom half. Adding a RequestType means
// adding one entry to SECTIONS below and one to REQUEST_EFFECTS in
// web/lib/requestEffects.js — nothing else here changes.

function Line({ label, children }) {
  return (
    <p className="text-sm">
      <span className="field-label" style={{ marginRight: 8 }}>
        {label}
      </span>
      {children}
    </p>
  );
}

function SpendField({ value, onChange }) {
  return (
    <label className="field" style={{ width: "12rem" }}>
      <span className="field-label">Resources spent ⬢</span>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function BloodField({ value, onChange }) {
  return (
    <label className="field" style={{ width: "12rem" }}>
      <span className="field-label">Blood added</span>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// "Fine Meal x3" for a stack, a plain name otherwise. Reads the count off
// `effect`, never off live state — same rule as Undo (REQUESTS.md §2).
function stackLabel(effect) {
  const name = effect.tagName ?? "—";
  return (effect.quantity ?? 1) > 1 ? `${name} \u00d7${effect.quantity}` : name;
}

const SECTIONS = {
  FULFILL_DESIRE: {
    heading: "Fulfill Desire",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Desire">{effect.desireText ?? "—"}</Line>
        <Line label="Player claimed">
          {effect.playerClaimedPoints ?? effect.pointsAwarded ?? 0} Tag Points
          {effect.playerClaimedPoints != null && (
            <span className="text-muted"> — now {effect.pointsAwarded ?? 0}</span>
          )}
        </Line>
        <label className="field" style={{ width: "12rem" }}>
          <span className="field-label">Tag Points awarded</span>
          <input
            type="number"
            min="0"
            value={edits.pointsAwarded}
            onChange={(e) => setEdit("pointsAwarded", e.target.value)}
          />
        </label>
        <p className="text-xs text-muted">
          Confirm moves only the difference, so re-scoring twice never double-pays. Undo revokes the
          award even if the balance goes negative, and reopens the Desire.
        </p>
      </>
    ),
  },

  ADD_TAG: {
    heading: "Add Tag",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Tag added">{stackLabel(effect)}</Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(edits.removeTag)}
            onChange={(e) => setEdit("removeTag", e.target.checked)}
          />
          Remove what this request added, but keep the resource cost
        </label>
      </>
    ),
  },

  REMOVE_TAG: {
    heading: "Remove Tag",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Tag removed">{stackLabel(effect)}</Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <p className="text-xs text-muted">
          Undo puts the tag back with its original source and expiry, and refunds the cost.
        </p>
      </>
    ),
  },

  TRANSFER_RESOURCES: {
    heading: "Transfer Resources",
    render: ({ effect }) => (
      <>
        <Line label="Moved">
          {effect.amount} ⬢ from {effect.from?.name ?? "?"} to {effect.to?.name ?? "?"}
        </Line>
        <p className="text-xs text-muted">
          Nothing to edit here — either it stands or you reverse it.
        </p>
      </>
    ),
  },

  TRANSFER_TAG: {
    heading: "Transfer Tag",
    render: ({ effect }) => (
      <>
        <Line label="Handed over">
          {stackLabel(effect)} to {effect.toName ?? "?"}
        </Line>
        <p className="text-xs text-muted">
          Undo moves the tag back to its original holder.
        </p>
      </>
    ),
  },

  DONATE_BLOOD: {
    heading: "Donate Blood",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Bled">
          {effect.targetName ?? "—"}
          {effect.tier ? (
            <span className="text-muted"> · {effect.tier} blood, worth {effect.nominalAmount}</span>
          ) : null}
        </Line>
        <Line label="Pool">
          {effect.bloodBefore ?? 0} → {effect.bloodAfter ?? 0}
        </Line>
        <BloodField value={edits.bloodDelta} onChange={(v) => setEdit("bloodDelta", v)} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(edits.removeDrained)}
            onChange={(e) => setEdit("removeDrained", e.target.checked)}
          />
          Clear their Drained tag but keep the blood
        </label>
        <p className="text-xs text-muted">
          The pool caps at 100, so this edits what actually moved, not what was asked for. Undo draws
          the same amount back and clears Drained.
        </p>
      </>
    ),
  },

  FEED_PERSON: {
    heading: "Feed Person",
    render: ({ effect, edits, setEdit, onKill, killing }) => (
      <>
        <Line label="Fed">{effect.targetName ?? "—"}</Line>
        <Line label="Pool">
          {effect.bloodBefore ?? 0} → {effect.bloodAfter ?? 0}
        </Line>
        <BloodField value={edits.bloodDelta} onChange={(v) => setEdit("bloodDelta", v)} />

        {effect.killed ? (
          <p className="text-sm text-muted">
            ☠ {effect.targetName ?? "They"} has been killed.
          </p>
        ) : (
          <div
            className="flex flex-col gap-2 border-t pt-3"
            style={{ borderColor: "var(--accent)" }}
          >
            <p className="text-sm text-accent">
              ☠ {effect.targetName ?? "This character"} is still alive. Feeding someone to the Lifeweb
              never kills them automatically — read the reason, then do it here.
            </p>
            <button
              type="button"
              className="btn self-start"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              onClick={onKill}
              disabled={killing}
            >
              {killing ? "Working…" : `Kill ${effect.targetName ?? "them"}`}
            </button>
            <p className="text-xs text-muted">
              This deletes their personal Discord role, clears their nickname and marks them Cursed —
              the same thing the character editor does. Undo does not revive them.
            </p>
          </div>
        )}
      </>
    ),
  },

  SET_MOOD: {
    heading: "Set Mood",
    render: ({ effect }) => (
      <>
        <Line label="Mood set to">{effect.mood ?? "NEUTRAL"}</Line>
        {effect.expiresTurn != null && <Line label="Expires">turn {effect.expiresTurn}</Line>}
        <p className="text-xs text-muted">
          Undo restores whatever mood this replaced.
        </p>
      </>
    ),
  },
};

export default function RequestPanel({ request, readOnly = false, onClose }) {
  const effect = request?.effect ?? {};
  const [edits, setEdits] = useState({
    resourcesSpent: String(effect.resourcesSpent ?? 0),
    pointsAwarded: String(effect.pointsAwarded ?? 0),
    bloodDelta: String(effect.bloodDelta ?? 0),
    removeTag: false,
    removeDrained: false,
  });
  const [gmNotes, setGmNotes] = useState(request?.gmNotes ?? "");
  const [error, setError] = useState(null);
  const [killing, setKilling] = useState(false);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard({ enabled: !readOnly });
  const confirm = useConfirm();

  if (!request) return null;
  const section = SECTIONS[request.type];

  function setEdit(key, value) {
    markDirty();
    setEdits((e) => ({ ...e, [key]: value }));
  }

  function run(mode) {
    setError(null);
    startTransition(async () => {
      const res = await resolveRequest({ requestId: request.id, mode, edits, gmNotes });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      onClose();
    });
  }

  // Killing is irreversible and lands on someone else's character, so it sits
  // behind the shared confirm dialog on top of this panel.
  async function onKill() {
    setError(null);
    const ok = await confirm({
      title: `Kill ${effect.targetName ?? "this character"}?`,
      message:
        "This ends their game: the personal Discord role is deleted, the nickname cleared, and Cursed granted. It cannot be undone from here.",
      confirmLabel: "Kill them",
      cancelLabel: "Not yet",
    });
    if (!ok) return;

    setKilling(true);
    try {
      const res = await killRequestTarget({ requestId: request.id });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      onClose();
    } finally {
      setKilling(false);
    }
  }

  const close = () => (readOnly ? onClose() : guardedClose(onClose));

  return (
    <div className="modal-overlay" onClick={() => !pending && close()}>
      <div className="modal-panel" style={{ maxWidth: "36rem" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center justify-between gap-3">
          <h2 className="section-title">{readOnly ? "Request (read only)" : "Request"}</h2>
          <DevCharacterButton characterId={request.characterId} name={request.characterName} />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <Line label="Character">
            <CharacterLink characterId={request.characterId} name={request.characterName} isGm />{" "}
            <span className="text-muted">({request.discordUsername})</span>
          </Line>
          <Line label="Faction">{request.factionName || "—"}</Line>
          <Line label="Turn">{request.turnLabel}</Line>
          <Line label="Type">{request.typeLabel}</Line>
          <Line label="Status">{request.statusLabel}</Line>
          <Line label="Reason">{request.reason}</Line>
          <p className="text-xs text-muted">
            To reduce GM load, players can make big changes.
          </p>
        </div>

        {section && (
          <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="field-label">{section.heading}</h3>
            <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
              <div className="flex flex-col gap-3">
                {section.render({ effect, edits, setEdit, onKill, killing })}
              </div>
            </fieldset>
          </div>
        )}

        <label className="field mt-4">
          <span className="field-label">GM notes</span>
          <textarea
            rows={2}
            value={gmNotes}
            disabled={readOnly}
            onChange={(e) => {
              markDirty();
              setGmNotes(e.target.value);
            }}
          />
        </label>

        {error && (
          <p className="mt-3 text-sm text-accent">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="btn-quiet"
            title="Leave the request as the player made it and discard your edits"
            onClick={close}
            disabled={pending}
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                className="btn-quiet"
                title="Reverse the change entirely and mark the request Undone"
                onClick={() => run("undo")}
                disabled={pending}
              >
                Undo
              </button>
              <button
                type="button"
                className="btn"
                title="Apply your edits and mark the request Edited"
                onClick={() => run("confirm")}
                disabled={pending}
              >
                {pending ? "Working…" : "Confirm"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
