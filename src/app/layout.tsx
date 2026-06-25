import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getMessages } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const messages = getMessages(DEFAULT_LOCALE);

export const metadata: Metadata = {
  title: messages.common.appName,
  description: "EchFront CRM — internal client management",
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
    >
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
