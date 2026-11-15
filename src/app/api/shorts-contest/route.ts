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
    id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  try { await db.execute("ALTER TABLE shorts_contest ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled'))"); } catch { /* Column already exists. */ }
  await db.execute(`CREATE TABLE IF NOT EXISTS shorts_entries (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
    video_url TEXT NOT NULL UNIQUE, video_title TEXT NOT NULL DEFAULT '', declared_views INTEGER NOT NULL DEFAULT 0 CHECK(declared_views>=0),
    previous_rank INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    last_reported_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`INSERT OR IGNORE INTO shorts_contest(id,starts_at,ends_at) VALUES('main',?,?)`, [Date.now(), Date.now()+DURATION_MS]);
  return db;
}
export async function GET(req: NextRequest) {
  try {
    const db = await schema();
    const contest = await db.execute("SELECT starts_at,ends_at,status FROM shorts_contest WHERE id='main'");
    const contestRow = contest.rows[0] ?? null;
    const visible = !!contestRow && String(contestRow.status ?? 'active') === 'active' && Date.now() < Number(contestRow.ends_at);
    if (req.nextUrl.searchParams.get('mode') === 'status') {
      return NextResponse.json({ visible }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const rows = await db.execute(`SELECT e.id,e.telegram_id,e.video_url,e.video_title,e.declared_views,e.previous_rank,e.status,e.last_reported_at,p.username,p.first_name
      FROM shorts_entries e JOIN players p ON p.telegram_id=e.telegram_id
      WHERE e.status='approved' ORDER BY e.declared_views DESC,e.created_at ASC LIMIT 500`);
    const entries = rows.rows.map((r,i)=>({id:String(r.id),telegramId:String(r.telegram_id),name:String(r.username||r.first_name||'Player'),videoUrl:String(r.video_url),title:String(r.video_title||''),views:Number(r.declared_views),rank:i+1,previousRank:r.previous_rank==null?null:Number(r.previous_rank),updatedAt:Number(r.last_reported_at)}));
    const totals = await db.execute("SELECT COUNT(*) AS participants,COALESCE(SUM(declared_views),0) AS views FROM shorts_entries WHERE status='approved'");
    const user = verifiedPlayerFromRequest(req);
    const mine = user ? await db.execute({sql:"SELECT id,video_url,status,declared_views,created_at FROM shorts_entries WHERE telegram_id=? LIMIT 1",args:[String(user.id)]}) : { rows: [] };
    return NextResponse.json({contest:contestRow,visible,participants:Number(totals.rows[0]?.participants||0),totalViews:Number(totals.rows[0]?.views||0),entries,myEntry:mine.rows[0]??null,refreshSeconds:3600},{headers:{'Cache-Control':'no-store'}});
  } catch(e) { console.error('shorts_contest_get_failed',e); return NextResponse.json({error:'contest_unavailable'},{status:503}); }
}
export async function POST(req: NextRequest) {
  const user=verifiedPlayerFromRequest(req);
  if(!user) return NextResponse.json({error:'telegram_auth_required'},{status:401});
  let body: {videoUrl?:unknown};
  try { body=await req.json(); } catch { return NextResponse.json({error:'invalid_body'},{status:400}); }
  const videoUrl=cleanUrl(body.videoUrl);
  if(!videoUrl || !/(?:youtube\.com\/(?:shorts|watch)|youtu\.be\/)/i.test(videoUrl)) {
    return NextResponse.json({error:'invalid_shorts_url'},{status:400});
  }
  try {
    const db=await schema();
    const contest=await db.execute("SELECT ends_at,status FROM shorts_contest WHERE id='main'");
    if(!contest.rows[0]||String(contest.rows[0].status ?? 'active') !== 'active'||Date.now()>=Number(contest.rows[0].ends_at)) return NextResponse.json({error:'contest_ended'},{status:409});
    const existing=await db.execute({sql:"SELECT id,status FROM shorts_entries WHERE telegram_id=? LIMIT 1",args:[String(user.id)]});
    if(existing.rows.length) return NextResponse.json({error:'one_video_per_player',entry:existing.rows[0]},{status:409});
    const duplicate=await db.execute({sql:"SELECT telegram_id FROM shorts_entries WHERE video_url=? LIMIT 1",args:[videoUrl]});
    if(duplicate.rows.length) return NextResponse.json({error:'video_already_registered'},{status:409});
    const id=randomUUID();
    await db.execute({sql:"INSERT INTO shorts_entries(id,telegram_id,video_url,video_title,declared_views,last_reported_at,status) VALUES(?,?,?,'',0,?,'pending')",args:[id,String(user.id),videoUrl,Date.now()]});
    return NextResponse.json({ok:true,id,status:'pending',message:'تم استلام رابط الفيديو. طلبك قيد مراجعة الإدارة.'},{headers:{'Cache-Control':'no-store'}});
  } catch(e) { console.error('shorts_contest_post_failed',e); return NextResponse.json({error:'contest_submission_failed'},{status:503}); }
}
