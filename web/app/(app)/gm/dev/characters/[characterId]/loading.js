import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="narrow" title="Character" panels={[[50, 100, 100, 75]]} />;
}
