/* eslint-disable @next/next/no-page-custom-font, @next/next/google-font-display */
import type { Metadata } from "next";
import "./globals.css";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";

export const metadata: Metadata = {
  title: "HeyPay",
  description: "Pay any QRPH merchant in the Philippines with your Stellar (XLM) balance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lexend:wght@400;500;600;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0"
        />
      </head>
      <body className="min-h-dvh bg-background font-body text-on-background antialiased">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
