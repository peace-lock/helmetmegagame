import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="wide" title="Adjudicate" panels={[[40], [100, 100, 100, 100, 100, 100]]} />;
}
