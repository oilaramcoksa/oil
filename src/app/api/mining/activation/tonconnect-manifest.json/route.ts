import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://armcooil.com';
  return NextResponse.json({
    url: origin,
    name: 'ARMCO OIL',
    iconUrl: origin + '/tonconnect-icon.png',
  }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
