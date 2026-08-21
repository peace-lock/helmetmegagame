"use client";

import { Fragment, useMemo, useState } from "react";
import { useTableState, SortHeader, FilterBar } from "./tableUtils";
import MessageCell, { MessageComposerRow } from "./MessageRow";
import IconButton from "@/app/components/IconButton";
import CharacterLink from "@/app/components/CharacterLink";
import ResourceDeltaCell from "./ResourceDeltaCell";
import { EditIcon, EyeIcon } from "@/app/components/icons";

const COL_COUNT = 11;

// Passed is the untouched default and stays plain; both GM verdicts are red,
// because either one means "this didn't stand as the player made it".
const STATUS_COLORS = {
  Passed: "var(--text)",
  Edited: "var(--accent)",
  Undone: "var(--accent)",
};

// A Feed Person request tops up the Lifeweb but deliberately leaves its
// target alive — a GM has to do the killing. Until the request is resolved
// the whole row burns red, so it can't be scrolled past.
function awaitingKill(row) {
  return row.type === "FEED_PERSON" && row.statusLabel === "Passed" && !row.effect?.killed;
}

const FILTER_DEFS = [
  { key: "turn", label: "Turn", value: (r) => r.turnLabel },
  { key: "faction", label: "Faction", value: (r) => r.factionName },
  { key: "type", label: "Type", value: (r) => r.typeLabel },
  { key: "status", label: "Status", value: (r) => r.statusLabel },
];

const SEARCH_FIELDS = [
  (r) => r.characterName,
  (r) => r.discordUsername,
  (r) => r.reason,
  (r) => r.summary,
  (r) => r.gmNotes,
];

export default function RequestsTable({ requests, onReview, onView }) {
  const [messagingId, setMessagingId] = useState(null);
  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const { query, setQuery, filters, setFilters, sort, toggleSort, options, visible } = useTableState({
    rows: requests,
    filterDefs,
    searchFields,
    initialSort: { key: "createdAtMs", dir: "desc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        searchLabel="Search requests"
      />

      <div className="panel table-scroll">
        <table className="data-table" style={{ minWidth: "1100px" }}>
          <thead>
            <tr>
              <th scope="col" style={{ width: "1%" }}>
                <span className="sr-only">Review</span>
              </th>
              <th scope="col" style={{ width: "1%" }}>
                <span className="sr-only">Message</span>
              </th>
              <th scope="col" style={{ width: "1%" }}>
                <span className="sr-only">View</span>
              </th>
              <SortHeader label="Turn" sortKey="turnNumber" sort={sort} onSort={toggleSort} />
              <SortHeader label="Character" sortKey="characterName" sort={sort} onSort={toggleSort} />
              <SortHeader label="Discord" sortKey="discordUsername" sort={sort} onSort={toggleSort} />
              <SortHeader label="Faction" sortKey="factionName" sort={sort} onSort={toggleSort} />
              <SortHeader label="Type" sortKey="typeLabel" sort={sort} onSort={toggleSort} />
              <th scope="col" style={{ minWidth: "22rem" }}>
                Reason
              </th>
              <SortHeader label="Status" sortKey="statusLabel" sort={sort} onSort={toggleSort} />
              <SortHeader label="Resources" sortKey="resourceDelta" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr style={awaitingKill(row) ? { color: "var(--accent)" } : undefined}>
                  <td>
                    <IconButton icon={EditIcon} label="Review this request" onClick={() => onReview?.(row)} />
                  </td>
                  <MessageCell
                    characterId={row.characterId}
                    open={messagingId === row.characterId}
                    onToggle={setMessagingId}
                  />
                  <td>
                    <IconButton icon={EyeIcon} label="View this request" onClick={() => onView?.(row)} />
                  </td>
                  <td className="whitespace-nowrap">{row.turnLabel}</td>
                  <td className="whitespace-nowrap">
                    <CharacterLink characterId={row.characterId} name={row.characterName} isGm />
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {row.discordUsername}
                  </td>
                  <td className="whitespace-nowrap">{row.factionName || "—"}</td>
                  <td className="whitespace-nowrap">
                    {awaitingKill(row) ? `☠ ${row.typeLabel}` : row.typeLabel}
                  </td>
                  <td>
                    <span className="block">{row.reason}</span>
                    <span className="mt-1 block text-xs text-muted">
                      {row.summary}
                      {row.gmNotes ? ` · ${row.gmNotes}` : ""}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap"
                    style={{ color: STATUS_COLORS[row.statusLabel] ?? "var(--text)" }}
                  >
                    {row.statusLabel}
                  </td>
                  <ResourceDeltaCell value={row.resourceDelta} />
                </tr>
                {messagingId === row.characterId && (
                  <MessageComposerRow
                    characterId={row.characterId}
                    characterName={row.characterName}
                    colSpan={COL_COUNT}
                    onDone={() => setMessagingId(null)}
                  />
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="text-center text-muted">
                  No requests match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
