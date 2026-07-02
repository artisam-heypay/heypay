import { checkHealth } from "@/server/admin/health";
import { HealthTiles } from "@/components/admin/HealthTiles";

export const dynamic = "force-dynamic";

export default async function AdminHealthPage() {
  const initial = await checkHealth();
  return (
    <section aria-labelledby="admin-health-heading">
      <h1
        id="admin-health-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        System Health
      </h1>
      <div className="mt-stack-lg">
        <HealthTiles initial={initial} />
      </div>
    </section>
  );
}
