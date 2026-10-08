import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "OmniAI Workspace",
  description: "Bir joyda barcha AI modellar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen bg-neutral-900 text-neutral-100">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
