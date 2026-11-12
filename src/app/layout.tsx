import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Aramco Oil — Pump oil · Collect coins",
  description: "Aramco Oil is an entertainment Telegram mini app. Pump oil, complete tasks, invite friends, and upgrade your rig. All in-game numbers are virtual.",
  keywords: ["aramcooil", "telegram mini app", "oil pump game", "tap to earn", "telegram game"],
  authors: [{ name: "aramcooil" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Aramco Oil",
    description: "Pump oil · Collect coins · Telegram mini app",
    siteName: "Aramco Oil",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#ffdcab",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Telegram WebApp SDK */}
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </head>
      <body className="antialiased bg-background text-foreground aram-bg">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
