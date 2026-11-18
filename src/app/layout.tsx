import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { MonetagInAppAds } from "@/components/aram/MonetagInAppAds";
import Script from "next/script";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL
  ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : process.env.VERCEL_URL
      ? new URL(`https://${process.env.VERCEL_URL}`)
      : undefined;

export const metadata: Metadata = {
  metadataBase: siteOrigin,
  title: {
    default: "Aramco Oil – لعبة تعدين النفط وجمع العملات على تيليجرام",
    template: "%s | Aramco Oil",
  },
  description: "اكتشف Aramco Oil، لعبة تيليجرام تفاعلية لمحاكاة ضخ النفط وجمع العملات الافتراضية وإكمال المهام وترقية المعدات والتنافس مع اللاعبين. تجربة ألعاب ترفيهية وليست تعدينًا حقيقيًا أو استثمارًا.",
  applicationName: "Aramco Oil",
  keywords: [
    "Aramco Oil", "aramcooil", "لعبة تعدين النفط", "لعبة تعدين", "ألعاب تيليجرام",
    "لعبة تيليجرام", "ألعاب العملات", "جمع العملات", "لعبة جمع العملات",
    "محاكاة تعدين", "لعبة ضخ النفط", "Telegram mining game", "Telegram game",
    "oil mining game", "tap to earn game", "virtual coins game", "crypto games",
  ],
  authors: [{ name: "Aramco Oil" }],
  creator: "Aramco Oil",
  publisher: "Aramco Oil",
  category: "games",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "Aramco Oil – لعبة تعدين النفط وجمع العملات",
    description: "لعبة تيليجرام تفاعلية لمحاكاة ضخ النفط وجمع العملات الافتراضية وترقية المعدات.",
    siteName: "Aramco Oil",
    type: "website",
    locale: "ar_EG",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aramco Oil – لعبة تيليجرام",
    description: "اضخ النفط الافتراضي، اجمع العملات، أكمل المهام وطوّر معداتك داخل لعبة Aramco Oil.",
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
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <Script src="https://cdn.tgads.space/assets/js/adexium-widget.min.js" strategy="afterInteractive" />
        <Script src="https://libtl.com/sdk.js" data-zone="12295910" data-sdk="show_12295910" strategy="afterInteractive" />
      </head>
      <body className="antialiased bg-background text-foreground aram-bg">
        <MonetagInAppAds />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
