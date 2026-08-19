/**
 * Fuse — application controller.
 *
 * The DOM owns the chrome and the canvas owns the board. Screens are plain
 * sections toggled by `show()`, which is enough structure for six screens and
 * a great deal less machinery than a router.
 *
 * Nothing here decides what a score is: that lives in @fuse/sim and is re-run by
 * the server. This file only asks the simulation questions and draws the answers.
 */
import './style.css';
import {
  Piece,
  countNodes,
  run as runSim,
  validatePlacements,
  type Board,
  type Placement,
} from '@fuse/sim';
import { dailyBoard, dailyPar, puzzleNumber, utcDate } from '@fuse/gen';
import {
  BoardView,
  PALETTES,
  PIECE_NAMES,
  drawPieceGlyph,
  paletteById,
  type Palette,
} from './board-view.js';
import {
  MockAdPort,
  MockPurchasePort,
  REWARDS_PER_DAY,
  assertRewardIsFair,
  type AdPort,
  type Product,
  type PurchasePort,
  type Reward,
} from './commerce.js';
import { shareSummary, shareText, verdict } from './share.js';
import { Tutorial } from './tutorial.js';
import * as store from './storage.js';
import { formatScore } from './format.js';

const MAX_ATTEMPTS = 3;

type ScreenName = 'home' | 'game' | 'result' | 'archive' | 'howto' | 'settings' | 'tutorial';

interface Session {
  readonly date: string;
  readonly board: Board;
  /** Practice runs on past boards are unlimited and never leave the device. */
  readonly ranked: boolean;
  placements: Placement[];
  selected: number | null;
  lastResult: { score: number; ignited: number; total: number } | null;
}

