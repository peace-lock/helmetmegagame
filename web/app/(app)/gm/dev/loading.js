import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage title="Dev Panel" panels={[[55, 80], [55, 90], [60, 100, 70]]} />;
}
