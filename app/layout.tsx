import type { Metadata, Viewport } from "next";
import "./globals.css";
import PWARegister from "./components/PWARegister";

export const metadata: Metadata = {
  title: "DayRhythm — план дня",
  description: "Планировщик дня на круговом 24-часовом циферблате.",
  applicationName: "DayRhythm",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f2ed"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body><PWARegister />{children}</body>
    </html>
  );
}
