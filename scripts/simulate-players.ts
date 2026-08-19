/**
 * Plays the game the way a population of real players would, against a real
 * server.
 *
 * This exists because a leaderboard cannot be judged by one person playing well.
 * The questions it answers are ones no unit test can: does a beginner's score
 * land somewhere that feels worth improving on, is the top of the board
 * dominated by one strategy, does a day's spread of scores look like a
 * competition or like noise, and does the whole thing hold up when a hundred
 * people submit at once.
 *
 * Every run here goes through the real HTTP API and is re-simulated server-side,
 * so a bug in scoring, validation or the attempt limit shows up as a rejection
 * rather than as a number that quietly disagrees.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/simulate-players.ts [players] [date]
 */
import { INVENTORY_SIZE, run, type Board, type Placement } from '@fuse/sim';
import {
  CURATION_BUDGET,
  createRng,
  dailyBoard,
  dailyPar,
  dailyTarget,
  puzzleNumber,
  solve,
  utcDate,
} from '@fuse/gen';

const API = process.env.FUSE_API_BASE ?? 'http://localhost:8787';
const MAX_ATTEMPTS = 3;

/**
 * Skill tiers, and what each one is actually doing.
 *
 * The point is not to model human cognition but to produce a realistic *spread*:
 * a leaderboard where everyone scores the same is as broken as one where only a
 * solver can score at all.
 */
type Tier = 'blind' | 'casual' | 'thoughtful' | 'expert';

const POPULATION: { tier: Tier; share: number; effort: number }[] = [
  // Taps pieces down without a plan.
  { tier: 'blind', share: 0.25, effort: 8 },
  // Aims roughly at the nodes; the first idea that looks sensible.
  { tier: 'casual', share: 0.4, effort: 40 },
  // Tries a few arrangements and keeps the best.
  { tier: 'thoughtful', share: 0.28, effort: 160 },
  // Effectively searches; stands in for the handful of people who really dig.
  { tier: 'expert', share: 0.07, effort: 600 },
];

interface PlayerResult {
  tier: Tier;
  handle: string;
  best: number;
  attempts: number;
  rank: number | null;
  rejections: string[];
}

function emptyCells(board: Board): number[] {
  const originIndex = board.originY * board.w + board.originX;
  const out: number[] = [];
  for (let i = 0; i < board.cells.length; i++) {
    if (board.cells[i] === 0 && i !== originIndex) out.push(i);
  }
  return out;
}

/**
 * Produces one attempt at the given skill level.
 *
 * A blind player places a random handful. Everyone else samples `effort`
 * candidate arrangements and keeps their best — which is a crude but honest
 * model of "thinking about it for a while".
 */
