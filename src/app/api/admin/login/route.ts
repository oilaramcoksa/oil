import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const COOKIE='aramco_admin';
function expectedHash(){
  const configured=process.env.ADMIN_PASSWORD_HASH;
  if(configured && /^[a-f0-9]{64}$/i.test(configured)) return configured.toLowerCase();
  const password=process.env.ADMIN_PASSWORD;
  if(!password) return null;
  return createHash('sha256').update(password).digest('hex');
}
export async function POST(req:NextRequest){
  let body:{password?:unknown};
  try{body=await req.json();}catch{return NextResponse.json({error:'invalid_body'},{status:400});}
  const password=typeof body.password==='string'?body.password:'';
  const expected=expectedHash();
  if(!expected||!password||password.length>256) return NextResponse.json({error:'admin_not_configured'},{status:503});
  const actual=createHash('sha256').update(password).digest('hex');
  const ok=timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
  if(!ok) return NextResponse.json({error:'invalid_credentials'},{status:401});
  const nonce=randomBytes(24).toString('hex');
  const cookie=Buffer.from(JSON.stringify({nonce,issuedAt:Date.now()})).toString('base64url');
  const response=NextResponse.json({ok:true});
  response.cookies.set(COOKIE,cookie,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/admin',maxAge:60*60*8});
  // The API authorizer verifies a separate HMAC secret and nonce signature.
  return response;
}
export async function DELETE(){
  const response=NextResponse.json({ok:true});
  response.cookies.set(COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/admin',maxAge:0});
  return response;
}
