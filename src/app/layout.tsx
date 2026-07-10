import type { Metadata, Viewport } from "next";
import { Playfair_Display, Source_Serif_4 } from "next/font/google";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-headline",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1a1a1a",
};

export const metadata: Metadata = {
  title: {
    default: "DynastyWire — AI-Powered Media Universe for College Football 26",
    template: "%s | DynastyWire",
  },
  description:
    "Your dynasty. Your story. AI-powered media universe for College Football 26 Dynasty Mode. Game recaps, press conferences, social reactions, broadcast shows, and recruiting storylines generated after every game.",
  keywords: [
    "College Football 26",
    "Dynasty Mode",
    "AI",
    "sports media",
    "game companion",
    "CFB",
    "NCAA football",
    "dynasty tracker",
  ],
  authors: [{ name: "DynastyWire" }],
  creator: "DynastyWire",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://dynastywire.com",
    siteName: "DynastyWire",
    title: "DynastyWire — AI-Powered Media Universe for College Football 26",
    description:
      "Every game generates a full news cycle. Articles, press conferences, social reactions, broadcast shows, and recruiting storylines powered by AI.",
  },
  twitter: {
    card: "summary_large_image",
    title: "DynastyWire — AI-Powered Media Universe for College Football 26",
    description:
      "Every game generates a full news cycle. Articles, press conferences, social reactions, broadcast shows, and recruiting storylines powered by AI.",
    creator: "@dynastywire",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        playfair.variable,
        sourceSerif.variable,
        geist.variable,
        "font-sans"
      )}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
