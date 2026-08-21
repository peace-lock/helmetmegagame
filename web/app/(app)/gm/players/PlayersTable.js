"use client";

import { useMemo, useState } from "react";
import { sendGmMessage } from "../actions";
import CharacterLink from "../../../components/CharacterLink";
import FactionLink from "../../../components/FactionLink";

export default function PlayersTable({ characters }) {
  const [zoneFilter, setZoneFilter] = useState("");
  const [factionFilter, setFactionFilter] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [composerOpen, setComposerOpen] = useState(false);

  const zones = useMemo(
    () => [...new Set(characters.map((c) => c.zoneName).filter(Boolean))].sort(),
    [characters],
  );
  const factions = useMemo(
    () => [...new Set(characters.map((c) => c.factionName).filter(Boolean))].sort(),
    [characters],
  );

  const filtered = characters.filter(
    (c) =>
      (!zoneFilter || c.zoneName === zoneFilter) &&
      (!factionFilter || c.factionName === factionFilter),
  );

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">Zone</span>
          <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="">All</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Faction</span>
          <select value={factionFilter} onChange={(e) => setFactionFilter(e.target.value)}>
            <option value="">All</option>
            {factions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={selected.size === 0}
          onClick={() => setComposerOpen((open) => !open)}
        >
          Message selected ({selected.size})
        </button>
      </div>

      {composerOpen && selected.size > 0 && (
        <form
          action={sendGmMessage}
          className="panel flex flex-col gap-3 p-4"
          onSubmit={() => {
            setComposerOpen(false);
            setSelected(new Set());
          }}
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="characterId" value={id} />
          ))}
          <label className="field">
            <span className="field-label">Message ({selected.size} recipient{selected.size === 1 ? "" : "s"}, sent from Lifeweb)</span>
            <textarea name="message" rows={3} required />
          </label>
          <button type="submit" className="btn self-start">
            Send
          </button>
        </form>
      )}

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Role</th>
              <th>Faction</th>
              <th>Zone</th>
              <th>Status</th>
              <th>Cursed</th>
              <th>Resources ⬢</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`Select ${c.name}`}
                  />
                </td>
                <td>
                  <CharacterLink characterId={c.id} name={c.name} isGm />
                </td>
                <td>{c.roleTitle ?? "-"}</td>
                <td>
                  <FactionLink factionId={c.factionId} name={c.factionName || "-"} />
                </td>
                <td>{c.zoneName || "-"}</td>
                <td>{c.status}</td>
                <td style={{ color: c.cursed ? "var(--accent)" : "var(--muted)" }}>
                  {c.cursed ? "Cursed" : "-"}
                </td>
                <td>{c.resources}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-muted">
                  No characters match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
