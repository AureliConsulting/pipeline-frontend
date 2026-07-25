import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aureli Campaign Console",
  description: "Internal campaign-processing dashboard for Aureli Automations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-warm text-charcoal antialiased">{children}</body>
    </html>
  );
}
