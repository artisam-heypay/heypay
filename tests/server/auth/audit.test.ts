import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.mock` is hoisted above imports, so the mock's `create` spy is created via
// `vi.hoisted` (also hoisted) rather than a plain top-level const.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/server/db", () => ({ db: { auditLog: { create } } }));

import { audit } from "@/server/auth/audit";

describe("audit", () => {
  beforeEach(() => create.mockReset());

  it("records the action with actor, target, and ip", async () => {
    create.mockResolvedValue({});
    await audit({ actorId: "user_1", action: "auth.login", target: "user_1", ip: "1.2.3.4" });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: "user_1",
        action: "auth.login",
        target: "user_1",
        metadata: undefined,
        ip: "1.2.3.4",
      },
    });
  });

  it("swallows database errors and never throws", async () => {
    create.mockRejectedValueOnce(new Error("db down"));
    let threw = false;
    try {
      await audit({ action: "auth.login.failed" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
