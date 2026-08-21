import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="wide" title="Character" panels={[[40, 90, 65], [70, 100, 55]]} />;
}
