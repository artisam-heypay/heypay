import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { checkHealth } from "@/server/admin/health";
import { captureUserEvent } from "@/server/observability/analytics";

export const GET = route(async () => {
  const admin = await requireRole("ADMIN");
  const health = await checkHealth();
  captureUserEvent("admin_health_checked", admin, {
    status: health.status,
    unhealthy: health.components
      .filter((c) => c.status !== "ok")
      .map((c) => c.name)
      .join(","),
  });
  return json(health, health.status === "down" ? 503 : 200);
});
