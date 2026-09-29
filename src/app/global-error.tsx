"use client";
import "./globals.css";
import ErrorPage from "./error";

// Replaces the root layout when the layout itself throws, so it must render its
// own <html> and <body>. Reporting happens inside ErrorPage.
export default function GlobalError(props: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background font-body text-on-background antialiased">
        <ErrorPage {...props} />
      </body>
    </html>
  );
}
