import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import { I18nProvider } from "@/lib/i18n";

const THEME_SCRIPT = `try{var t=localStorage.getItem("omniai-theme")||"system",f=localStorage.getItem("omniai-font")||"md";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";document.documentElement.dataset.font=f}catch(e){}`;

export const metadata: Metadata = {
  title: "OmniAI Workspace",
  description: "Bir joyda barcha AI modellar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        {/* Mavzu sahifa chizilishidan OLDIN qo'llanadi: yorug' mavzuda qorong'i "miltillash" bo'lmaydi */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-dvh bg-neutral-900 text-neutral-100">
        <I18nProvider>
          <AuthGate>{children}</AuthGate>
        </I18nProvider>
      </body>
    </html>
  );
}
