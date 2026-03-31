/**
 * /api/challonge — Server-side proxy for Challonge API v1
 *
 * Uses a simple API key (no OAuth) so server-to-server requests work without
 * hitting Cloudflare bot protection on the OAuth token endpoint.
 *
 * Requires env vars:
 *   CHALLONGE_API_KEY               (from challonge.com settings → v1 key)
 *   NEXT_PUBLIC_CHALLONGE_TOURNAMENT_ID  (your tournament slug, e.g. "space2026")
 *
 * Usage (all from client — credentials never leave the server):
 *   GET  /api/challonge?path=/tournaments/SLUG.json
 *   POST /api/challonge?path=/tournaments/SLUG/participants.json
 *   PUT  /api/challonge?path=/matches/ID.json
 */

import { NextRequest } from 'next/server';

const V1_BASE = 'https://api.challonge.com/v1';

function apiKey(): string {
  const key = process.env.CHALLONGE_API_KEY;
  if (!key) throw new Error('CHALLONGE_API_KEY must be set in .env.local');
  return key;
}

/** Append api_key to URL query string */
function withKey(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${V1_BASE}${path}${sep}api_key=${apiKey()}`;
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return Response.json({ error: 'Missing ?path=' }, { status: 400 });

    const res = await fetch(withKey(path), {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[challonge GET]', res.status, text.slice(0, 200));
    }

    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    console.error('[challonge GET]', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return Response.json({ error: 'Missing ?path=' }, { status: 400 });

    const body = await req.json();
    const res = await fetch(withKey(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[challonge POST]', res.status, text.slice(0, 200));
    }

    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    console.error('[challonge POST]', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return Response.json({ error: 'Missing ?path=' }, { status: 400 });

    const body = await req.json();
    const res = await fetch(withKey(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[challonge PUT]', res.status, text.slice(0, 200));
    }

    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    console.error('[challonge PUT]', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
