import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { CartBadge } from "@/components/cart/CartClient";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Ground Truth — profit-truth for media buying",
  description:
    "Attributes 90-day back-end LTV to the acquisition cell that bought each subscriber. Platform dashboards grade their own homework; this is the answer key.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 min-h-14 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Link href="/brief" className="order-1 flex items-baseline gap-2 shrink-0">
              <span className="font-semibold tracking-[0.18em] text-sm">GROUND</span>
              <span className="font-display italic text-lg leading-none text-scale">Truth</span>
            </Link>
            <nav className="order-3 w-full sm:w-auto sm:order-2 -mx-1 sm:mx-0 flex items-center gap-1 text-sm">
              <Link
                href="/brief"
                className="px-3 py-1.5 rounded-md text-muted hover:text-foreground hover:bg-raised whitespace-nowrap"
              >
                Morning Brief
              </Link>
              <Link
                href="/explore"
                className="px-3 py-1.5 rounded-md text-muted hover:text-foreground hover:bg-raised whitespace-nowrap"
              >
                Explorer
              </Link>
            </nav>
            <div className="order-2 sm:order-3 ml-auto flex items-center gap-2 sm:gap-3 min-w-0">
              <CartBadge />
              <Link
                href="/methodology"
                className="text-[11px] px-2.5 py-1 rounded-full border border-untapped/40 text-untapped bg-untapped/10 hover:bg-untapped/20 whitespace-nowrap"
                title="Every number here is synthetic by design — click for the full methodology, the planted answer key, and the recovery proof."
              >
                <span className="sm:hidden">⚗ methodology</span>
                <span className="hidden sm:inline">⚗ Synthetic demo data — methodology</span>
              </Link>
            </div>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8">{children}</main>
        <footer className="border-t border-line py-4">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 text-xs text-faint flex flex-col gap-1 sm:flex-row sm:justify-between">
            <span>Ground Truth — read-only profit-truth engine. Drafts proposals; never touches ad platforms.</span>
            <span>agent-ready: /api/mcp</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
