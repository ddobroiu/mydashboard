import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "MyDashboard",
  description: "Reclame, încasări și facturare pentru toate proiectele, într-un singur loc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
