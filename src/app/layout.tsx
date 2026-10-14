import { Pwa } from "./pwa";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FREEZER OS",
  description: "Vaše jedlo, prehľadne.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FREEZER OS" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>
        <Pwa />
        {children}
      </body>
    </html>
  );
}
