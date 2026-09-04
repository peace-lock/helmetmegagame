"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import { filterTagsByQuery, sortForMode, tagsById as buildTagsById } from "@/lib/characterCreation";
// Both cross-imported from their own route groups, same pattern
// RosterTable.js already uses for bulkTagCharacters/sendGmBroadcast — this
// popup reuses the exact grant and DM plumbing rather than adding new ones.
import { bulkTagCharacters } from "@/app/(app)/gm/actions";
import { sendGmDm } from "@/app/(desk)/gm/players/actions";

// Who wants an antagonist seat, in one place. antagonistOptIns is written
// once at character creation and otherwise unread anywhere in the app
// (see docs/systemdocs/CHARACTERS.md) — this is the first GM-facing surface
// for it.
export default function AntagonistRosterButton({ characters, tags = [] }) {
  const [open, setOpen] = useState(false);
  const [grantOpenId, setGrantOpenId] = useState(null);
  const [messageOpenId, setMessageOpenId] = useState(null);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Antagonist roles ({characters.length})
      </button>
      <Modal open={open} title="Antagonist role opt-ins" onClose={() => setOpen(false)} width="wide">
        <div className="flex flex-col gap-3">
          {characters.length === 0 ? (
            <p className="text-sm text-muted">Nobody has opted into an antagonist role.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {characters.map((c) => (
                <li key={c.id} className="rounded border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong>{c.name}</strong>{" "}
                      <span className="mono text-xs text-muted">
                        {c.username || c.globalName || "not in guild"}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.roleNames.map((name) => (
                          <span key={name} className="chip">
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => {
                          setMessageOpenId(null);
                          setGrantOpenId((id) => (id === c.id ? null : c.id));
                        }}
                      >
                        Grant tag
                      </button>
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => {
                          setGrantOpenId(null);
                          setMessageOpenId((id) => (id === c.id ? null : c.id));
                        }}
                      >
                        Message
                      </button>
                    </div>
                  </div>

                  {grantOpenId === c.id && (
                    <GrantTagStrip
                      tags={tags}
                      characterId={c.id}
                      onDone={() => setGrantOpenId(null)}
                    />
                  )}
                  {messageOpenId === c.id && (
                    <MessageStrip characterId={c.id} onDone={() => setMessageOpenId(null)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}

// A single-character version of RosterTable.js's BulkTagBar — same picker,
// same action, called with one id instead of a selection set.
function GrantTagStrip({ tags, characterId, onDone }) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [tagId, setTagId] = useState("");
  const [result, setResult] = useState(null);

  const sorted = useMemo(() => sortForMode(tags, "group", buildTagsById(tags)), [tags]);
  const matches = useMemo(() => filterTagsByQuery(sorted, query).slice(0, 40), [sorted, query]);

  function changeQuery(next) {
    setQuery(next);
    if (tagId && !filterTagsByQuery(sorted, next).slice(0, 40).some((t) => t.id === tagId)) {
      setTagId("");
    }
  }

  function grant() {
    setResult(null);
    startTransition(async () => {
      const res = await bulkTagCharacters({ characterIds: [characterId], tagId, mode: "grant" });
      if (!res?.ok) {
        setResult({ error: res?.error ?? "Something went wrong." });
        return;
      }
      setResult(res);
      if (!res.failed) onDone();
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">Find a tag</span>
          <input
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder="Name, description, or group"
          />
        </label>
        <label className="field">
          <span className="field-label">Tag to grant</span>
          <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">Choose a tag…</option>
            {matches.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.category}] {t.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={pending || !tagId} onClick={grant}>
          Grant
        </button>
        <button type="button" className="btn-quiet" onClick={onDone} disabled={pending}>
          Close
        </button>
      </div>
      <FormError>{result?.error}</FormError>
      {result?.ok && <p className="text-sm text-muted">{result.tagName}: granted.</p>}
    </div>
  );
}

function MessageStrip({ characterId, onDone }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  function send() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await sendGmDm({ characterId, content: trimmed, source: "gm_dev_panel" });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setSent(true);
      setMessage("");
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <label className="field">
        <span className="field-label">Message (sent from Bascinet)</span>
        <textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={pending || !message.trim()} onClick={send}>
          {pending ? "Sending…" : "Send"}
        </button>
        <button type="button" className="btn-quiet" onClick={onDone} disabled={pending}>
          Close
        </button>
      </div>
      <FormError>{error}</FormError>
      {sent && <p className="text-sm text-muted">Sent.</p>}
    </div>
  );
}
