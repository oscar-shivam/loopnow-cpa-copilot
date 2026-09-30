import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loopnow CPA Copilot",
  description: "Canadian bookkeeping and GST/HST compliance workflow",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
