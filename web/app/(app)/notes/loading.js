import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="narrow" title="Notes" panels={[[70], [90, 100, 60], [85, 100, 50]]} />;
}
