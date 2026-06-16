import type { Metadata } from "next";
import { SupabaseAuthProvider } from "@/providers/supabase-auth-provider";
import { UiPreferencesProvider } from "@/providers/ui-preferences-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home",
  description: "Personal browser homepage"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <SupabaseAuthProvider>
          <UiPreferencesProvider>{children}</UiPreferencesProvider>
        </SupabaseAuthProvider>
      </body>
    </html>
  );
}
