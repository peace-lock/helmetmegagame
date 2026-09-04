"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotBuy, depotSell } from "@/app/(app)/depot/actions";
import { FilterBar, TableScroll, SortHeader, useTableState } from "./DataTable";
import Pager from "./Pager";
import RequestDialog from "./RequestDialog";
import TagChip from "./TagChip";

// Module constants, not inline literals: useTableState lists both in the
// dependency arrays of its `options` and `visible` memos, so a fresh array
// each render would recompute the whole filter pass on every keystroke and
// undo the deferred-value work the hook does to keep typing smooth. One
// FILTER_DEFS serves both the hook and the FilterBar, so the two cannot drift.
const SEARCH_FIELDS = [(r) => r.name, (r) => r.description];
const FILTER_DEFS = [{ key: "group", label: "Kind", value: (r) => r.groupName ?? "" }];

// The Depot's wholesale counter: Buy imports off the orbital station, Sell
// Ravenheart's own goods back to it. Two tabs over one table, because they are
// the same shape — a ware, a unit price, a quantity, a confirm.
//
// Nothing here is authoritative. The affordability check below only greys a
// button out; web/app/(app)/depot/actions.js re-reads the price from the
// catalog and re-checks the balance inside the transaction, because a
// disabled input is a hint and not a lock.
export default function DepotCounter({ wares, stock, resources, maxQuantity, disabled }) {
  const [tab, setTab] = useState("buy");
  const buying = tab === "buy";
  const rows = buying ? wares : stock;

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          className={buying ? "btn" : "btn-quiet"}
          onClick={() => setTab("buy")}
        >
          Buy
        </button>
        <button
          type="button"
          className={buying ? "btn-quiet" : "btn"}
          onClick={() => setTab("sell")}
        >
          Sell
        </button>
        <span className="ml-auto self-center text-sm text-muted">
          On hand <span className="mono">{resources} ⬢</span>
        </span>
      </div>

      {/* Remounted per tab with a key, so the search box and page number
          reset between them instead of a Buy-side query silently hiding half
          his inventory the moment he switches to Sell. */}
      <Counter
        key={tab}
        buying={buying}
        rows={rows}
        resources={resources}
        maxQuantity={maxQuantity}
        disabled={disabled}
      />
    </>
  );
}

function Counter({ buying, rows, resources, maxQuantity, disabled }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(null); // the row being confirmed
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState(null);

  // Buy defaults to cheapest first. Sell defaults to what he can actually
  // hand over first — `held desc` — with price ascending inside each half
  // because `rows` already arrives pre-sorted by price and this sort is
  // stable.
  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: buying ? { key: "price", dir: "asc" } : { key: "held", dir: "desc" },
  });

  // A non-stackable ware can only ever be held once, so the stepper is a
  // fixed 1 rather than a control that would only ever be refused.
  const max = open ? (open.stackable ? Math.min(maxQuantity, open.held ?? maxQuantity) : 1) : 1;
  const total = open ? open.price * Math.min(quantity, max) : 0;
  const affordable = buying ? total <= resources : true;

  function ask(row) {
    setOpen(row);
    setQuantity(1);
    setError(null);
  }

  function submit(reason) {
    const n = Math.min(quantity, max);
    const act = buying ? depotBuy : depotSell;
    startTransition(async () => {
      const result = await act({ tagId: open.id, quantity: n, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(null);
      refresh();
    });
  }

  if (!rows.length) {
    return (
      <p className="mt-4 text-sm text-muted">
        {buying
          ? "The Depot has nothing on its shelf. Run npm run db:sync-tags."
          : "The Depot doesn't buy anything."}
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <FilterBar
        filterDefs={FILTER_DEFS}
        filters={table.filters}
        setFilters={table.setFilters}
        options={table.options}
        query={table.query}
        setQuery={table.setQuery}
        searchLabel="Search wares"
      />

      <TableScroll minWidth="34rem">
        <thead>
          <tr>
            <SortHeader label="Ware" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
            {!buying && (
              <SortHeader label="Held" sortKey="held" sort={table.sort} onSort={table.toggleSort} />
            )}
            <SortHeader
              label={buying ? "Cost" : "Pays"}
              sortKey="price"
              sort={table.sort}
              onSort={table.toggleSort}
            />
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((row) => {
            // Sell rows for something he isn't carrying still show the
            // price the station pays — that's the point, a Merchant needs
            // to know what's worth going and getting — but read as a
            // dimmer, un-actionable line next to what's ready to hand over.
            const unavailable = !buying && !row.held;
            return (
              <tr key={row.id} className={unavailable ? "text-muted" : !buying ? "text-accent" : undefined}>
                <td>
                  <TagChip tag={row.tag} />
                </td>
                {!buying && <td className="mono">{row.held}</td>}
                <td className="mono">{row.price} ⬢</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={disabled || pending || unavailable || (buying && row.price > resources)}
                    onClick={() => ask(row)}
                  >
                    {buying ? "Buy" : "Sell"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableScroll>

      <Pager
        page={table.page}
        totalPages={table.totalPages}
        total={table.total}
        unit="wares"
        onPage={table.setPage}
      />

      <RequestDialog
        open={Boolean(open)}
        title={open ? `${buying ? "Buy" : "Sell"} ${open.name}` : ""}
        submitLabel={buying ? `Pay ${total} ⬢` : `Take ${total} ⬢`}
        busy={pending}
        error={error}
        canSubmit={affordable}
        onCancel={() => setOpen(null)}
        onConfirm={submit}
      >
        {open && (
          <>
            {max > 1 && (
              <label className="field">
                <span className="field-label">How many? (up to {max})</span>
                <input
                  type="number"
                  min={1}
                  max={max}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
                />
              </label>
            )}
            <p className="text-sm text-muted">
              {open.price} ⬢ each · <span className="mono">{total} ⬢</span> total
              {buying && !affordable && " — more than you have."}
            </p>
          </>
        )}
      </RequestDialog>
    </div>
  );
}
