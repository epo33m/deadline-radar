import type { Metadata, Viewport } from "next";

import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const webOrigin = (
  process.env.WEB_ORIGIN ?? "https://dr.rapm.space"
).replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(webOrigin),
  title: {
    default: "Deadline Radar",
    template: "%s · Deadline Radar",
  },
  description:
    "Personal academic task tracker with tiered deadline reminders.",
  keywords: [
    "task tracker",
    "deadlines",
    "academic",
    "reminders",
    "calendar",
  ],
  openGraph: {
    title: "Deadline Radar",
    description:
      "Personal academic task tracker with tiered deadline reminders.",
    url: webOrigin,
    siteName: "Deadline Radar",
    locale: "en_US",
    type: "website",
    images: [{ url: "/brand/logo.png", width: 1254, height: 1254 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Deadline Radar",
    description:
      "Personal academic task tracker with tiered deadline reminders.",
    images: ["/brand/logo.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
