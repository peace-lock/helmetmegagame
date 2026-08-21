import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage title="Audit Log" panels={[[45], [100, 100, 100, 100, 100]]} />;
}
