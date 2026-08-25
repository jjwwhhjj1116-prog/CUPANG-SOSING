import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import './globals.css';

const notoSans = Noto_Sans_KR({ variable: '--font-noto', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SourceFlow | 로켓배송 AI 상품등록',
  description: '1688 소싱부터 가격, 이미지, 견적서, Supplier Hub 제안까지 연결하는 로켓셀러 자동화 워크스페이스',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'SourceFlow | 로켓배송 AI 상품등록',
    description: '1688 소싱부터 Supplier Hub 제안까지 연결하는 로켓셀러 자동화',
    images: [{ url: '/og.png', width: 1729, height: 910, alt: 'SourceFlow 자동화 파이프라인' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SourceFlow | 로켓배송 AI 상품등록',
    description: '1688 소싱부터 Supplier Hub 제안까지 연결하는 로켓셀러 자동화',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body className={notoSans.variable}>{children}</body></html>;
}
