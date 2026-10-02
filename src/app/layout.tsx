import type { Metadata, Viewport } from "next";
import { Figtree, IBM_Plex_Mono } from "next/font/google";
import { cookies } from "next/headers";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang="en-UG" className={`${figtree.variable} ${plexMono.variable}`} data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