// ---------------------------------------------------------------------------
// Element lookup — fail loudly at boot rather than silently later
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const ui = {
  screens: {
    home: el('screen-home'),
    game: el('screen-game'),
    result: el('screen-result'),
    archive: el('screen-archive'),
    howto: el('screen-howto'),
    settings: el('screen-settings'),
    tutorial: el('screen-tutorial'),
  } as Record<ScreenName, HTMLElement>,

  dailyNo: el('daily-no'),
  previewCanvas: el<HTMLCanvasElement>('preview-canvas'),
  metaAttempts: el('meta-attempts'),
  metaBest: el('meta-best'),
  metaStreak: el('meta-streak'),
  metaPar: el('meta-par'),
  btnPlay: el<HTMLButtonElement>('btn-play'),
  dailyDone: el('daily-done'),
  resetNote: el('reset-note'),

  gameNo: el('game-no'),
  gameSub: el('game-sub'),
  scoreLive: el('score-live'),
  boardCanvas: el<HTMLCanvasElement>('board-canvas'),
  comboBadge: el('combo-badge'),
  tray: el('tray'),
  btnUndo: el<HTMLButtonElement>('btn-undo'),
  btnClear: el<HTMLButtonElement>('btn-clear'),
  btnLaunch: el<HTMLButtonElement>('btn-launch'),
  launchHint: el('launch-hint'),
  trayNote: el('tray-note'),

  resultLabel: el('result-label'),
  resultScore: el('result-score'),
  resultDetail: el('result-detail'),
  resultBarFill: el('result-bar-fill'),
  resultBarMark: el('result-bar-mark'),
  resultGap: el('result-gap'),
  resultBestLabel: el('result-best-label'),
  resultParLabel: el('result-par-label'),
  resultShare: el('result-share'),
  btnShare: el<HTMLButtonElement>('btn-share'),
  btnRetry: el<HTMLButtonElement>('btn-retry'),
  offers: el('offers'),

  archiveList: el('archive-list'),
  pieceGuide: el('piece-guide'),
  paletteGrid: el('palette-grid'),
  support: el('support'),
  settingsFoot: el('settings-foot'),
  setReminder: el<HTMLInputElement>('set-reminder'),
  setSound: el<HTMLInputElement>('set-sound'),
  setReduced: el<HTMLInputElement>('set-reduced'),

  toast: el('toast'),

  tutCanvas: el<HTMLCanvasElement>('tut-canvas'),
  tutStep: el('tut-step'),
  tutText: el('tut-text'),
  tutPiece: el('tut-piece'),
  tutPieceCanvas: el<HTMLCanvasElement>('tut-piece-canvas'),
  tutPieceName: el('tut-piece-name'),
  btnTutNext: el<HTMLButtonElement>('btn-tut-next'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const ads: AdPort = new MockAdPort(() => !store.load().adFree);
const purchases: PurchasePort = new MockPurchasePort();

const boardView = new BoardView(ui.boardCanvas);
const previewView = new BoardView(ui.previewCanvas, { preview: true });

let session: Session | null = null;
let today = utcDate();
let palette: Palette = paletteById(store.load().settings.palette);
let audio: AudioContext | null = null;
let toastTimer = 0;
let tutorial: Tutorial | null = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function show(name: ScreenName): void {
  for (const [key, node] of Object.entries(ui.screens)) {
    node.hidden = key !== name;
  }
  if (name === 'game') requestAnimationFrame(() => boardView.resize());
  if (name === 'home') requestAnimationFrame(() => previewView.resize());
  if (name === 'tutorial') requestAnimationFrame(() => tutorial?.resize());
}

/**
 * Runs the first-run tutorial, then hands over to the daily board.
 *
 * Marked done on finish *and* on skip: someone who skips has made a choice, and
 * showing it again would override that choice every launch.
 */
/** Kept next to the tutorial copy it belongs to, so the two cannot drift apart. */
const LESSON =
  'No hay una solución correcta que encontrar: colocas lo que quieras y persigues la puntuación más alta.';

function startTutorial(): void {
  tutorial ??= new Tutorial(
    ui.tutCanvas,
    {
      step: ui.tutStep,
      text: ui.tutText,
      piece: ui.tutPiece,
      pieceCanvas: ui.tutPieceCanvas,
      pieceName: ui.tutPieceName,
      next: ui.btnTutNext,
      skip: el('btn-tut-skip'),
    },
    {
      onFinish: finishTutorial,
      onIgnite: () => blip(700, 0.06, 'triangle', 0.05),
      onScore: (score) => {
        // Prefix rather than replace: the sentence underneath is the whole point
        // of the tutorial, and overwriting it threw away the lesson.
        ui.tutText.textContent = `${formatScore(score)} puntos con una sola pieza. ${LESSON}`;
      },
    }
  );
  tutorial.start();
  show('tutorial');
}

function finishTutorial(): void {
  store.update((d) => {
    d.tutorialDone = true;
  });
  tutorial?.stop();
  renderHome();
  show('home');
}

function toast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toast.hidden = true;
  }, 2200);
}

/**
 * Short synthesised blips. A handful of oscillators beats shipping audio files:
 * no assets to license, nothing to download, and it cannot fail to load.
 */
function blip(freq: number, duration = 0.06, type: OscillatorType = 'sine', gain = 0.05): void {
  if (!store.load().settings.sound) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, audio.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    osc.connect(amp).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  } catch {
    // No audio device, or autoplay policy. Silence is an acceptable outcome.
  }
}

/**
 * Builds an element with text content, never markup.
 *
 * Replaces a handful of innerHTML template literals. None of them were
 * exploitable — every value went in through textContent afterwards — but the
 * pattern invites the mistake: the day someone interpolates a server-supplied
 * handle into one of those templates, it becomes stored XSS. There is no
 * innerHTML left in the client for that mistake to happen in.
 */
function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function renderHome(): void {
  today = utcDate();
  const board = dailyBoard(today);
  const result = store.getResult(today);
  const left = store.attemptsLeft(today, MAX_ATTEMPTS);

  ui.dailyNo.textContent = `#${puzzleNumber(today)}`;
  ui.metaAttempts.textContent = String(left);
  ui.metaBest.textContent = result ? formatScore(result.best) : '—';
  ui.metaStreak.textContent = String(store.currentStreak(today));
  const par = dailyPar(today);
  ui.metaPar.textContent = par ? formatScore(par) : '—';

  previewView.setPalette(palette);
  previewView.setBoard(board);

  ui.btnPlay.textContent = left === MAX_ATTEMPTS ? 'Jugar' : left > 0 ? 'Otro intento' : 'Ver el tablero';
  ui.dailyDone.hidden = left > 0;

  updateResetCountdown();
}

