// src/server/email/send.ts
//
// Outgoing email over Brevo's HTTPS API. Dependency-free: Railway blocks
// outbound SMTP below its Pro plan, and one POST needs no client library.
//
// EMAIL_FROM names a sender confirmed under Senders in the Brevo account. No
// sending domain is needed: without one authenticated in Brevo, the name is
// kept and Brevo swaps the address for one on brevosend.com.
//
// With no BREVO_API_KEY nothing can be sent. Outside production the message is
// printed to the server log instead, so a developer can read a sign-up code
// without an email account. In production that would put codes in the logs, so
// the send fails and the caller reports it.
import "server-only";
import { AppError } from "@/lib/errors";

const API_URL = "https://api.brevo.com/v3/smtp/email";
const SEND_TIMEOUT_MS = 10_000;
const DEFAULT_SENDER_NAME = "HeyPay";

export type Email = { to: string; subject: string; text: string; html: string };

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** The message could not be handed to the email service. Safe to show the user. */
export const emailNotSent = (): AppError =>
  new AppError("EMAIL_NOT_SENT", "We could not send the email. Please try again.", 502);

/** `HeyPay <hello@example.com>` or a bare address, as Brevo's sender object. */
export function parseSender(from: string): { name: string; email: string } | null {
  const named = from.match(/^\s*"?([^"<]*?)"?\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (named) return { name: named[1]?.trim() || DEFAULT_SENDER_NAME, email: named[2]! };
  const bare = from.trim();
  return /^[^<>\s]+@[^<>\s]+$/.test(bare) ? { name: DEFAULT_SENDER_NAME, email: bare } : null;
}

const apiKeyFromEnv = () => process.env.BREVO_API_KEY?.trim() ?? "";
const senderFromEnv = () => parseSender(process.env.EMAIL_FROM ?? "");

/**
 * Whether an email can reach anyone. Outside production it always "can": with
 * no key it is printed to the server log. Pages use this to leave out a form
 * that could only fail.
 */
export function emailEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return !!apiKeyFromEnv() && senderFromEnv() !== null;
}

export async function sendEmail(
  email: Email,
  opts: { apiKey?: string; from?: string; fetchImpl?: FetchImpl } = {},
): Promise<void> {
  const apiKey = opts.apiKey ?? apiKeyFromEnv();
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      // The subject is left out: a sign-up email's subject holds the code.
      console.error("[email] BREVO_API_KEY is not set; email not sent");
      throw emailNotSent();
    }
    console.info(
      `[email] BREVO_API_KEY is not set; not sent.\n  to: ${email.to}\n  subject: ${email.subject}\n\n${email.text}\n`,
    );
    return;
  }

  const sender = opts.from !== undefined ? parseSender(opts.from) : senderFromEnv();
  if (!sender) {
    console.error("[email] EMAIL_FROM is not a sender address; email not sent");
    throw emailNotSent();
  }

  let res: Response;
  try {
    res = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[email] send failed", err);
    throw emailNotSent();
  }
  if (!res.ok) {
    // Brevo's error body names the cause (unconfirmed sender, bad key, an IP it
    // does not recognise) and holds no secret. The recipient address is left
    // out of the log.
    console.error("[email] send refused", res.status, await res.text().catch(() => ""));
    throw emailNotSent();
  }
}
