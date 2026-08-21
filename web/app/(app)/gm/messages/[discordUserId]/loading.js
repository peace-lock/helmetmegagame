import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="narrow" title="Messages" panels={[[80, 55, 90, 45], [60, 100]]} />;
}
