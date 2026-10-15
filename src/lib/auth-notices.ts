// Google sign-in ends in a redirect, so a failure reaches the sign-in or sign-up
// page as an `error` code in the URL. This turns the code into the message to
// show. An unknown code shows nothing: the text never comes from the URL itself.
const NOTICES: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in did not finish. Please try again.",
  google_unverified:
    "Google has not verified that account's email address, so it cannot be used here.",
  google_unavailable: "Google sign-in is not available right now.",
  google_no_account:
    "There is no HeyPay account for that Google account yet. Choose Payer or Merchant, then continue with Google.",
  account_inactive: "This account has been turned off. Contact HeyPay support.",
  too_many_attempts: "Too many attempts. Please wait a moment and try again.",
};

export function authNotice(code: string | string[] | undefined): string | null {
  return typeof code === "string" ? (NOTICES[code] ?? null) : null;
}
