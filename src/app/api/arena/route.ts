import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { postLedgerEntry } from '@/lib/ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ENTRY = 1000;
const COUNTDOWN_MS = 30_000;
const SPIN_MS = 7_000;
const HOUSE_THRESHOLD = 10_000;

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function safeInt(v: unknown) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= MIN_ENTRY && v <= 1_000_000_000;
}

async function settleExpiredRounds(db: ReturnType<typeof getTurso>) {
  const rounds = await db.execute({
    sql: `SELECT id, status, starts_at, spin_started_at, total_entries
          FROM arena_rounds
          WHERE (status='countdown' AND starts_at <= ?)
             OR (status='spinning' AND spin_started_at <= ?)
          ORDER BY created_at LIMIT 10`,
    args: [Date.now(), Date.now() - SPIN_MS],
  });
  for (const r of rounds.rows) {
    const roundId = String(r.id);
    const status = String(r.status);
    if (status === 'countdown') {
      const started = await db.execute({
        sql: "UPDATE arena_rounds SET status='spinning', spin_started_at=? WHERE id=? AND status='countdown' AND starts_at<=?",
        args: [Date.now(), roundId, Date.now()],
      });
      if (Number(started.rowsAffected) === 0) continue;
    }
    const round = await db.execute({sql:'SELECT * FROM arena_rounds WHERE id=?',args:[roundId]});
    const roundRow = round.rows[0];
    if (!roundRow || String(roundRow.status)!=='spinning') continue;
    const entriesResult = await db.execute({
      sql:`SELECT e.telegram_id,e.amount,p.username,p.first_name,p.last_name
           FROM arena_entries e JOIN players p ON p.telegram_id=e.telegram_id
           WHERE e.round_id=? ORDER BY e.created_at,e.telegram_id`,
      args:[roundId],
    });
    const entries = entriesResult.rows;
    if (entries.length < 2) {
      await db.execute({sql:"UPDATE arena_rounds SET status='cancelled',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='spinning'",args:[roundId]});
      for (const e of entries) {
        await postLedgerEntry({telegramId:String(e.telegram_id),asset:'coins',entryType:'arena_refund',amount:Number(e.amount),idempotencyKey:`arena_refund:${roundId}:${e.telegram_id}`,referenceType:'arena_round',referenceId:roundId});
      }
      continue;
    }
    const total = entries.reduce((n,e)=>n+Number(e.amount),0);
    const playerPool = entries.reduce((n,e)=>n+Number(e.amount),0);
    const forcedHouse = total > HOUSE_THRESHOLD;
    const seed = createHash('sha256').update(roundId).digest('hex');
    let winnerType: 'player'|'house' = 'house';
    let winnerId: string | null = null;
    if (!forcedHouse) {
      const roll = Number.parseInt(seed.slice(0, 8),16) / 0xffffffff;
      // House gets exactly 25%; the remaining 75% is proportional to each player's stake.
      const playerRoll = roll - 0.25;
      if (playerRoll >= 0) {
        const weightedRoll = playerRoll / 0.75 * playerPool;
        let cursor = 0;
        for (const e of entries) {
          cursor += Number(e.amount);
          if (weightedRoll <= cursor) {
            winnerType = 'player';
            winnerId = String(e.telegram_id);
            break;
          }
        }
      }
    }
    const commit = await db.execute({
      sql:`UPDATE arena_rounds SET status='completed',winner_telegram_id=?,winner_type=?,
           winning_amount=?,outcome_seed=?,completed_at=CURRENT_TIMESTAMP
           WHERE id=? AND status='spinning'`,
      args:[winnerId,winnerType,winnerType==='player'?playerPool:0,seed,roundId],
    });
    if (Number(commit.rowsAffected) !== 1) continue;
    if (winnerType === 'player' && winnerId) {
      await postLedgerEntry({telegramId:winnerId,asset:'coins',entryType:'arena_prize',amount:playerPool,idempotencyKey:`arena_prize:${roundId}`,referenceType:'arena_round',referenceId:roundId,metadata:{entries:entries.length}});
    }
    await db.execute({
      sql:"INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)",
      args:[randomUUID(),'system','arena_round_settled','arena_round',roundId,JSON.stringify({winnerType,winnerId,total,entries:entries.length})],
    });
  }
}

function publicEntry(row: Record<string, unknown>) {
 return { telegramId:String(row.telegram_id), username:String(row.username || row.first_name || row.telegram_id), amount:Number(row.amount) };
}

