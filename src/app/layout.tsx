import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CrmBootSplashDismiss } from "@/components/pwa/crm-boot-splash-dismiss";
import {
  CrmBootSplashShell,
  CRM_BOOT_SPLASH_CRITICAL_CSS,
} from "@/components/pwa/crm-boot-splash-shell";
import { CrmThemeSync } from "@/components/theme/crm-theme-sync";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { I18nProvider } from "@/i18n/provider";
import { CRM_BOOT_SPLASH_INIT_SCRIPT } from "@/lib/pwa/boot-splash-bootstrap";
import {
  CRM_THEME_BOOTSTRAP_SCRIPT,
} from "@/lib/theme/crm-theme-bootstrap";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECHFRONT CRM",
  description: "EchFront CRM — internal client management",
  applicationName: "ECHFRONT CRM",
  icons: {
    icon: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [
      { url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "ECHFRONT",
    statusBarStyle: "default",
    startupImage: [
      {
        url: "/startup/iphone-portrait-1170x2532-light.png",
        media:
          "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/startup/iphone-portrait-1284x2778-light.png",
        media:
          "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={DEFAULT_LOCALE}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <style
          id="crm-boot-splash-critical"
          dangerouslySetInnerHTML={{ __html: CRM_BOOT_SPLASH_CRITICAL_CSS }}
        />
        <script
          id="crm-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: CRM_THEME_BOOTSTRAP_SCRIPT }}
          suppressHydrationWarning
        />
      </head>
      <body className="flex min-h-dvh flex-col app-bg">
        <CrmBootSplashShell />
        <script
          id="crm-boot-splash-init"
          dangerouslySetInnerHTML={{ __html: CRM_BOOT_SPLASH_INIT_SCRIPT }}
          suppressHydrationWarning
        />
        <CrmBootSplashDismiss />
        <CrmThemeSync />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
