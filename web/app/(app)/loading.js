import PageShell from "@/app/components/PageShell";

// The fallback for any route in this group without its own loading.js. It
// deliberately renders no title: unlike every other skeleton here it cannot
// know which page is arriving, and guessing one would flash the wrong heading.
export default function Loading() {
  return (
    <PageShell>
      <div className="panel animate-pulse p-4" style={{ height: 96 }} />
      <div className="panel animate-pulse p-4" style={{ height: 220 }} />
    </PageShell>
  );
}
