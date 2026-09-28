import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { RuntimeConfigProvider } from "@/lib/runtime-config";
import { SessionProvider } from "@/lib/session";
import "./globals.css";
import "./player.css";

// Read deployment configuration per request so one image serves every
// environment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "CardForge", template: "%s · CardForge" },
  description:
    "An online card game: build decks, play casual or ranked, and challenge friends.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07111d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const runtime = {
    apiUrl: (
      process.env.CARDFORGE_PUBLIC_API_URL ??
      process.env.NEXT_PUBLIC_MATCH_SERVER_URL ??
      "http://localhost:2567"
    ).replace(/\/$/, ""),
    environment:
      process.env.CARDFORGE_ENVIRONMENT ??
      (process.env.NODE_ENV === "production" ? "production" : "development"),
  };
  return (
    <html lang="en">
      <body>
        <RuntimeConfigProvider value={runtime}>
          <SessionProvider>
            <ThemeProvider>{children}</ThemeProvider>
          </SessionProvider>
        </RuntimeConfigProvider>
      </body>
    </html>
  );
}
