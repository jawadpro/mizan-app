import type { Metadata, Viewport } from "next";
import { Geist_Mono, Urbanist } from "next/font/google";
import "./globals.css";

const sans = Urbanist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Mizan · Personal finance", template: "%s · Mizan" },
  description: "Calm, private expense tracking, with bank SMS import.",
  robots: { index: false, follow: false },
  applicationName: "Mizan",
  appleWebApp: { capable: true, title: "Mizan", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Older iPhones only open full screen from the home screen with this tag.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ebebeb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0c" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Applies the theme saved on this device before the first paint, so dark mode never flashes light.
const THEME_SCRIPT = `try{var t=localStorage.getItem("mizan.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
