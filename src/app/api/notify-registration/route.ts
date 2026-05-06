/**
 * /api/notify-registration — Send email when someone joins the tournament
 */

import { NextRequest } from 'next/server';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function POST(req: NextRequest) {
  try {
    const { playerName, totalPlayers, maxPlayers } = await req.json();

    const spotsLeft = maxPlayers ? maxPlayers - totalPlayers : null;
    const subject = `🚀 ${playerName} joined Space Series — ${totalPlayers}${maxPlayers ? `/${maxPlayers}` : ''} players`;

    const html = `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;background:#0d0d1a;color:#e8e8e0;margin:0;padding:32px;">
  <div style="max-width:480px;margin:0 auto;background:#12121f;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;">
    <div style="background:#1a1a2e;padding:24px 28px;">
      <h1 style="margin:0;font-size:20px;letter-spacing:1px;">🚀 New Registration</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="font-size:24px;font-weight:700;color:#ffcc44;margin:0 0 8px;">
        ${playerName}
      </p>
      <p style="color:#888;margin:0 0 20px;font-size:14px;">
        just joined the Space Series tournament.
      </p>
      <div style="background:#1a1a2e;border-radius:8px;padding:16px 20px;">
        <p style="margin:0;font-size:14px;">
          <span style="color:#888;">Registered:</span>
          <strong style="color:#00ddff;"> ${totalPlayers}${maxPlayers ? ` / ${maxPlayers}` : ''}</strong>
        </p>
        ${spotsLeft !== null ? `
        <p style="margin:8px 0 0;font-size:14px;">
          <span style="color:#888;">Spots left:</span>
          <strong style="color:${spotsLeft <= 3 ? '#ff4444' : '#00ff88'};"> ${spotsLeft}</strong>
        </p>` : ''}
      </div>
    </div>
  </div>
</body>
</html>`;

    await transporter.sendMail({
      from: `"Space Tournament" <${process.env.GMAIL_USER}>`,
      to: 'david@goldenblack.us',
      subject,
      html,
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[notify-registration]', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
