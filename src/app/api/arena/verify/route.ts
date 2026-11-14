import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });

  const roundId = req.nextUrl.searchParams.get('roundId');
  if (!roundId || roundId.length > 100) return NextResponse.json({ error: 'invalid_round_id' }, { status: 400 });

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const roundResult = await db.execute({
      sql: 'SELECT * FROM arena_rounds WHERE id=? AND status=\'completed\'',
      args: [roundId],
    });
    const round = roundResult.rows[0];
    if (!round) return NextResponse.json({ error: 'round_not_found' }, { status: 404 });

    const playerEntry = await db.execute({
      sql: 'SELECT telegram_id FROM arena_entries WHERE round_id=? AND telegram_id=?',
      args: [roundId, String(identity.id)],
    });
    if (!playerEntry.rows.length) return NextResponse.json({ error: 'round_not_found' }, { status: 404 });

    const version = Number(round.algorithm_version ?? 0);
    const seed = round.outcome_seed == null ? '' : String(round.outcome_seed);
    const commitment = round.seed_commitment == null ? '' : String(round.seed_commitment);
    if (version !== 1 || !seed || !commitment || !round.outcome_proof_hash) {
      return NextResponse.json({
        verified: false,
        verifiable: false,
        reason: 'legacy_round_without_precommitted_seed',
        algorithmVersion: version,
      }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    const entriesResult = await db.execute({
      sql: 'SELECT telegram_id, amount FROM arena_entries WHERE round_id=? ORDER BY telegram_id',
      args: [roundId],
    });
    const entries = entriesResult.rows.map((row) => ({
      telegram_id: String(row.telegram_id),
      amount: Number(row.amount),
    }));
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const commitmentValid = sha256(seed) === commitment;
    const draw = BigInt('0x' + sha256('aramco-arena-v1:' + roundId + ':' + seed).slice(0, 16)) % 1_000_000_000_000n;
    const houseThreshold = 250_000_000_000n;
    let expectedType: 'house' | 'player' = 'house';
    let expectedWinner: string | null = null;
    let expectedStop = 45;

    if (draw >= houseThreshold) {
      const playerDraw = Number(draw - houseThreshold) / Number(1_000_000_000_000n - houseThreshold);
      const target = playerDraw * total;
      let cumulative = 0;
      const winner = entries.find((entry) => {
        cumulative += entry.amount;
        return target < cumulative;
      }) ?? entries[entries.length - 1];
      expectedType = 'player';
      expectedWinner = winner?.telegram_id ?? null;
      const winnerIndex = entries.findIndex((entry) => entry.telegram_id === expectedWinner);
      const beforeWinner = entries.slice(0, winnerIndex).reduce((sum, entry) => sum + entry.amount, 0);
      const center = 90 + ((beforeWinner + (winner?.amount ?? 0) / 2) / Math.max(total, 1)) * 270;
      expectedStop = (360 - center + 360) % 360;
    }

    const resultMatches =
      expectedType === String(round.winner_type) &&
      expectedWinner === (round.winner_telegram_id == null ? null : String(round.winner_telegram_id)) &&
      Math.abs(expectedStop - Number(round.wheel_stop_degrees ?? 0)) < 0.000001 &&
      total === Number(round.total_entries);

    const canonicalEntries = entries.map((entry) => [entry.telegram_id, entry.amount]);
    const expectedProof = sha256(JSON.stringify({
      version: 1,
      roundId,
      seed,
      winnerType: expectedType,
      winnerId: expectedWinner,
      total,
      stopDegrees: expectedStop,
      entries: canonicalEntries,
    }));
    const proofMatches = expectedProof === String(round.outcome_proof_hash);
    const verified = commitmentValid && resultMatches && proofMatches;

    return NextResponse.json({
      verified,
      verifiable: true,
      algorithm: 'SHA-256 deterministic draw v1',
      seedCommitment: commitment,
      revealedSeed: seed,
      resultProofHash: String(round.outcome_proof_hash),
      commitmentValid,
      resultMatches,
      proofMatches,
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('arena_verify_failed', error);
    return NextResponse.json({ error: 'arena_verification_unavailable' }, { status: 503 });
  }
}
