import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const DURATION_MS = 60 * 24 * 60 * 60 * 1000;
const cleanUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const u = new URL(value);
    return (u.hostname === 'youtube.com' || u.hostname.endsWith('.youtube.com') || u.hostname === 'youtu.be') ? u.toString() : null;
  } catch { return null; }
};
async function schema() {
  await ensureDatabaseSchema();
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS shorts_contest (
    id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS shorts_entries (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
    video_url TEXT NOT NULL UNIQUE, video_title TEXT NOT NULL DEFAULT '', declared_views INTEGER NOT NULL DEFAULT 0 CHECK(declared_views>=0),
    previous_rank INTEGER, status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected')),
    last_reported_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`INSERT OR IGNORE INTO shorts_contest(id,starts_at,ends_at) VALUES('main',?,?)`, [Date.now(), Date.now()+DURATION_MS]);
  return db;
}
export async function GET(req: NextRequest) {
  try {
    const db = await schema();
    const contest = await db.execute("SELECT starts_at,ends_at FROM shorts_contest WHERE id='main'");
    const rows = await db.execute(`SELECT e.id,e.telegram_id,e.video_url,e.video_title,e.declared_views,e.previous_rank,e.status,e.last_reported_at,p.username,p.first_name
      FROM shorts_entries e JOIN players p ON p.telegram_id=e.telegram_id
      WHERE e.status='approved' ORDER BY e.declared_views DESC,e.created_at ASC LIMIT 500`);
    const entries = rows.rows.map((r,i)=>({id:String(r.id),telegramId:String(r.telegram_id),name:String(r.username||r.first_name||'Player'),videoUrl:String(r.video_url),title:String(r.video_title||''),views:Number(r.declared_views),rank:i+1,previousRank:r.previous_rank==null?null:Number(r.previous_rank),updatedAt:Number(r.last_reported_at)}));
    const totals = await db.execute("SELECT COUNT(*) AS participants,COALESCE(SUM(declared_views),0) AS views FROM shorts_entries WHERE status='approved'");
    return NextResponse.json({contest:contest.rows[0],participants:Number(totals.rows[0]?.participants||0),totalViews:Number(totals.rows[0]?.views||0),entries,verified:false,refreshSeconds:300},{headers:{'Cache-Control':'no-store'}});
  } catch(e) { console.error('shorts_contest_get_failed',e); return NextResponse.json({error:'contest_unavailable'},{status:503}); }
}
export async function POST(req: NextRequest) {
  const user=verifiedPlayerFromRequest(req);
  if(!user) return NextResponse.json({error:'telegram_auth_required'},{status:401});
  let body: {videoUrl?:unknown;views?:unknown;title?:unknown};
  try { body=await req.json(); } catch { return NextResponse.json({error:'invalid_body'},{status:400}); }
  const videoUrl=cleanUrl(body.videoUrl);
  const views=Number(body.views);
  const title=typeof body.title==='string'?body.title.trim().slice(0,120):'';
  if(!videoUrl||!Number.isSafeInteger(views)||views<0||views>2_000_000_000) return NextResponse.json({error:'invalid_video_or_views'},{status:400});
  try {
    const db=await schema();
    const contest=await db.execute("SELECT ends_at FROM shorts_contest WHERE id='main'");
    if(!contest.rows[0]||Date.now()>=Number(contest.rows[0].ends_at)) return NextResponse.json({error:'contest_ended'},{status:409});
    const owner=await db.execute("SELECT id,telegram_id,created_at FROM shorts_entries WHERE video_url=?",[videoUrl]);
    if(owner.rows.length && String(owner.rows[0].telegram_id)!==String(user.id)) return NextResponse.json({error:'video_already_registered'},{status:409});
    const id=owner.rows.length?String(owner.rows[0].id):randomUUID();
    if(owner.rows.length) {
      const last=await db.execute({sql:'SELECT last_reported_at FROM shorts_entries WHERE id=?',args:[id]});
      if(Date.now()-Number(last.rows[0]?.last_reported_at||0)<300000) return NextResponse.json({error:'update_every_5_minutes'},{status:429});
      // Snapshot current ranks before changing the submitted view count.
      await db.execute(`UPDATE shorts_entries SET previous_rank=(
        SELECT COUNT(*)+1 FROM shorts_entries other
        WHERE other.status='approved' AND (other.declared_views>shorts_entries.declared_views OR
        (other.declared_views=shorts_entries.declared_views AND other.created_at<shorts_entries.created_at))
      ) WHERE status='approved'`);
      await db.execute({sql:'UPDATE shorts_entries SET declared_views=?,video_title=?,last_reported_at=? WHERE id=? AND telegram_id=?',args:[views,title,Date.now(),id,String(user.id)]});
    } else {
      await db.execute({sql:"INSERT INTO shorts_entries(id,telegram_id,video_url,video_title,declared_views,last_reported_at,status) VALUES(?,?,?,?,?,?, 'approved')",args:[id,String(user.id),videoUrl,title,views,Date.now()]});
    }
    return NextResponse.json({ok:true,id,views,verified:false},{headers:{'Cache-Control':'no-store'}});
  } catch(e) { console.error('shorts_contest_post_failed',e); return NextResponse.json({error:'contest_submission_failed'},{status:503}); }
}
