import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Deadline Radar",
  description:
    "Personal academic task tracker with tiered deadline reminders.",
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
