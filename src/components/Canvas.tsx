'use client';

import {
  useEffect, useRef, useState, useCallback, useMemo,
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
  playerTotalShips: number;
  origin: Planet | null;
  target: Planet | null;
  pendingOrders: FleetOrder[];
  spotlightPlanetId?: string;  // universal highlight for any event
  spotlightColor?: string;     // glow color (e.g. '#00ff88', '#aa44ff', '#ffffff')
  onPlanetClick: (planet: Planet, pixelX: number, pixelY: number) => void;
  onOrderCancel?: (orderId: string) => void;
  className?: string;
}

const FOG_R = 16;
const PROD_MIN_R = 10;
const PROD_MAX_R = 22;

const ORDER_COLORS = [
  '#e8d5a3', '#a3c4e8', '#c4a3e8', '#a3e8c4', '#e8a3a3', '#e8c4a3',
];

function getProdR(p: Planet) {
  return PROD_MIN_R + Math.min(1, (p.productionBase ?? 10) / 20) * (PROD_MAX_R - PROD_MIN_R);
}

/**
 * shipFraction: this planet's ships / player's total ships across all planets (0–1).
 * Used to drive ring thickness and color so players can gauge relative strength at a glance.
 * Color ramps from dim red (weak) → gold (mid) → bright teal (dominant).
 */
function getShield(ships: number, shipFraction: number) {
  // Absolute scale: up to ~60 ships saturates the opacity curve
  const absT = Math.min(1, ships / 60);
  // Fraction scale: 0 = no ships here relative to own fleet, 1 = all ships here
  const frac = Math.max(0, Math.min(1, shipFraction));

  // Ring thickness driven by fraction (min 1.5 so it's always visible)
  const lineWidth = 1.5 + frac * 6.5;
  // Extra radius stays tied to absolute ship count (keeps ring outside planet body)
  const extraR = 2 + absT * 6;

  // Color: weak=red (#e05050), mid=gold (#c8a458), strong=teal (#40d0c0)
  // Interpolate in two segments: [0,0.5] red→gold, [0.5,1] gold→teal
  let color: string;
  if (frac < 0.5) {
    const s = frac / 0.5;
    const r = Math.round(0xe0 + s * (0xc8 - 0xe0));
    const g = Math.round(0x50 + s * (0xa4 - 0x50));
    const b = Math.round(0x50 + s * (0x58 - 0x50));
    color = `rgb(${r},${g},${b})`;
  } else {
    const s = (frac - 0.5) / 0.5;
    const r = Math.round(0xc8 + s * (0x40 - 0xc8));
    const g = Math.round(0xa4 + s * (0xd0 - 0xa4));
    const b = Math.round(0x58 + s * (0xc0 - 0x58));
    color = `rgb(${r},${g},${b})`;
  }

  return {
    extraR,
    lineWidth,
    opacity: 0.15 + frac * 0.6,
    blur: absT * 10,
    color,
  };
}

function getHitR(p: Planet) {
  return getProdR(p) + getShield(p.ships, 0).extraR + 10;
}