function playAttempt(board: Board, tier: Tier, effort: number, seed: number): Placement[] {
  const rng = createRng(seed);
  const cells = emptyCells(board);

  const draw = (): Placement[] => {
    // Real players rarely use every piece; the tiers that think about it use
    // fewer, because a spare piece in the path costs points.
    const count =
      tier === 'blind'
        ? INVENTORY_SIZE
        : 1 + rng.int(INVENTORY_SIZE);
    const chosen: number[] = [];
    let guard = 0;
    while (chosen.length < count && guard < 200) {
      guard++;
      const at = cells[rng.int(cells.length)];
      if (!chosen.includes(at)) chosen.push(at);
    }
    return chosen.map((at, i) => ({
      x: at % board.w,
      y: Math.floor(at / board.w),
      piece: board.inventory[i],
    }));
  };

  let best = draw();
  let bestScore = scoreOf(board, best);
  for (let i = 1; i < effort; i++) {
    const candidate = draw();
    const score = scoreOf(board, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function scoreOf(board: Board, placements: Placement[]): number {
  try {
    return run(board, placements).score;
  } catch {
    return -1;
  }
}

async function post(path: string, body: unknown, token?: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function playOnePlayer(
  board: Board,
  date: string,
  tier: Tier,
  effort: number,
  seed: number
): Promise<PlayerResult> {
  const created = await fetch(`${API}/v1/players`, { method: 'POST' });
  const identity = await created.json();

  const result: PlayerResult = {
    tier,
    handle: identity.handle,
    best: 0,
    attempts: 0,
    rank: null,
    rejections: [],
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const placements = playAttempt(board, tier, effort, seed + attempt * 7919);
    const score = scoreOf(board, placements);
    if (score < 0) continue;

    const res = await post(
      '/v1/runs',
      { date, placements, clientScore: score },
      identity.token
    );

    if (res.status === 200) {
      result.attempts++;
      result.best = Math.max(result.best, score);
      result.rank = res.body.rank;
    } else {
      result.rejections.push(`${res.status} ${res.body?.error?.code ?? '?'}`);
    }

    // A player who already matched the record has no reason to keep going.
    const record = dailyPar(date);
    if (record && result.best >= record) break;
  }
  return result;
}

// ---------------------------------------------------------------------------

const count = Number(process.argv[2] ?? 60);
const date = process.argv[3] ?? utcDate();
const board = dailyBoard(date);
const record = dailyPar(date) ?? 0;
const target = dailyTarget(date) ?? 0;

console.log(`Simulating ${count} players on puzzle #${puzzleNumber(date)} (${date})`);
console.log(`Target: ${target}   ·   Record: ${record}
`);

const roster: { tier: Tier; effort: number }[] = [];
for (const group of POPULATION) {
  const n = Math.max(1, Math.round(count * group.share));
  for (let i = 0; i < n; i++) roster.push({ tier: group.tier, effort: group.effort });
}

const started = Date.now();
const results: PlayerResult[] = [];

// Deliberately concurrent in batches: a real reset spike is not sequential, and
// the attempt limit has to hold under contention.
const BATCH = 12;
for (let i = 0; i < roster.length; i += BATCH) {
  const batch = roster.slice(i, i + BATCH);
  const done = await Promise.all(
    batch.map((p, k) => playOnePlayer(board, date, p.tier, p.effort, (i + k + 1) * 104729))
  );
  results.push(...done);
  process.stdout.write(`  ${results.length}/${roster.length}\n`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const scores = results.map((r) => r.best).sort((a, b) => a - b);
const pct = (q: number) => scores[Math.min(scores.length - 1, Math.floor(scores.length * q))];
const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

console.log(`\nelapsed: ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
console.log('SCORE DISTRIBUTION');
console.log(`  min    ${String(scores[0]).padStart(6)}`);
console.log(`  p25    ${String(pct(0.25)).padStart(6)}`);
console.log(`  median ${String(pct(0.5)).padStart(6)}`);
console.log(`  p75    ${String(pct(0.75)).padStart(6)}`);
console.log(`  max    ${String(scores[scores.length - 1]).padStart(6)}`);
console.log(`  mean   ${String(Math.round(mean)).padStart(6)}`);
console.log(`  target ${String(target).padStart(6)}`);
console.log(`  record ${String(record).padStart(6)}`);
const hitTarget = scores.filter((v) => target > 0 && v >= target).length;
console.log(
  `
  reached the target: ${hitTarget}/${scores.length} (${Math.round((hitTarget / scores.length) * 100)}%)`
);

console.log('\nBY SKILL');
for (const group of POPULATION) {
  const tier = results.filter((r) => r.tier === group.tier);
  if (tier.length === 0) continue;
  const avg = Math.round(tier.reduce((a, r) => a + r.best, 0) / tier.length);
  const hit = tier.filter((r) => target > 0 && r.best >= target).length;
  const zero = tier.filter((r) => r.best === 0).length;
  console.log(
    `  ${group.tier.padEnd(11)} n=${String(tier.length).padStart(3)}  avg=${String(avg).padStart(5)}` +
      `  ${String(Math.round((avg / Math.max(target, 1)) * 100)).padStart(3)}% of target` +
      `  reached-target=${hit}/${tier.length}  scored-zero=${zero}`
  );
}

const rejections = results.flatMap((r) => r.rejections);
console.log('\nINTEGRITY');
console.log(`  submissions accepted : ${results.reduce((a, r) => a + r.attempts, 0)}`);
console.log(`  rejections           : ${rejections.length}`);
if (rejections.length) {
  const byCode = new Map<string, number>();
  for (const r of rejections) byCode.set(r, (byCode.get(r) ?? 0) + 1);
  for (const [code, n] of byCode) console.log(`    ${n}x ${code}`);
}
console.log(`  over-limit players   : ${results.filter((r) => r.attempts > MAX_ATTEMPTS).length}`);

// The leaderboard the server actually serves, which is the real check.
const board_ = await fetch(`${API}/v1/leaderboard/${date}`).then((r) => r.json());
console.log(`\nLEADERBOARD (server): ${board_.top.length} players`);
for (const entry of board_.top.slice(0, 5)) {
  console.log(`  ${String(entry.rank).padStart(3)}. ${entry.handle.padEnd(14)} ${entry.score}`);
}

// A solver's best, for reference — nobody in the population should beat it by
// much, and if everyone does, the target is wrong.
const reference = solve(board, CURATION_BUDGET).par;
console.log(`\nreference solver: ${reference}`);
const overshoot = results.filter((r) => r.best > reference).length;
console.log(`players above the reference: ${overshoot}`);
