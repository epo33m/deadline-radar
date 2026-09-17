import { LearnDetail } from "@/components/learn/learn-detail";
import { requireSession } from "@/lib/api/session";

export default async function LearnPage() {
  await requireSession();

  return <LearnDetail />;
}
