import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LIMIT = 100;
const REWARD_MICROS = 1210;
const ZONE = '12295910';

function cairoDayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}
function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function ensureTables() {
  const db = getTurso();
  await db.execute("CREATE TABLE IF NOT EXISTS daily_monetag_ad_progress (telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE, day_key TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0 AND views <= 100), paid_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(telegram_id,day_key))");
  await db.execute("CREATE TABLE IF NOT EXISTS daily_monetag_ad_claims (ymid TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE, day_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
}
async function snapshot(telegramId: string, dayKey: string) {
  const db = getTurso();
  const [p, w] = await Promise.all([
    db.execute({ sql: 'SELECT views,paid_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND day_key=?', args: [telegramId,dayKey] }),
    db.execute({ sql: 'SELECT usd_micros FROM player_wallets WHERE telegram_id=?', args: [telegramId] }),
  ]);
  const views = Number(p.rows[0]?.views ?? 0);
  const usdMicros = Number(w.rows[0]?.usd_micros ?? 0);
  return { dayKey, views, limit: LIMIT, remaining: Math.max(0,LIMIT-views), completed: views >= LIMIT && Boolean(p.rows[0]?.paid_at), rewardUsd: '0.00121', usdMicros, usdBalance: (usdMicros/1_000_000).toFixed(6) };
}
export async function GET(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required',401);
  try {
    await ensureDatabaseSchema(); await ensureTables();
    return NextResponse.json(await snapshot(String(user.id),cairoDayKey()),{headers:{'Cache-Control':'no-store, private'}});
  } catch (error) { console.error('daily_monetag_progress_failed',error); return fail('daily_reward_unavailable',503); }
}
export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required',401);
  let body: {ymid?:unknown};
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const ymid = typeof body.ymid === 'string' ? body.ymid : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ymid)) return fail('invalid_ymid');
  const telegramId = String(user.id);
  const dayKey = cairoDayKey();
  try {
    await ensureDatabaseSchema(); await ensureTables();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      const prior = await tx.execute({sql:'SELECT day_key FROM daily_monetag_ad_claims WHERE ymid=? AND telegram_id=?',args:[ymid,telegramId]});
      if (prior.rows.length) {
        await tx.commit();
        return NextResponse.json({ok:true,duplicate:true,progress:await snapshot(telegramId,String(prior.rows[0].day_key))},{headers:{'Cache-Control':'no-store'}});
      }
      const verified = await tx.execute({sql:"SELECT ymid FROM monetag_ad_postbacks WHERE ymid=? AND telegram_id=? AND zone_id=? AND event_type='impression' AND reward_event_type='valued' AND consumed_at IS NULL LIMIT 1",args:[ymid,telegramId,ZONE]});
      if (!verified.rows.length) { await tx.rollback(); return fail('monetag_postback_not_verified',409); }
      const player = await tx.execute({sql:"SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",args:[telegramId]});
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active',403); }
      await tx.execute({sql:'INSERT OR IGNORE INTO daily_monetag_ad_progress(telegram_id,day_key) VALUES(?,?)',args:[telegramId,dayKey]});
      const current = await tx.execute({sql:'SELECT views,paid_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND day_key=?',args:[telegramId,dayKey]});
      const count = Number(current.rows[0]?.views ?? 0);
      if (count >= LIMIT) { await tx.rollback(); return fail('daily_ad_limit_reached',429); }
      await tx.execute({sql:'INSERT INTO daily_monetag_ad_claims(ymid,telegram_id,day_key) VALUES(?,?,?)',args:[ymid,telegramId,dayKey]});
      await tx.execute({sql:'UPDATE monetag_ad_postbacks SET consumed_at=CURRENT_TIMESTAMP WHERE ymid=? AND consumed_at IS NULL',args:[ymid]});
      const next = count + 1;
      await tx.execute({sql:'UPDATE daily_monetag_ad_progress SET views=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND day_key=?',args:[next,telegramId,dayKey]});
      let credited = false;
      if (next === LIMIT && !current.rows[0]?.paid_at) {
        const wallet = await tx.execute({sql:'UPDATE player_wallets SET usd_micros=usd_micros+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING usd_micros',args:[REWARD_MICROS,telegramId]});
        if (!wallet.rows.length) throw new Error('player_wallet_not_found');
        const after = Number(wallet.rows[0].usd_micros);
        const key = 'daily_monetag_usd:' + telegramId + ':' + dayKey;
        await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'usd','daily_ad_reward',?,?,'daily_ad_cycle',?,?,?)",args:[randomUUID(),telegramId,REWARD_MICROS,after,dayKey,key,JSON.stringify({provider:'monetag',zoneId:ZONE,verifiedImpressions:LIMIT,rewardUsd:'0.00121'})]});
        await tx.execute({sql:'UPDATE daily_monetag_ad_progress SET paid_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND day_key=? AND paid_at IS NULL',args:[telegramId,dayKey]});
        credited = true;
      }
      await tx.commit();
      return NextResponse.json({ok:true,credited,rewardUsd:credited?'0.00121':'0',progress:await snapshot(telegramId,dayKey)},{status:201,headers:{'Cache-Control':'no-store'}});
    } catch (error) { await tx.rollback(); throw error; }
  } catch (error) { console.error('daily_monetag_reward_claim_failed',error); return fail('daily_reward_unavailable',503); }
}
