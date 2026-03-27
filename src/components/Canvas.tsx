'use client';

import {
  useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle,
} from 'react';
import type { Planet, Player } from '@/lib/types';

export interface FleetOrder {
  id: string;
  fromPlanetId: string;
  toPlanetId: string;
  ships: number;
}

interface CanvasProps {
  planets: Planet[];
  player: Player | null;
  origin: Planet | null;
  target: Planet | null;
  pendingOrders: FleetOrder[];
  onPlanetClick: (planet: Planet, pixelX: number, pixelY: number) => void;
}

const FOG_R = 16;

// Stable per-session order colors
const ORDER_COLORS = [
  '#e8d5a3', // warm sand
  '#a3c4e8', // muted sky
  '#c4a3e8', // soft violet
  '#a3e8c4', // seafoam
  '#e8a3a3', // dusty rose
  '#e8c4a3', // peach
];

export default function Canvas({
  planets, player, origin, target, pendingOrders, onPlanetClick,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const toPixel = useCallback(
    (p: Planet) => ({ x: (p.x / 100) * dims.w, y: (p.y / 100) * dims.h }),
    [dims]
  );

  const sortedIds = useMemo(
    () => [...planets].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.id),
    [planets]
  );
  const pidx = (id: string) => sortedIds.indexOf(id) + 1;

  // Resize observer
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Inner circle: sized by production base (1–20 scale)
  const PROD_MIN_R = 10;
  const PROD_MAX_R = 22;
  function getProdR(p: Planet) {
    return PROD_MIN_R + Math.min(1, (p.productionBase ?? 10) / 20) * (PROD_MAX_R - PROD_MIN_R);
  }

  // Outer shield: radius, lineWidth, opacity all scale with ships
  function getShield(ships: number) {
    const t = Math.min(1, ships / 60);
    return {
      extraR: 2 + t * 6,         // 2px → 8px beyond inner edge (tight)
      lineWidth: 0.5 + t * 2.5,  // 0.5px → 3px
      opacity: 0.08 + t * 0.65,  // near-invisible → solid
      blur: t * 12,               // 0 → 12px glow
      color: '#c8a458',           // warm amber — distinct from all planet colors
    };
  }

  // Total radius for hit testing
  function getHitR(p: Planet) {
    const prod = getProdR(p);
    const { extraR } = getShield(p.ships);
    return prod + extraR + 10;
  }

  // ── Draw ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    canvas.style.width = `${dims.w}px`;
    canvas.style.height = `${dims.h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, dims.w, dims.h);

    const revealedSet = new Set(player?.revealedPlanets ?? []);

    // ── Queued order lines (drawn below planets) ──────────────────────────
    pendingOrders.forEach((order, i) => {
      const fp = planets.find((p) => p.id === order.fromPlanetId);
      const tp = planets.find((p) => p.id === order.toPlanetId);
      if (!fp || !tp) return;
      const from = toPixel(fp);
      const to = toPixel(tp);
      const color = ORDER_COLORS[i % ORDER_COLORS.length];

      ctx.save();
      ctx.setLineDash([5, 9]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Midpoint pill badge
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const label = `${order.ships}`;
      ctx.font = 'bold 10px "Space Mono", monospace';
      const textW = ctx.measureText(label).width;
      const pillW = textW + 12;
      const pillH = 18;

      ctx.fillStyle = 'rgba(6, 6, 14, 0.85)';
      roundRect(ctx, mx - pillW / 2, my - pillH / 2, pillW, pillH, 4);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      roundRect(ctx, mx - pillW / 2, my - pillH / 2, pillW, pillH, 4);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, mx, my);
      ctx.restore();
    });

    // ── Preview line (origin → target while modal open) ───────────────────
    if (origin && target) {
      const from = toPixel(origin);
      const to = toPixel(target);
      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Planets ───────────────────────────────────────────────────────────
    for (const planet of planets) {
      const { x, y } = toPixel(planet);
      const isRevealed = revealedSet.has(planet.id) || planet.owner === player?.uid;
      const isMyPlanet = planet.owner === player?.uid;
      const isOwned = !!planet.owner;
      const isOrigin = origin?.id === planet.id;
      const isTarget = target?.id === planet.id;
      const idx = pidx(planet.id);

      ctx.save();

      if (!isRevealed) {
        // ── Fog of War ──────────────────────────────────────────────────
        const r = FOG_R;
        const isSelected = isOrigin || isTarget;

        // Outer ring
        ctx.strokeStyle = isSelected
          ? 'rgba(255, 255, 255, 0.5)'
          : 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.arc(x, y, r + 9, 0, Math.PI * 2);
        ctx.stroke();

        // Body
        ctx.setLineDash([]);
        ctx.fillStyle = isSelected
          ? 'rgba(200, 200, 220, 0.35)'
          : 'rgba(160, 160, 180, 0.18)';
        ctx.shadowColor = isSelected ? 'rgba(255,255,255,0.3)' : 'transparent';
        ctx.shadowBlur = isSelected ? 16 : 0;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Index label
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = 'bold 11px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${idx}`, x, y);

        ctx.restore();
        continue;
      }

      // ── Revealed Planet (two-circle) ─────────────────────────────────
      const prodR = getProdR(planet);
      const shield = getShield(planet.ships);
      const shieldR = prodR + shield.extraR;
      const isSelected = isOrigin || isTarget;

      // Base planet color
      const baseColor = isMyPlanet ? '#e8e8e0' : isOwned ? '#c47070' : '#6e6e80';

      ctx.save();

      // ── 1. Outer shield ring ─────────────────────────────────────────
      ctx.globalAlpha = shield.opacity;
      ctx.strokeStyle = shield.color;
      ctx.lineWidth = shield.lineWidth;
      ctx.shadowColor = shield.color;
      ctx.shadowBlur = shield.blur;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, shieldR, 0, Math.PI * 2);
      ctx.stroke();

      // ── 2. Inner planet (production core) ────────────────────────────
      ctx.globalAlpha = 1;
      ctx.shadowBlur = isSelected ? 28 : isMyPlanet ? 10 : 4;
      ctx.shadowColor = isSelected ? 'rgba(255,255,255,0.6)' : baseColor + '88';

      const grad = ctx.createRadialGradient(
        x - prodR * 0.25, y - prodR * 0.3, 0, x, y, prodR
      );
      grad.addColorStop(0, baseColor);
      grad.addColorStop(0.65, baseColor + 'cc');
      grad.addColorStop(1, baseColor + '55');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, prodR, 0, Math.PI * 2);
      ctx.fill();

      // ── 3. Selection ring (outside the shield) ────────────────────────
      if (isSelected) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash(isOrigin ? [] : [5, 5]);
        ctx.beginPath();
        ctx.arc(x, y, shieldR + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // ── 4. Production label (center of inner circle) ─────────────────
      ctx.fillStyle = isMyPlanet ? '#06060e' : 'rgba(255,255,255,0.85)';
      ctx.font = `bold ${prodR >= 18 ? 12 : 10}px "Space Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(planet.productionBase ?? 0), x, y);

      // ── 5. Ship count above shield ────────────────────────────────────
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = `bold 10px "Space Mono", monospace`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(planet.ships), x, y - shieldR - 5);

      ctx.restore();
    }
  }, [planets, player, origin, target, pendingOrders, dims, toPixel, sortedIds]);

  // ── Click ───────────────────────────────────────────────────────────────
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dims.w === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const revealedSet = new Set(player?.revealedPlanets ?? []);

    const hit = planets.find((p) => {
      const { x, y } = toPixel(p);
      const isRevealed = revealedSet.has(p.id) || p.owner === player?.uid;
      const hitR = isRevealed ? getHitR(p) : FOG_R + 12;
      return Math.hypot(mx - x, my - y) <= hitR;
    });

    if (hit) onPlanetClick(hit, mx, my);
  }

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ display: 'block', cursor: 'crosshair' }}
        aria-label="Space game board"
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