export default function Canvas({
  planets, player, playerTotalShips, origin, target, pendingOrders, spotlightPlanetId, spotlightColor,
  onPlanetClick, onOrderCancel, className,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const rafRef = useRef<number>(0);

  const toPixel = useCallback(
    (p: Planet) => ({ x: (p.x / 100) * dims.w, y: (p.y / 100) * dims.h }),
    [dims]
  );

  const sortedIds = useMemo(
    () => [...planets].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.id),
    [planets]
  );

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

  // ── Stash latest props in refs so RAF loop sees them without re-creating ──
  const propsRef = useRef({ planets, player, playerTotalShips, origin, target, pendingOrders, spotlightPlanetId, spotlightColor });
  propsRef.current = { planets, player, playerTotalShips, origin, target, pendingOrders, spotlightPlanetId, spotlightColor };
  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  // ── RAF animation loop ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    function draw(time: number) {
      if (!running) return;
      const d = dimsRef.current;
      const { planets: pl, player: plr, playerTotalShips: totalShips, origin: orig, target: tgt, pendingOrders: orders, spotlightPlanetId: spId, spotlightColor: spColor } = propsRef.current;

      if (d.w === 0) { rafRef.current = requestAnimationFrame(draw); return; }

      const dpr = window.devicePixelRatio || 1;
      if (canvas!.width !== d.w * dpr || canvas!.height !== d.h * dpr) {
        canvas!.width = d.w * dpr;
        canvas!.height = d.h * dpr;
        canvas!.style.width = `${d.w}px`;
        canvas!.style.height = `${d.h}px`;
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, d.w, d.h);

      const revealedSet = new Set(plr?.revealedPlanets ?? []);
      const t = time / 1000; // seconds

      const toP = (p: Planet) => ({ x: (p.x / 100) * d.w, y: (p.y / 100) * d.h });

      // ── Queued order lines ─────────────────────────────────────────────
      orders.forEach((order, i) => {
        const fp = pl.find((p) => p.id === order.fromPlanetId);
        const tp = pl.find((p) => p.id === order.toPlanetId);
        if (!fp || !tp) return;
        const from = toP(fp), to = toP(tp);
        const color = ORDER_COLORS[i % ORDER_COLORS.length];

        ctx!.save();
        ctx!.setLineDash([5, 9]);
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 1.5;
        ctx!.globalAlpha = 0.6;
        ctx!.beginPath();
        ctx!.moveTo(from.x, from.y);
        ctx!.lineTo(to.x, to.y);
        ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.globalAlpha = 1;

        // Midpoint pill badge
        const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
        const label = `${order.ships}`;
        ctx!.font = '10px "Press Start 2P", monospace';
        const textW = ctx!.measureText(label).width;
        const pillW = textW + 14, pillH = 20;

        ctx!.fillStyle = 'rgba(6, 6, 14, 0.88)';
        roundRect(ctx!, mx - pillW / 2, my - pillH / 2, pillW, pillH, 4);
        ctx!.fill();
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 1;
        ctx!.globalAlpha = 0.7;
        roundRect(ctx!, mx - pillW / 2, my - pillH / 2, pillW, pillH, 4);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = color;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(label, mx, my);
        ctx!.restore();
      });

      // ── Preview line ──────────────────────────────────────────────────
      if (orig && tgt) {
        const from = toP(orig), to = toP(tgt);
        ctx!.save();
        ctx!.setLineDash([4, 8]);
        ctx!.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(from.x, from.y);
        ctx!.lineTo(to.x, to.y);
        ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.restore();
      }

      // ── Planets ───────────────────────────────────────────────────────
      for (const planet of pl) {
        const { x, y } = toP(planet);
        const isMyPlanet = planet.owner === plr?.uid;
        const isRevealed = isMyPlanet; // Strict: only show interiors of planets currently owned by the user
        const isOwned = !!planet.owner;
        const isOrigin = orig?.id === planet.id;
        const isTarget = tgt?.id === planet.id;
        const isSelected = isOrigin || isTarget;
        const isSpotlight = spId === planet.id;

        ctx!.save();

        // ── Universal Spotlight Bloom — drawn BEFORE the planet body so it
        //    sits underneath and makes the planet look naturally brighter.
        //    Color-parameterized: works for battle (white), colonize (green),
        //    planet-lost (purple), etc.
        if (isSpotlight && spColor) {
          const prodR = getProdR(planet);
          const bloomPulse = 0.5 + 0.5 * Math.sin(t * (Math.PI * 2 / 1.4));
          // Parse spotlight color for rgba usage
          const sc = parseHexRGB(spColor);
          // Wide diffuse bloom
          const bloomGrad = ctx!.createRadialGradient(x, y, 0, x, y, prodR * 5);
          bloomGrad.addColorStop(0,    `rgba(${sc},${0.28 + bloomPulse * 0.16})`);
          bloomGrad.addColorStop(0.40, `rgba(${sc},${0.13 + bloomPulse * 0.07})`);
          bloomGrad.addColorStop(1,    `rgba(${sc},0)`);
          ctx!.fillStyle = bloomGrad;
          ctx!.beginPath();
          ctx!.arc(x, y, prodR * 5, 0, Math.PI * 2);
          ctx!.fill();
          // Tight sharp outer ring
          ctx!.globalAlpha = 0.55 + bloomPulse * 0.35;
          ctx!.strokeStyle = spColor;
          ctx!.lineWidth = 1.8 + bloomPulse * 1.2;
          ctx!.shadowColor = spColor;
          ctx!.shadowBlur = 18 + bloomPulse * 14;
          ctx!.beginPath();
          ctx!.arc(x, y, prodR + 18 + bloomPulse * 3, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.globalAlpha = 1;
          ctx!.shadowBlur = 0;
        }

        if (!isRevealed) {
          // ── Fog of War + green scan line ────────────────────────────
          const r = FOG_R;

          // Sweeping green scanline (one horizontal line that moves vertically across the planet)
          const scanPeriod = 4; // seconds
          const scanPhase = ((t + planet.x * 0.05) % scanPeriod) / scanPeriod;
          const scanY = y - r + scanPhase * r * 2;
          ctx!.strokeStyle = '#00ff8844';
          ctx!.lineWidth = 2;
          ctx!.beginPath();
          // Only draw within the circle (clip-like approach: just draw short line)
          const dx = Math.sqrt(Math.max(0, r * r - (scanY - y) ** 2));
          if (dx > 0) {
            ctx!.moveTo(x - dx, scanY);
            ctx!.lineTo(x + dx, scanY);
            ctx!.stroke();
          }

          // Outer ring
          ctx!.strokeStyle = isSelected ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.1)';
          ctx!.lineWidth = isSelected ? 1.5 : 1;
          ctx!.setLineDash([3, 6]);
          ctx!.beginPath();
          ctx!.arc(x, y, r + 9, 0, Math.PI * 2);
          ctx!.stroke();

          // Body — flat diffuse gradient (matte, no hot-spot)
          ctx!.setLineDash([]);
          ctx!.shadowColor = isSelected ? 'rgba(255,255,255,0.3)' : 'transparent';
          ctx!.shadowBlur = isSelected ? 16 : 0;
          const fogBase = ctx!.createRadialGradient(
            x - r * 0.2, y - r * 0.2, r * 0.1,
            x, y, r
          );
          fogBase.addColorStop(0,    isSelected ? 'rgba(200,200,215,0.48)' : 'rgba(140,138,152,0.34)');
          fogBase.addColorStop(0.7,  isSelected ? 'rgba(130,130,148,0.36)' : 'rgba(95,93,108,0.26)');
          fogBase.addColorStop(1,    isSelected ? 'rgba(60,60,78,0.24)'    : 'rgba(38,36,50,0.16)');
          ctx!.fillStyle = fogBase;
          ctx!.beginPath();
          ctx!.arc(x, y, r, 0, Math.PI * 2);
          ctx!.fill();

          // Limb darkening only — no specular
          ctx!.shadowBlur = 0;
          const fogLimb = ctx!.createRadialGradient(x, y, r * 0.42, x, y, r);
          fogLimb.addColorStop(0,    'rgba(0,0,0,0)');
          fogLimb.addColorStop(0.62, 'rgba(0,0,0,0)');
          fogLimb.addColorStop(1,    'rgba(0,0,0,0.55)');
          ctx!.fillStyle = fogLimb;
          ctx!.beginPath();
          ctx!.arc(x, y, r, 0, Math.PI * 2);
          ctx!.fill();

          ctx!.restore();
          continue;
        }

        // ── Revealed Planet ─────────────────────────────────────────────
        const prodR = getProdR(planet);
        // Fraction of the *viewing player's* total ships on this planet
        // For enemy planets we still show a proportional ring but relative to 0 (unknown)
        const shipFrac = isMyPlanet && totalShips > 0 ? planet.ships / totalShips : 0;
        const shield = getShield(planet.ships, isMyPlanet ? shipFrac : Math.min(1, planet.ships / 60));
        const shieldR = prodR + shield.extraR;
        const baseColor = isMyPlanet ? '#e8e8e0' : isOwned ? '#c47070' : '#6e6e80';

        // ── 1. Neon pixel-glow shield ring (2-pass) ───────────────────
        const pulsePeriod = isTarget ? 0.8 : isMyPlanet ? 3 : 2;
        const pulse = 0.5 + 0.5 * Math.sin(t * (Math.PI * 2 / pulsePeriod));
        const pulseOpacity = shield.opacity * (0.6 + 0.4 * pulse);
        const pulseR = shieldR + pulse * 1.5;
        // Pass 1: wide outer glow halo
        ctx!.globalAlpha = pulseOpacity * 0.55;
        ctx!.strokeStyle = shield.color;
        ctx!.lineWidth = (shield.lineWidth + pulse * 0.5) * 2.4;
        ctx!.shadowColor = shield.color;
        ctx!.shadowBlur = (shield.blur + 8) * (0.7 + 0.3 * pulse);
        ctx!.setLineDash([]);
        ctx!.beginPath();
        ctx!.arc(x, y, pulseR, 0, Math.PI * 2);
        ctx!.stroke();

        // Pass 2: crisp bright inner ring on top
        ctx!.globalAlpha = Math.min(1, pulseOpacity * 1.3);
        ctx!.lineWidth = Math.max(1.0, shield.lineWidth * 0.55);
        ctx!.shadowBlur = 4;
        ctx!.beginPath();
        ctx!.arc(x, y, pulseR, 0, Math.PI * 2);
        ctx!.stroke();

        // ── 3. Inner planet (production core) ─────────────────────────
        ctx!.globalAlpha = 1;
        // Spotlight planet: greatly boosted glow using the spotlight colour
        ctx!.shadowBlur  = isSpotlight ? 50 : isSelected ? 28 : isMyPlanet ? 10 : 4;
        ctx!.shadowColor = isSpotlight && spColor
          ? hexToRgba(spColor, 0.85)
          : isSelected ? 'rgba(255,255,255,0.6)' : baseColor + '88';

        // Brighter gradient for the spotlight planet — blend base colour
        const bc = isSpotlight ? blendHexToWhite(baseColor, 0.25) : baseColor;
        const grad = ctx!.createRadialGradient(
          x - prodR * 0.38, y - prodR * 0.38, prodR * 0.05, x, y, prodR
        );
        grad.addColorStop(0,    bc);
        grad.addColorStop(0.55, bc + (isSpotlight ? 'ee' : 'cc'));
        grad.addColorStop(1,    bc + (isSpotlight ? '88' : '44'));
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(x, y, prodR, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.shadowBlur = 0;

        // ── 3a. Limb darkening ────────────────────────────────────────
        const limbGrad = ctx!.createRadialGradient(x, y, prodR * 0.45, x, y, prodR);
        limbGrad.addColorStop(0,   'rgba(0,0,0,0)');
        limbGrad.addColorStop(0.65,'rgba(0,0,0,0)');
        limbGrad.addColorStop(1,   'rgba(0,0,0,0.50)');
        ctx!.fillStyle = limbGrad;
        ctx!.beginPath();
        ctx!.arc(x, y, prodR, 0, Math.PI * 2);
        ctx!.fill();

        // ── 3b. Specular highlight ────────────────────────────────────
        const specX = x - prodR * 0.32, specY = y - prodR * 0.32;
        const specGrad = ctx!.createRadialGradient(specX, specY, 0, specX, specY, prodR * 0.42);
        specGrad.addColorStop(0,   'rgba(255,255,255,0.18)');
        specGrad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        specGrad.addColorStop(1,   'rgba(255,255,255,0)');
        ctx!.fillStyle = specGrad;
        ctx!.beginPath();
        ctx!.arc(x, y, prodR, 0, Math.PI * 2);
        ctx!.fill();


        // ── 4. Selection ring ─────────────────────────────────────────
        if (isSelected) {
          ctx!.shadowBlur = 0;
          ctx!.globalAlpha = 0.85;
          ctx!.strokeStyle = '#ffffff';
          ctx!.lineWidth = 2;
          ctx!.setLineDash(isOrigin ? [] : [5, 5]);
          ctx!.beginPath();
          ctx!.arc(x, y, shieldR + 8, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.setLineDash([]);
        }

        // ── 5. Targeting reticle (target planet only) ──────────────────
        if (isTarget) {
          ctx!.shadowBlur = 0;
          ctx!.globalAlpha = 0.6 + 0.3 * pulse;
          ctx!.strokeStyle = '#ff4444';
          ctx!.lineWidth = 1.5;
          const retR = shieldR + 14;
          const bLen = 6;
          // 4 corner brackets at cardinal positions
          for (let a = 0; a < 4; a++) {
            const angle = a * Math.PI / 2 + t * 0.3;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const px = x + cos * retR, py = y + sin * retR;
            ctx!.beginPath();
            ctx!.moveTo(px - sin * bLen, py + cos * bLen);
            ctx!.lineTo(px, py);
            ctx!.lineTo(px + sin * bLen, py - cos * bLen);
            ctx!.stroke();
          }
        }

        ctx!.globalAlpha = 1;
        ctx!.shadowBlur = 0;

        // ── 6. Production label (center) ──────────────────────────────
        const prodFontSize = prodR >= 18 ? 10 : 9;
        ctx!.font = `bold ${prodFontSize}px "Press Start 2P", monospace`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.shadowColor = 'rgba(0,0,0,0.6)';
        ctx!.shadowBlur = 3;
        ctx!.shadowOffsetY = 1;
        ctx!.fillStyle = isMyPlanet ? '#06060e' : '#ffffff';
        if (isMyPlanet) {
          ctx!.fillText(String(planet.productionBase ?? 0), x, y);
        }
        ctx!.shadowBlur = 0;
        ctx!.shadowOffsetY = 0;

        // ── 7. Ship count above shield ────────────────────────────────
        const shipLabel = String(planet.ships);
        const shipY = y - shieldR - 6; // Tight to the ring edge
        ctx!.font = '9px "Press Start 2P", monospace';
        ctx!.textBaseline = 'bottom';
        // 1px 8-bit outline for the smaller size
        ctx!.fillStyle = '#000000';
        for (const [ox, oy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
          ctx!.fillText(shipLabel, x + ox, shipY + oy);
        }
        ctx!.fillStyle = '#ffffff';
        ctx!.shadowColor = 'rgba(0,0,0,0.8)';
        ctx!.shadowBlur = 4;
        ctx!.shadowOffsetY = 2;
        ctx!.fillText(shipLabel, x, shipY);
        ctx!.shadowBlur = 0;
        ctx!.shadowOffsetY = 0;

        ctx!.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, []); // Empty deps: loop reads from refs

  // ── Click ───────────────────────────────────────────────────────────────
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dims.w === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // On small screens the map is fit-to-viewport so planets are smaller —
    // boost hit radius to keep tapping comfortable.
    const hitScale = dims.w <= 768 ? 1.6 : 1.0;

    if (onOrderCancel) {
      const cancelHit = pendingOrders.find((order) => {
        const fp = planets.find((p) => p.id === order.fromPlanetId);
        const tp = planets.find((p) => p.id === order.toPlanetId);
        if (!fp || !tp) return false;
        const from = toPixel(fp), to = toPixel(tp);
        return Math.hypot(mx - (from.x + to.x) / 2, my - (from.y + to.y) / 2) <= 24 * hitScale;
      });
      if (cancelHit) { onOrderCancel(cancelHit.id); return; }
    }

    const revealedSet = new Set(player?.revealedPlanets ?? []);
    const hit = planets.find((p) => {
      const { x, y } = toPixel(p);
      const isRevealed = revealedSet.has(p.id) || p.owner === player?.uid;
      const hitR = (isRevealed ? getHitR(p) : FOG_R + 12) * hitScale;
      return Math.hypot(mx - x, my - y) <= hitR;
    });

    if (hit) onPlanetClick(hit, mx, my);
  }

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }} className={className}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ display: 'block', cursor: 'crosshair' }}
        aria-label="Space game board"
      />
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number
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

/**
 * Blend a CSS #rrggbb hex colour toward white by factor (0 = unchanged, 1 = white).
 * Returns the blended colour as a #rrggbb string.
 */
function blendHexToWhite(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const blend = (c: number) => Math.round(c + (255 - c) * factor).toString(16).padStart(2, '0');
  return '#' + blend(r) + blend(g) + blend(b);
}

/** Parse #rrggbb to "r,g,b" string for use in rgba(). */
function parseHexRGB(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

/** Convert #rrggbb + alpha to an rgba() string. */
function hexToRgba(hex: string, alpha: number): string {
  return `rgba(${parseHexRGB(hex)},${alpha})`;
}

