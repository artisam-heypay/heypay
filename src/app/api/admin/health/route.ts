import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { checkHealth } from "@/server/admin/health";

export const GET = route(async () => {
  await requireRole("ADMIN");
  const health = await checkHealth();
  return json(health, health.status === "down" ? 503 : 200);
});
