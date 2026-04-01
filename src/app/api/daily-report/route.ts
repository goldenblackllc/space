import { NextRequest } from 'next/server';
import * as admin from 'firebase-admin';
import nodemailer from 'nodemailer';

// ── Firebase Admin init (shared singleton) ────────────────────────────────────
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY!;
  const creds = JSON.parse(
    raw.length > 200 ? Buffer.from(raw, 'base64').toString('utf8') : raw
  );
  admin.initializeApp({ credential: admin.credential.cert(creds) });
}

const db = admin.firestore();

// ── Gmail transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ── Auth guard ────────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret set → allow (dev only)
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
interface GameDoc {
  status: string;
  players: string[];
  winnerUid?: string;
  planetCount?: number;
  currentYear?: number;
  createdAt?: number;
  updatedAt?: number;
}

async function computeStats() {
  const now = Date.now();
  const since = now - 24 * 60 * 60 * 1000; // 24 h ago

  const snap = await db.collection('games').get();
  const games: GameDoc[] = snap.docs.map((d) => d.data() as GameDoc);

  const all = games;
  const recent = games.filter((g) => (g.createdAt ?? 0) >= since);

  const totalGames   = all.length;
  const inLobby      = all.filter((g) => g.status === 'lobby').length;
  const inProgress   = all.filter((g) => g.status === 'active').length;
  const completed    = all.filter((g) => g.status === 'ended').length;

  const newToday     = recent.length;
  const completedToday = recent.filter((g) => g.status === 'ended').length;

  // Unique player UIDs across all games
  const allPlayerUids = new Set(all.flatMap((g) => g.players ?? []));
  const recentUids    = new Set(recent.flatMap((g) => g.players ?? []));

  // Average planet count
  const avgPlanets = all.length
    ? Math.round(all.reduce((s, g) => s + (g.planetCount ?? 20), 0) / all.length)
    : 0;

  // Average game length (turns) for completed games
  const completedGames = all.filter((g) => g.status === 'ended' && (g.currentYear ?? 0) > 0);
  const avgTurns = completedGames.length
    ? Math.round(completedGames.reduce((s, g) => s + (g.currentYear ?? 0), 0) / completedGames.length)
    : 0;

  return {
    totalGames, inLobby, inProgress, completed,
    newToday, completedToday,
    totalUniquePlayers: allPlayerUids.size,
    activeTodayPlayers: recentUids.size,
    avgPlanets, avgTurns,
    reportDate: new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/New_York',
    }),
  };
}

// ── Email HTML ────────────────────────────────────────────────────────────────
function buildEmailHtml(s: Awaited<ReturnType<typeof computeStats>>): string {
  const row = (label: string, value: string | number) => `
    <tr>
      <td style="padding:8px 16px;color:#888;font-size:13px;">${label}</td>
      <td style="padding:8px 16px;font-weight:600;font-size:14px;">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;background:#0d0d1a;color:#e8e8e0;margin:0;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#12121f;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;">
    <div style="background:#1a1a2e;padding:24px 28px;">
      <h1 style="margin:0;font-size:20px;letter-spacing:1px;">🪐 Space — Daily Report</h1>
      <p style="margin:6px 0 0;color:#888;font-size:13px;">${s.reportDate}</p>
    </div>

    <div style="padding:20px 12px;">
      <p style="margin:0 16px 8px;font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#555;">Last 24 Hours</p>
      <table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:8px;overflow:hidden;">
        ${row('New games created', s.newToday)}
        ${row('Games completed today', s.completedToday)}
        ${row('Active players today', s.activeTodayPlayers)}
      </table>

      <p style="margin:20px 16px 8px;font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#555;">All Time</p>
      <table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:8px;overflow:hidden;">
        ${row('Total games', s.totalGames)}
        ${row('In lobby', s.inLobby)}
        ${row('In progress', s.inProgress)}
        ${row('Completed', s.completed)}
        ${row('Unique players', s.totalUniquePlayers)}
        ${row('Avg planet count', s.avgPlanets)}
        ${row('Avg game length (turns)', s.avgTurns || '—')}
      </table>
    </div>

    <div style="padding:16px 28px;border-top:1px solid #2a2a3a;color:#555;font-size:11px;">
      Auto-generated by Space. Sent daily at 8 AM ET.
    </div>
  </div>
</body>
</html>`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await computeStats();
    const html  = buildEmailHtml(stats);

    await transporter.sendMail({
      from: `"Space Stats" <${process.env.GMAIL_USER}>`,
      to: 'david@goldenblack.us',
      subject: `🪐 Space Daily Report — ${stats.reportDate}`,
      html,
    });

    return Response.json({ ok: true, stats });
  } catch (err: unknown) {
    console.error('[daily-report]', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

// Allow manual GET trigger during development
export async function GET(req: NextRequest) {
  return POST(req);
}
