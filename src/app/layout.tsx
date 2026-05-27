import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Requiem — Bash script funeral",
  description:
    "Migrate dangerous bash scripts into safe, auditable SuperPlane workflows.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text">{children}</body>
    </html>
  );
}
