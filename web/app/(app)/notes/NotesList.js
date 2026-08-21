"use client";

import { useMemo, useState, useTransition } from "react";
import { unstarNote } from "./actions";
import { useConfirm } from "../../components/ConfirmProvider";

export default function NotesList({ notes }) {
  const confirm = useConfirm();
  const [zoneFilter, setZoneFilter] = useState("");
  const [sort, setSort] = useState("newest");
  const [removed, setRemoved] = useState(new Set());
  const [isPending, startTransition] = useTransition();

  const zones = useMemo(
    () => [...new Set(notes.map((n) => n.zoneName).filter(Boolean))].sort(),
    [notes],
  );

  const visible = notes.filter((n) => !removed.has(n.id));
  const filtered = visible.filter((n) => !zoneFilter || n.zoneName === zoneFilter);
  const sorted = [...filtered].sort((a, b) =>
    sort === "oldest" ? new Date(a.sentAt) - new Date(b.sentAt) : new Date(b.sentAt) - new Date(a.sentAt),
  );

  async function handleUnstar(id) {
    if (!(await confirm({ title: "Unstar this note?", message: "This can't be undone.", confirmLabel: "Unstar" })))
      return;
    setRemoved((prev) => new Set(prev).add(id));
    startTransition(() => {
      unstarNote(id);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">Zone</span>
          <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {sorted.map((note) => (
          <div key={note.id} className="panel flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-bold">{note.characterName}</span>
                <span className="text-xs text-muted">
                  {note.zoneName ?? "-"} · {new Date(note.sentAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => handleUnstar(note.id)}
                disabled={isPending}
                aria-label="Unstar this note"
                title="Unstar"
              >
                ★
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm">{note.content}</p>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="text-sm text-muted">
            No starred messages match these filters.
          </p>
        )}
      </div>
    </div>
  );
}
