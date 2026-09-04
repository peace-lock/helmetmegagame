// Renders a {partysize:N} token (see RichText.js) as a small pill showing the
// live-computed headcount a Cult party goal needs at the current player count.
//
// Deliberately no ⬢: that glyph stands in for the word "Resources" (see the
// Resources glyph section of CLAUDE.md) and a party size is a count of people,
// not a currency. `chip-mono` is doing the same real work it does in
// ResourceChip — numbers belong on the mono face.
export default function PartySizeChip({ value }) {
  return <span className="chip chip-mono">{value}</span>;
}
