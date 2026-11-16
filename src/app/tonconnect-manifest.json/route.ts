import { NextRequest, NextResponse } from 'next/server';
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    url: origin,
    name: 'ARMCO OIL',
    iconUrl: origin + '/icon-192.png',
    termsOfUseUrl: origin,
    privacyPolicyUrl: origin,
  }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
