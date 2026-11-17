import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function ensureTipsSchema() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS player_special_parts (
    telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
    part_id TEXT NOT NULL, purchased_at INTEGER NOT NULL, expires_at INTEGER,
    payment_id TEXT NOT NULL UNIQUE, usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
    PRIMARY KEY(telegram_id,part_id,payment_id)
  )`);
}
export async function GET(req: NextRequest) {
  const player = verifiedPlayerFromRequest(req);
  if (!player) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema(); await ensureTipsSchema();
    const db = getTurso();
    const rows = await db.execute({sql:"SELECT COALESCE(SUM(MAX(0,3-usage_count)),0) AS remaining FROM player_special_parts WHERE telegram_id=? AND part_id='plane_tips'",args:[String(player.id)]});
    return NextResponse.json({remaining:Number(rows.rows[0]?.remaining ?? 0)},{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    console.error('plane_tips_balance_failed',error);
    return fail('recommendation_unavailable',503);
  }
}
export async function POST(req: NextRequest) {
  const player = verifiedPlayerFromRequest(req);
  if (!player) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema(); await ensureTipsSchema();
    const db = getTurso();
    const now = Date.now();
    const round = await db.execute({sql:"SELECT id,status,betting_ends_at FROM crash_rounds ORDER BY created_at DESC,rowid DESC LIMIT 1"});
    if (!round.rows.length || String(round.rows[0].status)!=='countdown' || Number(round.rows[0].betting_ends_at)<=now) return fail('round_not_open',409);
    const tx = await db.transaction('write');
    try {
      const owned = await tx.execute({sql:"SELECT payment_id,usage_count FROM player_special_parts WHERE telegram_id=? AND part_id='plane_tips' AND usage_count<3 ORDER BY purchased_at,payment_id LIMIT 1",args:[String(player.id)]});
      if (!owned.rows.length) { await tx.rollback(); return fail('no_recommendations',403); }
      const purchaseId=String(owned.rows[0].payment_id);
      const used=Number(owned.rows[0].usage_count);
      const updated=await tx.execute({sql:"UPDATE player_special_parts SET usage_count=usage_count+1 WHERE telegram_id=? AND part_id='plane_tips' AND payment_id=? AND usage_count=? AND usage_count<3 RETURNING usage_count",args:[String(player.id),purchaseId,used]});
      if (!updated.rows.length) { await tx.rollback(); return fail('recommendation_conflict',409); }
      const history=await tx.execute({sql:"SELECT crash_multiplier FROM crash_rounds WHERE status='crashed' AND id<>? ORDER BY created_at DESC,rowid DESC LIMIT 10",args:[String(round.rows[0].id)]});
      const values=history.rows.map(row=>Number(row.crash_multiplier)).filter(value=>Number.isFinite(value)&&value>=1);
      const sample=values.length;
      const instantCount=values.filter(value=>value<=1).length;
      const earlyCount=values.filter(value=>value<=2.9).length;
      let advice:'no_entry'|'high_risk'|'potential_entry';
      if(sample>=3 && instantCount>=1) advice='no_entry';
      else if(sample>=5 && earlyCount/sample>=0.7) advice='high_risk';
      else advice='potential_entry';
      const remainingRows=await tx.execute({sql:"SELECT COALESCE(SUM(MAX(0,3-usage_count)),0) AS remaining FROM player_special_parts WHERE telegram_id=? AND part_id='plane_tips'",args:[String(player.id)]});
      await tx.execute({sql:"INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'plane_tip_used',0,?,?)",args:[randomUUID(),String(player.id),JSON.stringify({roundId:String(round.rows[0].id),purchaseId,advice,sample,instantCount,earlyCount}),`plane_tip:${purchaseId}:${used+1}`]});
      await tx.commit();
      return NextResponse.json({advice,remaining:Number(remainingRows.rows[0]?.remaining??0),sampleSize:sample,instantCount,earlyCount,roundId:String(round.rows[0].id)},{headers:{'Cache-Control':'no-store'}});
    } catch(error) {
      await tx.rollback();
      throw error;
    }
  } catch(error) {
    console.error('plane_tip_generate_failed',error);
    return fail('recommendation_unavailable',503);
  }
}
