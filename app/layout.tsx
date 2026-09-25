import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import './globals.css';

const notoSans = Noto_Sans_KR({ variable: '--font-noto', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'YOOFAM PLUS | 로켓배송 AI 상품등록',
  applicationName: 'YOOFAM PLUS',
  icons: { icon: '/favicon.svg' },
  description: '1688 소싱부터 가격, 이미지, 견적서, Supplier Hub 제안까지 연결하는 로켓셀러 자동화 워크스페이스',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'YOOFAM PLUS | 로켓배송 AI 상품등록',
    description: '1688 소싱부터 Supplier Hub 제안까지 연결하는 로켓셀러 자동화',
  },
  twitter: {
    card: 'summary',
    title: 'YOOFAM PLUS | 로켓배송 AI 상품등록',
    description: '1688 소싱부터 Supplier Hub 제안까지 연결하는 로켓셀러 자동화',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body className={notoSans.variable}>{children}</body></html>;
}
