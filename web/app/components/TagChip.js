import { formatCost, costColor } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";

export default function TagChip({ tag, quantity = 1 }) {
  // Only a stack says how many; an ordinary tag reads as a bare name, which
  // is every tag outside Items today.
  const stack = quantity > 1 ? quantity : null;
  const groupColor = tag.group?.color ?? null;
  // Minified "cost to add/remove this tag in play" — see
  // Tag.requirement* in schema.prisma. Null when unset, so it's simply
  // omitted rather than rendering an empty line.
  const requirement = formatTagRequirement(tag);

  return (
    <span className="tag-hover" tabIndex={0}>
      <span
        className="chip"
        style={groupColor ? { borderLeftColor: groupColor, borderLeftWidth: 3 } : undefined}
      >
        {tag.name}
        {stack && (
          <span className="text-muted"> &times;{stack}</span>
        )}
      </span>
      <span className="tag-tooltip" role="tooltip">
        <strong>
          {tag.name}
          {stack ? ` \u00d7${stack}` : ""}
        </strong>
        {tag.description && <p>{tag.description}</p>}
        {requirement && <p className="text-muted">{requirement}</p>}
        <span style={{ color: costColor(tag.pointCost) }}>{formatCost(tag.pointCost)} pts</span>
      </span>
    </span>
  );
}
