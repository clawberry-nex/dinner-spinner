import type { Metadata, Viewport } from "next";
import { Spectral, Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import { ThemeProvider, themeScript } from "./_components/theme-provider";
import { RootShell } from "./_components/root-shell";
import { Pwa } from "./_components/pwa";
import { auth } from "@/lib/auth";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });
const spectral = Spectral({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-spectral",
  display: "swap",
});
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? "http://localhost:3000"),
  title: "Dinner Spinner",
  description: "Pick a dinner, scale the recipe, build a shopping list.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Dinner",
    statusBarStyle: "default",
  },
  icons: {
    // The browser-tab favicon comes from the file-convention app/icon.svg +
    // app/favicon.ico — the simplified glyph that stays legible at 16px. The
    // detailed spinner wheel lives in the PWA manifest (icon-192/512) and the
    // apple-touch icon below, where there's room for it.
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Dinner Spinner",
    title: "Dinner Spinner",
    description: "Pick a dinner, scale the recipe, build a shopping list.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  // Dark-first identity — the app defaults to the warm dark palette regardless
  // of OS preference, so the browser chrome should match.
  themeColor: "#15110E",
  // viewport-fit=cover lets the app extend under the iOS home indicator
  // and the Android gesture nav; env(safe-area-inset-bottom) on the
  // TabBar keeps the tappable content above them.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The middleware redirects most anon traffic to /auth/signin already, but
  // the public-profile and public-dish reads (and the sign-in page itself)
  // render without a session. Pass that down so the tab bar can decide
  // whether to render — a visitor on a shared link shouldn't see the app
  // chrome.
  const session = await auth();
  const isSignedIn = !!(session?.user as { id?: string } | undefined)?.id;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${schibsted.variable} ${spectral.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-[100dvh] overflow-hidden bg-bg text-text">
        <ThemeProvider>
          <RootShell isSignedIn={isSignedIn}>{children}</RootShell>
          <Pwa />
        </ThemeProvider>
      </body>
    </html>
  );
}
