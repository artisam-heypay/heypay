import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { enqueueWalletActivation } = vi.hoisted(() => ({ enqueueWalletActivation: vi.fn() }));
vi.mock("@/server/queue/queues", () => ({ enqueueWalletActivation }));

import { requestWalletActivation } from "./activation";

describe("requestWalletActivation", () => {
  beforeEach(() => {
    enqueueWalletActivation.mockReset().mockResolvedValue(undefined);
    process.env.WALLET_SPONSOR_SECRET_ENC = "v1:sponsor";
  });

  afterEach(() => {
    delete process.env.WALLET_SPONSOR_SECRET_ENC;
  });

  it("queues a new payer's wallet", async () => {
    await requestWalletActivation({ id: "user_1", role: "PAYER" });
    expect(enqueueWalletActivation).toHaveBeenCalledWith("user_1");
  });

  it("queues nothing for a merchant, who has no wallet", async () => {
    await requestWalletActivation({ id: "user_2", role: "MERCHANT" });
    expect(enqueueWalletActivation).not.toHaveBeenCalled();
  });

  it("queues nothing without a sponsor account", async () => {
    delete process.env.WALLET_SPONSOR_SECRET_ENC;
    await requestWalletActivation({ id: "user_1", role: "PAYER" });
    expect(enqueueWalletActivation).not.toHaveBeenCalled();
  });

  it("does not fail the sign-up when the queue is unavailable", async () => {
    enqueueWalletActivation.mockRejectedValue(new Error("redis is down"));
    await expect(requestWalletActivation({ id: "user_1", role: "PAYER" })).resolves.toBeUndefined();
  });
});
