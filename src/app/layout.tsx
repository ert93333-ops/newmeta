import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "newmeta Hermes",
  description: "메타 광고 크리에이티브 진단, 검증, 초안 승인, 비용 가드 플랫폼"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
