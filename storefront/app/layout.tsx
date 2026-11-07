import type { Metadata, Viewport } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-mono", display: "swap" });

const site = process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Hallucinated: drop 1, git reset --hard",
  description: "A streetwear brand run by AI agents. Drop 1: a black tee with > git reset --hard over a line-art map of SF.",
  openGraph: {
    title: "Hallucinated: drop 1",
    description: "> git reset --hard, over a map of SF. A black tee designed, approved and ordered by AI agents.",
    images: ["/back-preview.png"],
  },
};

export const viewport: Viewport = { themeColor: "#2F3B2A" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
