import { NextResponse } from 'next/server';
export async function GET() {
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://armco-oil.vercel.app';
  return NextResponse.json({
    url: origin,
    name: 'ARMCO OIL',
    iconUrl: origin + '/icon-192.png',
    termsOfUseUrl: origin,
    privacyPolicyUrl: origin,
  }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
