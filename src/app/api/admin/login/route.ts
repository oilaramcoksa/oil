import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const COOKIE='aramco_admin';
function configuredHash(){
  const hash=process.env.ADMIN_PASSWORD_HASH;
  if(hash && /^[a-f0-9]{64}$/i.test(hash)) return hash.toLowerCase();
  const password=process.env.ADMIN_PASSWORD;
  return password ? createHash('sha256').update(password).digest('hex') : null;
}
function sessionToken(){
  const secret=process.env.ADMIN_SESSION_SECRET;
  if(!secret || secret.length<32) return null;
  const nonce=randomBytes(32).toString('hex');
  const issued=String(Date.now());
  const payload=`${issued}.${nonce}`;
  const signature=createHmac('sha256',secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}
export async function POST(req:NextRequest){
  let body:{password?:unknown};
  try{body=await req.json();}catch{return NextResponse.json({error:'invalid_body'},{status:400});}
  const password=typeof body.password==='string'?body.password:'';
  const expected=configuredHash();
  if(!expected||!process.env.ADMIN_SESSION_SECRET||process.env.ADMIN_SESSION_SECRET.length<32)
    return NextResponse.json({error:'admin_not_configured'},{status:503});
  if(!password||password.length>256) return NextResponse.json({error:'invalid_credentials'},{status:401});
  const actual=createHash('sha256').update(password).digest('hex');
  if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')))
    return NextResponse.json({error:'invalid_credentials'},{status:401});
  const value=sessionToken();
  if(!value) return NextResponse.json({error:'admin_session_not_configured'},{status:503});
  const response=NextResponse.json({ok:true});
  response.cookies.set(COOKIE,value,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/admin',maxAge:60*60*8});
  return response;
}
export async function DELETE(){
  const response=NextResponse.json({ok:true});
  response.cookies.set(COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/admin',maxAge:0});
  return response;
}
