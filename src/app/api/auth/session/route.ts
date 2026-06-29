import { route, json } from "@/lib/http";
import { getSessionUser } from "@/server/auth/sessions";

export const GET = route(async () => {
  const user = await getSessionUser();
  return json({ user: user ? { id: user.id, username: user.username, role: user.role } : null });
});
