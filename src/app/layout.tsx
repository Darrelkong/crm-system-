import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { I18nProvider } from "@/i18n/provider";
import { CrmThemeSync } from "@/components/theme/crm-theme-sync";
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
    icon: [
      { url: "/icons/icon-192.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.svg", type: "image/svg+xml" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "ECHFRONT",
    statusBarStyle: "default",
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
        <script
          id="crm-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: CRM_THEME_BOOTSTRAP_SCRIPT }}
          suppressHydrationWarning
        />
      </head>
      <body className="flex min-h-dvh flex-col app-bg">
        <CrmThemeSync />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
