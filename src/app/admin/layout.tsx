import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'لوحة إدارة Aramco Oil',
  description: 'لوحة الإدارة والمتابعة للعبة Aramco Oil',
  manifest: '/admin.webmanifest',
  applicationName: 'Aramco Oil Admin',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Aramco Admin' },
  icons: { icon: '/logo.svg', apple: '/logo.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0d1422',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
