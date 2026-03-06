import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "오사카 택시 요금 계산기 2026 – 즉시 요금 예상",
  description: "실시간으로 정확한 오사카 택시 요금을 계산하세요. 심야 할증과 공항 경로 포함.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
      </body>
    </html>
  );
}