export async function GET(req: NextRequest) {
 const identity=verifiedPlayerFromRequest(req);
 if(!identity) return jsonError('telegram_auth_required',401);
 try {
  await ensureDatabaseSchema();
  const db=getTurso();
  await settleExpiredRounds(db);
  const roundRes=await db.execute({
   sql:"SELECT * FROM arena_rounds WHERE status IN ('open','countdown','spinning') ORDER BY created_at DESC LIMIT 1"
  });
  const round=roundRes.rows[0];
  const walletRes=await db.execute({sql:"SELECT coins_balance FROM player_wallets WHERE telegram_id=?",args:[String(identity.id)]});
  const balance=Number(walletRes.rows[0]?.coins_balance ?? 0);
  if(!round) return NextResponse.json({round:null,balance,entries:[],source:'turso'},{headers:{'Cache-Control':'no-store'}});
  const entriesRes=await db.execute({
   sql:`SELECT e.telegram_id,e.amount,p.username,p.first_name
        FROM arena_entries e JOIN players p ON p.telegram_id=e.telegram_id
        WHERE e.round_id=? ORDER BY e.created_at`,args:[String(round.id)]
  });
  const entries=entriesRes.rows.map(row=>publicEntry(row as Record<string,unknown>));
  return NextResponse.json({
   round:{id:String(round.id),status:String(round.status),startsAt:round.starts_at?Number(round.starts_at):null,spinStartedAt:round.spin_started_at?Number(round.spin_started_at):null,totalEntries:Number(round.total_entries),entriesCount:entries.length,winnerType:round.winner_type?String(round.winner_type):null,winnerTelegramId:round.winner_telegram_id?String(round.winner_telegram_id):null},
   balance,entries,source:'turso'
  },{headers:{'Cache-Control':'no-store'}});
 } catch(e) {
  console.error('arena_state_failed',e); return jsonError('arena_unavailable',503);
 }
}

export async function POST(req: NextRequest) {
 const identity=verifiedPlayerFromRequest(req);
 if(!identity) return jsonError('telegram_auth_required',401);
 let body: {amount?:unknown}; try {body=await req.json();}catch{return jsonError('invalid_body');}
 if(!safeInt(body.amount)) return jsonError('minimum_1000_required');
 const amount=body.amount;
 try {
  await ensureDatabaseSchema();
  const db=getTurso();
  const playerId=String(identity.id);
  const player=await db.execute({sql:"SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",args:[playerId]});
  if(!player.rows.length) return jsonError('player_not_found',404);
  const wallet=await db.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[playerId]});
  if(Number(wallet.rows[0]?.coins_balance ?? 0)<amount) return jsonError('insufficient_balance',409);
  const tx=await db.transaction('write');
  let roundId='';
  try {
   const active=await tx.execute({sql:"SELECT id,status,starts_at FROM arena_rounds WHERE status IN ('open','countdown') ORDER BY created_at DESC LIMIT 1"});
   if(active.rows[0] && Number(active.rows[0].starts_at ?? 0)>0 && Number(active.rows[0].starts_at)<=Date.now()) {
     throw new Error('round_countdown_elapsed');
   }
   if(active.rows[0]) roundId=String(active.rows[0].id);
   else {
     roundId=randomUUID();
     await tx.execute({sql:"INSERT INTO arena_rounds(id,status) VALUES(?,'open')",args:[roundId]});
   }
   const exists=await tx.execute({sql:'SELECT id FROM arena_entries WHERE round_id=? AND telegram_id=?',args:[roundId,playerId]});
   if(exists.rows.length) throw new Error('already_joined');
   const debit=await tx.execute({
     sql:`UPDATE player_wallets SET coins_balance=coins_balance-?,updated_at=CURRENT_TIMESTAMP
          WHERE telegram_id=? AND coins_balance>=?`,
     args:[amount,playerId,amount]
   });
   if(Number(debit.rowsAffected)!==1) throw new Error('insufficient_balance');
   const balanceAfter=Number(wallet.rows[0].coins_balance)-amount;
   await tx.execute({
     sql:`INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
          VALUES(?,?, 'coins','arena_entry',?,?,?,?,?,?)`,
     args:[randomUUID(),playerId,-amount,balanceAfter,'arena_round',roundId,`arena_entry:${roundId}:${playerId}`,JSON.stringify({amount})]
   });
   await tx.execute({
     sql:`INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key)
          VALUES(?,?, 'arena_entry',?,?,?)`,
     args:[randomUUID(),playerId,-amount,JSON.stringify({roundId,amount}),`event:arena_entry:${roundId}:${playerId}`]
   });
   await tx.execute({sql:'INSERT INTO arena_entries(id,round_id,telegram_id,amount) VALUES(?,?,?,?)',args:[randomUUID(),roundId,playerId,amount]});
   const count=await tx.execute({sql:'SELECT COUNT(*) AS n, SUM(amount) AS total FROM arena_entries WHERE round_id=?',args:[roundId]});
   const entriesCount=Number(count.rows[0]?.n ?? 0);
   await tx.execute({sql:'UPDATE arena_rounds SET total_entries=? WHERE id=?',args:[Number(count.rows[0]?.total ?? 0),roundId]});
   if(entriesCount>=2) {
    await tx.execute({sql:"UPDATE arena_rounds SET status='countdown',starts_at=? WHERE id=? AND status='open'",args:[Date.now()+COUNTDOWN_MS,roundId]});
   }
   await tx.commit();
  } catch(e) {await tx.rollback(); throw e;}
  const balanceNow=await db.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[playerId]});
  return NextResponse.json({ok:true,roundId,balance:Number(balanceNow.rows[0]?.coins_balance ?? 0)},{headers:{'Cache-Control':'no-store'}});
 } catch(e) {
  const message=e instanceof Error?e.message:'arena_join_failed';
  if(message==='insufficient_balance') return jsonError('insufficient_balance',409);
  if(message==='already_joined') return jsonError('already_joined',409);
  if(message==='round_countdown_elapsed') return jsonError('round_starting',409);
  console.error('arena_join_failed',e); return jsonError('arena_join_failed',503);
 }
}
