import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Production origin: Open Graph/Twitter image URLs must be absolute, and
// link previews should always point at the live site (even when shared from
// a preview deployment).
const SITE_URL = "https://neuron.ruturaj.xyz";
const TITLE = "Neuron — Shared backend services behind one API key";
const DESCRIPTION =
  "Neuron is the shared backend for the apps you build: short links, email notifications, and more, all reachable behind a single API key, with every call logged automatically.";
const OG_IMAGE = {
  url: "/images/neuron.png",
  width: 1920,
  height: 1440,
  alt: "Neuron dashboard showing API usage by service over the last 30 days",
  type: "image/png",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Neuron",
  },
  description: DESCRIPTION,
  applicationName: "Neuron",
  keywords: [
    "API keys",
    "URL shortener",
    "email notifications",
    "usage analytics",
    "backend platform",
    "NestJS",
    "Next.js",
  ],
  authors: [{ name: "Ruturaj Chaubey", url: "https://ruturaj.xyz" }],
  creator: "Ruturaj Chaubey",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Neuron",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  // Matches --canvas in globals.css (the dashboard is light-only).
  themeColor: "#f6f7f9",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-fg">
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
