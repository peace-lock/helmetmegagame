// The page chrome every top-level route sits in.
//
// This existed only as a convention before — `mx-auto flex max-w-5xl flex-col
// gap-6 p-6 sm:p-8` plus an `<h1 className="text-2xl font-bold">`, hand-rolled
// on ~15 pages at five different widths (max-w-2xl/3xl/4xl/5xl/6xl). A
// documented convention drifts; a component can't. Widths collapse to three
// named options here, so "how wide is this page" becomes a choice from a menu
// rather than a number someone picks per page.
//
// No "use client" on purpose: this is markup only, so it stays usable from the
// server components every page here is.

const WIDTHS = {
  narrow: "max-w-3xl", // forms and reading-width pages
  default: "max-w-5xl",
  wide: "max-w-6xl", // long GM tables
};

export default function PageShell({ width = "default", children }) {
  return (
    <div className={`mx-auto flex w-full ${WIDTHS[width] ?? WIDTHS.default} flex-col gap-6 p-6 sm:p-8`}>
      {children}
    </div>
  );
}

// `actions` is the slot several pages were already improvising — a button or
// link that belongs beside the title rather than floating in the body.
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// A shaped placeholder bar. Deliberately not text: a skeleton's job is to
// reserve the space the real content will occupy, so the layout doesn't jump
// when it lands.
export function SkeletonBar({ width = "100%", height = 12 }) {
  return (
    <div
      aria-hidden="true"
      style={{ width, height, background: "var(--field-bg)", borderRadius: "var(--r-sm)" }}
    />
  );
}

// The whole of a loading.js. Every skeleton is built from the same PageShell +
// PageHeader as its page, so the two cannot disagree about width or title —
// which they did, everywhere: notes/page.js was max-w-3xl while
// notes/loading.js was max-w-5xl, so every navigation visibly re-flowed.
//
// Pass the page's real title and roughly the panel shape it lands in.
export function SkeletonPage({ width, title, panels = [[70, 100, 45]] }) {
  return (
    <PageShell width={width}>
      <PageHeader title={title} />
      {panels.map((bars, i) => (
        <div key={i} className="panel animate-pulse p-4">
          <div className="flex flex-col gap-3">
            {bars.map((w, j) => (
              <SkeletonBar key={j} width={`${w}%`} />
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  );
}
