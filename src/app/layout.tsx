import type { Metadata, Viewport } from "next";
import { Figtree, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SDAK Church Manager", template: "%s · SDAK Church Manager" },
  description: "Membership records for the Seventh-day Adventist Church Kanyanya.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#174b55" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1d21" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-UG" className={`${figtree.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
