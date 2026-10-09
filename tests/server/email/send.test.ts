import { describe, it, expect, afterEach, vi } from "vitest";
import { emailEnabled, parseSender, sendEmail } from "@/server/email/send";

const EMAIL = { to: "ana@example.com", subject: "Hello", text: "plain", html: "<p>rich</p>" };
const FROM = "HeyPay <hello@heypay.test>";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseSender", () => {
  it("reads a name and an address", () => {
    expect(parseSender("HeyPay <hello@heypay.test>")).toEqual({
      name: "HeyPay",
      email: "hello@heypay.test",
    });
    expect(parseSender('"HeyPay Team" <hello@heypay.test>')).toEqual({
      name: "HeyPay Team",
      email: "hello@heypay.test",
    });
  });

  it("names a bare address HeyPay", () => {
    expect(parseSender(" hello@heypay.test ")).toEqual({
      name: "HeyPay",
      email: "hello@heypay.test",
    });
    expect(parseSender("<hello@heypay.test>")).toEqual({
      name: "HeyPay",
      email: "hello@heypay.test",
    });
  });

  it("reads a value that still has its quotes around it", () => {
    expect(parseSender('"HeyPay <hello@heypay.test>"')).toEqual({
      name: "HeyPay",
      email: "hello@heypay.test",
    });
    expect(parseSender("'hello@heypay.test'")).toEqual({
      name: "HeyPay",
      email: "hello@heypay.test",
    });
  });

  it("refuses text with no address in it", () => {
    expect(parseSender("")).toBeNull();
    expect(parseSender("HeyPay")).toBeNull();
    expect(parseSender("HeyPay <not an address>")).toBeNull();
  });
});

describe("emailEnabled", () => {
  it("needs both a key and a sender in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", FROM);
    expect(emailEnabled()).toBe(false);

    vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
    expect(emailEnabled()).toBe(true);

    vi.stubEnv("EMAIL_FROM", "");
    expect(emailEnabled()).toBe(false);
  });

  it("is on outside production, where the code is printed to the log", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(emailEnabled()).toBe(true);
  });
});

describe("sendEmail", () => {
  it("posts the message to Brevo with the API key", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ messageId: "<1@brevo>" }, { status: 201 }));
    await sendEmail(EMAIL, { apiKey: "xkeysib-test", from: FROM, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { name: "HeyPay", email: "hello@heypay.test" },
      to: [{ email: "ana@example.com" }],
      subject: "Hello",
      textContent: "plain",
      htmlContent: "<p>rich</p>",
    });
  });

  it("takes the key and the sender from the environment", async () => {
    vi.stubEnv("BREVO_API_KEY", "xkeysib-env");
    vi.stubEnv("EMAIL_FROM", "HeyPay <env@heypay.test>");
    const fetchImpl = vi.fn(async () => Response.json({ messageId: "<1@brevo>" }, { status: 201 }));
    await sendEmail(EMAIL, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-env");
    expect(JSON.parse(String(init.body)).sender).toEqual({
      name: "HeyPay",
      email: "env@heypay.test",
    });
  });

  it("fails without calling Brevo when no sender address is set", async () => {
    vi.stubEnv("EMAIL_FROM", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    await expect(sendEmail(EMAIL, { apiKey: "xkeysib-test", fetchImpl })).rejects.toMatchObject({
      code: "EMAIL_NOT_SENT",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails when Brevo refuses the message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
    );
    await expect(
      sendEmail(EMAIL, { apiKey: "xkeysib-test", from: FROM, fetchImpl }),
    ).rejects.toMatchObject({ code: "EMAIL_NOT_SENT", status: 502 });
  });

  it("fails when Brevo cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      sendEmail(EMAIL, { apiKey: "xkeysib-test", from: FROM, fetchImpl }),
    ).rejects.toMatchObject({ code: "EMAIL_NOT_SENT" });
  });

  it("prints the message instead of sending it when no key is set outside production", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    await sendEmail(EMAIL, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(String(info.mock.calls[0]?.[0])).toContain("plain");
  });

  it("refuses to print the message in production, and keeps its subject out of the log", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(sendEmail(EMAIL)).rejects.toMatchObject({ code: "EMAIL_NOT_SENT" });
    expect(info).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("Hello");
  });
});