let countdownTimer = 0;
function updateResetCountdown(): void {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const ms = next - now.getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  ui.resetNote.textContent = `Tablero nuevo en ${h} h ${String(m).padStart(2, '0')} min`;

  clearTimeout(countdownTimer);
  countdownTimer = window.setTimeout(() => {
    // Crossing midnight UTC mid-session must not leave a stale board on screen.
    if (utcDate() !== today) renderHome();
    else updateResetCountdown();
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

function startSession(date: string, ranked: boolean): void {
  const board = dailyBoard(date);
  session = { date, board, ranked, placements: [], selected: null, lastResult: null };

  boardView.setPalette(palette);
  boardView.setReducedMotion(store.load().settings.reducedMotion);
  boardView.setBoard(board);

  ui.gameNo.textContent = `#${puzzleNumber(date)}`;
  ui.scoreLive.textContent = '0';
  ui.comboBadge.hidden = true;
  updateAttemptLabel();
  renderTray();
  syncControls();
  show('game');
}

function updateAttemptLabel(): void {
  if (!session) return;
  if (!session.ranked) {
    ui.gameSub.textContent = 'Práctica · sin ranking';
    return;
  }
  const used = MAX_ATTEMPTS - store.attemptsLeft(session.date, MAX_ATTEMPTS);
  ui.gameSub.textContent = `Intento ${Math.min(used + 1, MAX_ATTEMPTS)} de ${MAX_ATTEMPTS}`;
}

/** Which inventory slots are still unplaced, by index into `board.inventory`. */
function usedSlots(): boolean[] {
  if (!session) return [];
  const used = session.board.inventory.map(() => false);
  for (const p of session.placements) {
    const i = session.board.inventory.findIndex((piece, idx) => piece === p.piece && !used[idx]);
    if (i >= 0) used[i] = true;
  }
  return used;
}

function renderTray(): void {
  if (!session) return;
  const used = usedSlots();
  ui.tray.replaceChildren();

  session.board.inventory.forEach((piece, i) => {
    const slot = document.createElement('button');
    slot.className = 'slot';
    slot.type = 'button';
    slot.dataset.used = String(used[i]);
    slot.dataset.selected = String(session?.selected === i);
    slot.setAttribute('aria-label', PIECE_NAMES[piece]?.name ?? 'Pieza');
    slot.setAttribute('aria-pressed', String(session?.selected === i));

    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 80;
    const ctx = c.getContext('2d');
    if (ctx) drawPieceGlyph(ctx, piece, 40, 40, 50, used[i] ? '#5c6f75' : '#d6e6ea');
    slot.append(c);

    slot.addEventListener('click', () => {
      if (!session || used[i]) return;
      session.selected = session.selected === i ? null : i;
      blip(660, 0.03, 'square', 0.03);
      renderTray();
    });

    ui.tray.append(slot);
  });
}

function syncControls(): void {
  if (!session) return;
  const used = session.placements.length;
  const total = session.board.inventory.length;

  // One piece is enough. Requiring all five implied there was an arrangement in
  // which every piece mattered, and on most boards two or three do all the work.
  ui.btnLaunch.disabled = used < 1;
  ui.btnUndo.disabled = used === 0;
  ui.btnClear.disabled = used === 0;
  ui.launchHint.textContent =
    used === 0 ? 'Coloca al menos una pieza' : `${used} de ${total} · un solo toque`;
  ui.trayNote.textContent =
    used === 0
      ? 'Toca una pieza y luego el tablero. No hace falta usarlas todas.'
      : 'Puedes encender ya, o seguir colocando.';
  boardView.setPlacements(session.placements);
}

function onBoardTap(clientX: number, clientY: number): void {
  if (!session || boardView.isPlaying()) return;
  const cell = boardView.cellAt(clientX, clientY);
  if (!cell) return;

  // Tapping an existing piece picks it back up. That is more forgiving than a
  // separate delete mode and needs no extra affordance on a small screen.
  const existing = session.placements.findIndex((p) => p.x === cell.x && p.y === cell.y);
  if (existing >= 0) {
    session.placements.splice(existing, 1);
    session.selected = null;
    blip(320, 0.05, 'triangle', 0.04);
    renderTray();
    syncControls();
    return;
  }

  const slot = session.selected ?? nextFreeSlot();
  if (slot === null) return;

  const piece = session.board.inventory[slot];
  const candidate = [...session.placements, { x: cell.x, y: cell.y, piece }];
  try {
    // Ask the simulation whether this is legal instead of duplicating the rules.
    // Partial sets are legal now, so there is one code path and no special case.
    validatePlacements(session.board, candidate);
  } catch {
    blip(180, 0.08, 'sawtooth', 0.03);
    toast('Ahí no cabe una pieza');
    return;
  }

  session.placements = candidate;
  session.selected = null;
  blip(880, 0.04, 'square', 0.035);
  renderTray();
  syncControls();
}

function nextFreeSlot(): number | null {
  const used = usedSlots();
  const i = used.findIndex((u) => !u);
  return i >= 0 ? i : null;
}

function launch(): void {
  if (!session || session.placements.length < 1) return;
  const s = session;

  ui.btnLaunch.disabled = true;
  ui.btnUndo.disabled = true;
  ui.btnClear.disabled = true;
  ui.comboBadge.hidden = false;
  ui.comboBadge.textContent = '×1';
  blip(140, 0.18, 'sawtooth', 0.06);

  boardView.play(s.placements, {
    onScore: (score, multiplier) => {
      ui.scoreLive.textContent = formatScore(score);
      ui.scoreLive.classList.add('bump');
      setTimeout(() => ui.scoreLive.classList.remove('bump'), 140);
      ui.comboBadge.textContent = `×${multiplier}`;
      blip(420 + multiplier * 70, 0.05, 'triangle', 0.045);
    },
    onBomb: () => blip(90, 0.3, 'sawtooth', 0.09),
    onDone: (score, ignited) => finishRun(s, score, ignited),
  });
}

function finishRun(s: Session, score: number, ignited: number): void {
  const total = countNodes(s.board);
  s.lastResult = { score, ignited, total };

  // The client's number is only a display; the server re-runs the same module
  // and its answer wins. Recomputing here catches a broken renderer early.
  const authoritative = runSim(s.board, s.placements);
  if (authoritative.score !== score) {
    console.error('[fuse] render and simulation disagree', { rendered: score, authoritative });
  }

  if (s.ranked) store.recordAttempt(s.date, authoritative.score, ignited, total);
  setTimeout(() => renderResult(s), 520);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function renderResult(s: Session): void {
  const r = s.lastResult;
  if (!r) return;

  const stored = s.ranked ? store.getResult(s.date) : null;
  const best = stored?.best ?? r.score;
  const par = dailyPar(s.date);

  ui.resultLabel.textContent = s.ranked ? `Reto #${puzzleNumber(s.date)}` : 'Práctica';
  ui.resultScore.textContent = formatScore(r.score);
  // The detail line states facts; the gap line does the judging. Keeping them
  // separate stopped the screen contradicting itself — it used to say "there's
  // more in there" on a run that had just matched the target.
  ui.resultDetail.textContent = `${r.ignited} de ${r.total} nodos encendidos`;

  renderTargetBar(r.score, best, par, verdict(r.score, r.ignited, r.total));

  const left = s.ranked ? store.attemptsLeft(s.date, MAX_ATTEMPTS) : Infinity;
  ui.btnRetry.hidden = left <= 0;
  ui.btnRetry.textContent = s.ranked ? `Otro intento (${left})` : 'Otra vez';

  ui.resultShare.textContent = s.ranked
    ? shareText({
        date: s.date,
        score: best,
        ignited: stored?.ignited ?? r.ignited,
        totalNodes: r.total,
        attempts: stored?.attempts ?? 1,
        maxAttempts: MAX_ATTEMPTS,
      })
    : 'Las prácticas no se comparten.';
  ui.btnShare.hidden = !s.ranked;

  renderOffers(s);
  show('result');
  blip(520, 0.12, 'sine', 0.05);
}

/**
 * Shows the score against the day's target.
 *
 * Without this the result screen was a bare number: a player had no way to tell
 * whether 5,400 was a triumph or a fumble, which is most of why the game read as
 * a puzzle with a hidden answer. Par is the best the reference solver found, not
 * a proven maximum, and the copy says so when you beat it.
 */
function renderTargetBar(score: number, best: number, par: number | null, verdictText = ''): void {
  const ceiling = Math.max(par ?? 0, best, score, 1);

  ui.resultBarFill.style.width = '0%';
  requestAnimationFrame(() => {
    ui.resultBarFill.style.width = `${Math.round((score / ceiling) * 100)}%`;
  });

  ui.resultBestLabel.textContent = `Tu mejor: ${formatScore(best)}`;

  if (par === null) {
    // No target for this day: fall back to a plain read of how it went.
    ui.resultBarMark.hidden = true;
    ui.resultParLabel.textContent = '';
    ui.resultGap.textContent = verdictText;
    ui.resultGap.dataset.tone = 'normal';
    return;
  }

  ui.resultBarMark.hidden = false;
  ui.resultBarMark.style.left = `${Math.round((par / ceiling) * 100)}%`;
  ui.resultParLabel.textContent = `Objetivo: ${formatScore(par)}`;

  if (score > par) {
    ui.resultGap.textContent = 'Has batido el mejor resultado conocido.';
    ui.resultGap.dataset.tone = 'good';
  } else if (score === par) {
    ui.resultGap.textContent = 'Has igualado el objetivo. Nadie lo ha hecho mejor.';
    ui.resultGap.dataset.tone = 'good';
  } else {
    ui.resultGap.textContent = `Te faltan ${formatScore(par - score)} para el objetivo.`;
    ui.resultGap.dataset.tone = 'normal';
  }
}

function renderOffers(s: Session): void {
  ui.offers.replaceChildren();
  const data = store.load();
  if (!s.ranked || data.adFree) return;

  const left = store.rewardsLeft(today, REWARDS_PER_DAY);
  if (left <= 0 || !ads.isRewardedReady()) return;

  addOffer('✦', 'Doblar las chispas de hoy', `Ver un vídeo · quedan ${left}`, {
    kind: 'double-sparks',
    amount: 10,
  });
}

function addOffer(icon: string, title: string, sub: string, reward: Reward): void {
  const btn = document.createElement('button');
  btn.className = 'offer';
  btn.type = 'button';
  const text = make('span', 'offer-text');
  text.append(make('b', undefined, title), make('small', undefined, sub));
  btn.append(make('span', 'offer-icon', icon), text);
  btn.addEventListener('click', () => void claimReward(reward, btn));
  ui.offers.append(btn);
}

async function claimReward(reward: Reward, btn: HTMLButtonElement): Promise<void> {
  assertRewardIsFair(reward);
  btn.disabled = true;
  const watched = await ads.showRewarded();
  if (!watched) {
    btn.disabled = false;
    toast('El vídeo no se completó');
    return;
  }

  store.consumeReward(today);
  if (reward.kind === 'double-sparks') {
    store.update((d) => {
      d.sparks += reward.amount;
    });
    toast(`+${reward.amount} chispas`);
  } else if (reward.kind === 'unlock-palette') {
    store.update((d) => {
      if (!d.unlockedPalettes.includes(reward.paletteId)) d.unlockedPalettes.push(reward.paletteId);
    });
    toast('Paleta desbloqueada');
  }
  if (session) renderOffers(session);
}

// ---------------------------------------------------------------------------
// Archive, how-to, settings
// ---------------------------------------------------------------------------

const ARCHIVE_DAYS = 30;

function renderArchive(): void {
  ui.archiveList.replaceChildren();
  const t0 = Date.parse(`${today}T00:00:00Z`);

  for (let i = 1; i <= ARCHIVE_DAYS; i++) {
    const date = new Date(t0 - i * 86400000).toISOString().slice(0, 10);
    if (puzzleNumber(date) < 1) break;

    const result = store.getResult(date);
    const row = document.createElement('button');
    row.className = 'archive-row';
    row.type = 'button';
    const label = new Date(`${date}T00:00:00Z`).toLocaleDateString('es', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    row.append(
      make('span', 'archive-no', `#${puzzleNumber(date)}`),
      make('span', 'archive-date', label),
      make(
        'span',
        `archive-score${result ? '' : ' empty'}`,
        result ? formatScore(result.best) : 'sin jugar'
      )
    );
    row.addEventListener('click', () => startSession(date, false));
    ui.archiveList.append(row);
  }
}

function renderPieceGuide(): void {
  ui.pieceGuide.replaceChildren();
  for (const piece of [Piece.MirrorA, Piece.MirrorB, Piece.Splitter, Piece.Boost, Piece.Bomb]) {
    const row = document.createElement('div');
    row.className = 'piece-row';
    const c = document.createElement('canvas');
    c.width = 92;
    c.height = 92;
    const ctx = c.getContext('2d');
    if (ctx) drawPieceGlyph(ctx, piece, 46, 46, 54, '#d6e6ea');
    const info = PIECE_NAMES[piece];
    const text = make('div');
    text.append(make('b', undefined, info.name), make('small', undefined, info.blurb));
    row.append(c, text);
    ui.pieceGuide.append(row);
  }
}

function renderSettings(): void {
  const data = store.load();
  ui.setReminder.checked = data.settings.reminder;
  ui.setSound.checked = data.settings.sound;
  ui.setReduced.checked = data.settings.reducedMotion;

  ui.paletteGrid.replaceChildren();
  for (const p of PALETTES) {
    const unlocked = data.unlockedPalettes.includes(p.id) || data.adFree;
    const btn = document.createElement('button');
    btn.className = 'palette';
    btn.type = 'button';
    btn.dataset.selected = String(p.id === palette.id);
    btn.dataset.locked = String(!unlocked);
    btn.setAttribute('aria-label', p.name);

    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 44;
    paintPaletteSwatch(c, p);
    const label = document.createElement('span');
    label.textContent = unlocked ? p.name : `${p.name} · bloqueada`;
    btn.append(c, label);

    btn.addEventListener('click', () => {
      if (!unlocked) {
        toast('Se desbloquea con el pack de paletas');
        return;
      }
      palette = p;
      store.update((d) => {
        d.settings.palette = p.id;
      });
      boardView.setPalette(p);
      previewView.setPalette(p);
      renderSettings();
    });
    ui.paletteGrid.append(btn);
  }

  void renderSupport();
  // Injected from package.json at build time; a hardcoded string had already
  // drifted a version behind the app it was printed in.
  ui.settingsFoot.textContent = `Chispas: ${data.sparks} · Fuse v${__APP_VERSION__}`;
}

function paintPaletteSwatch(canvas: HTMLCanvasElement, p: Palette): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#05090b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.55, p.spark);
  grad.addColorStop(1, p.hot);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(14, canvas.height / 2);
  ctx.lineTo(canvas.width - 14, canvas.height / 2);
  ctx.stroke();
}

async function renderSupport(): Promise<void> {
  ui.support.replaceChildren();
  const products = await purchases.listProducts();
  const data = store.load();

  for (const product of products) {
    const btn = document.createElement('button');
    btn.className = 'offer';
    btn.type = 'button';
    const owned = data.adFree && product.id === 'ad_free';
    const text = make('span', 'offer-text');
    text.append(
      make('b', undefined, productTitle(product)),
      make('small', undefined, owned ? 'Ya lo tienes. Gracias.' : product.priceLabel)
    );
    btn.append(make('span', 'offer-icon', '◆'), text);
    btn.disabled = owned;
    btn.addEventListener('click', () => void buy(product));
    ui.support.append(btn);
  }
}

function productTitle(p: Product): string {
  if (p.id === 'ad_free') return 'Quitar anuncios y apoyar';
  if (p.id === 'palette_pack') return 'Pack de paletas';
  return 'Temporada';
}

async function buy(product: Product): Promise<void> {
  const ok = await purchases.purchase(product.id);
  if (!ok) {
    toast('La compra no se completó');
    return;
  }
  store.update((d) => {
    if (product.id === 'ad_free') d.adFree = true;
    if (product.id === 'palette_pack') {
      for (const p of PALETTES) if (!d.unlockedPalettes.includes(p.id)) d.unlockedPalettes.push(p.id);
    }
  });
  toast('¡Gracias!');
  renderSettings();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function bindHome(): void {
  ui.btnPlay.addEventListener('click', () => {
    if (store.attemptsLeft(today, MAX_ATTEMPTS) <= 0) {
      startSession(today, false);
      toast('Sin intentos clasificados. Esto es práctica.');
      return;
    }
    startSession(today, true);
  });

  el('btn-archive').addEventListener('click', () => {
    renderArchive();
    show('archive');
  });
  el('btn-archive-back').addEventListener('click', () => show('home'));

  el('btn-howto').addEventListener('click', () => {
    renderPieceGuide();
    show('howto');
  });
  el('btn-howto-back').addEventListener('click', () => show('home'));

  el('btn-settings').addEventListener('click', () => {
    renderSettings();
    show('settings');
  });
  el('btn-settings-back').addEventListener('click', () => {
    renderHome();
    show('home');
  });
}

function bindGame(): void {
  el('btn-back').addEventListener('click', goHome);

  ui.btnUndo.addEventListener('click', () => {
    if (!session) return;
    session.placements.pop();
    renderTray();
    syncControls();
  });

  ui.btnClear.addEventListener('click', () => {
    if (!session) return;
    session.placements = [];
    session.selected = null;
    renderTray();
    syncControls();
  });

  ui.btnLaunch.addEventListener('click', launch);

  ui.boardCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onBoardTap(e.clientX, e.clientY);
  });
}

function bindResult(): void {
  ui.btnRetry.addEventListener('click', () => {
    if (!session) return;
    startSession(session.date, session.ranked && store.attemptsLeft(session.date, MAX_ATTEMPTS) > 0);
  });

  el('btn-result-home').addEventListener('click', goHome);

  ui.btnShare.addEventListener('click', () => {
    void (async () => {
      const outcome = await shareSummary(ui.resultShare.textContent ?? '');
      if (outcome === 'copied') toast('Copiado al portapapeles');
      else if (outcome === 'failed') toast('No se pudo compartir');
    })();
  });
}

function bindTutorial(): void {
  ui.btnTutNext.addEventListener('click', () => {
    blip(600, 0.04, 'square', 0.03);
    tutorial?.next();
  });
  el('btn-tut-skip').addEventListener('click', finishTutorial);
}

function bindSettings(): void {
  el('btn-replay-tutorial').addEventListener('click', startTutorial);

  ui.setReminder.addEventListener('change', () => {
    store.update((d) => {
      d.settings.reminder = ui.setReminder.checked;
    });
    toast(ui.setReminder.checked ? 'Te avisaremos del tablero nuevo' : 'Recordatorio desactivado');
  });

  ui.setSound.addEventListener('change', () =>
    store.update((d) => {
      d.settings.sound = ui.setSound.checked;
    })
  );

  ui.setReduced.addEventListener('change', () => {
    store.update((d) => {
      d.settings.reducedMotion = ui.setReduced.checked;
    });
    boardView.setReducedMotion(ui.setReduced.checked);
  });
}

function goHome(): void {
  boardView.reset();
  renderHome();
  show('home');
}

function bind(): void {
  bindHome();
  bindGame();
  bindResult();
  bindSettings();
  bindTutorial();

  window.addEventListener('resize', () => {
    boardView.resize();
    previewView.resize();
  });

  // Returning after midnight UTC must land on today's board, not yesterday's.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && utcDate() !== today && ui.screens.game.hidden) {
      renderHome();
    }
  });
}

function boot(): void {
  const data = store.load();
  if (data.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    boardView.setReducedMotion(true);
  }
  bind();
  renderHome();

  if (!data.tutorialDone) startTutorial();
  else show('home');

  void ads.ensureConsent();
}

boot();

// Exposed for the end-to-end tests so they can drive real game state instead of
// clicking through fragile pixel coordinates.
declare global {
  interface Window {
    __fuse?: Record<string, unknown>;
  }
  const __APP_VERSION__: string;
}
window.__fuse = {
  get session() {
    return session;
  },
  startSession,
  startTutorial,
  finishTutorial,
  onBoardTap,
  launch,
  dailyPar,
  store,
  utcDate,
  dailyBoard,
  MAX_ATTEMPTS,
};
