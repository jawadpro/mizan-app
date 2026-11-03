import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pocketbook · Personal finance", template: "%s · Pocketbook" },
  description: "Calm, private expense tracking in PKR, with bank SMS import.",
  robots: { index: false, follow: false },
  applicationName: "Pocketbook",
  appleWebApp: { capable: true, title: "Pocketbook", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Older iPhones only open full screen from the home screen with this tag.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { themeColor: "#f6f1e7", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
