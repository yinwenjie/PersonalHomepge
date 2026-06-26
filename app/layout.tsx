import type { Metadata } from "next";
import { AppRuntimeShell } from "@/components/app-runtime-shell";
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
        <AppRuntimeShell>{children}</AppRuntimeShell>
      </body>
    </html>
  );
}
