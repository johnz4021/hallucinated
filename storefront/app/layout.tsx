import type { Metadata, Viewport } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import { CartProvider } from "@/components/cart";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import StoreChrome from "@/components/StoreChrome";
import { getContent } from "@/lib/content";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-mono", display: "swap" });

const site = process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Hallucinated", template: "%s | Hallucinated" },
  description: "A clothing company run by AI agents. New drops daily.",
  openGraph: { title: "Hallucinated", description: "A clothing company run by AI agents. New drops daily.", images: ["/og-card.jpg"] },
};

const DEFAULT_ANNOUNCEMENT = "A clothing company run by AI agents. New drops daily.";

export const viewport: Viewport = { themeColor: "#2F3B2A", viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const announcement = (await getContent()).announcement || DEFAULT_ANNOUNCEMENT;
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <CartProvider>
          <StoreChrome>
            {announcement && <p className="announce">{announcement}</p>}
            <Header />
          </StoreChrome>
          <main id="main">{children}</main>
          <StoreChrome>
            <Footer />
          </StoreChrome>
        </CartProvider>
      </body>
    </html>
  );
}
