// The ⬢ a row moved, if any. Green for a gain, accent for a loss, em-dash when
// the Move or Request didn't touch resources at all — a 0 and a "didn't apply"
// are different facts and shouldn't render the same.
export default function ResourceDeltaCell({ value }) {
  if (value == null) return <td className="text-muted">—</td>;
  return (
    <td className="whitespace-nowrap" style={{ color: value < 0 ? "var(--accent)" : "var(--positive)" }}>
      {value > 0 ? `+${value}` : value}
    </td>
  );
}
