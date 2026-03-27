'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Planet, Fleet, Player } from '@/lib/types';

interface CanvasProps {
  planets: Planet[];
  fleets: Fleet[];
  player: Player | null;
  currentYear: number;
  onPlanetClick?: (planet: Planet) => void;
}

// ── Much larger sizes ──
const PLANET_MIN_RADIUS = 22;
const PLANET_MAX_RADIUS = 40;
const FOG_RADIUS = 18;

export default function Canvas({
  planets,
  fleets,
  player,
  currentYear,
  onPlanetClick,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Planet | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const toPixel = useCallback(
    (planet: Planet) => ({
      x: (planet.x / 100) * dims.w,
      y: (planet.y / 100) * dims.h,
    }),
    [dims]
  );

  // Stable planet index
  const sortedIds = useMemo(
    () => [...planets].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.id),
    [planets]
  );
  const planetIndex = (id: string) => sortedIds.indexOf(id) + 1;

  // Resize observer
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setDims({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  function getRadius(planet: Planet) {
    const t = Math.min(1, planet.ships / 60);
    return PLANET_MIN_RADIUS + t * (PLANET_MAX_RADIUS - PLANET_MIN_RADIUS);
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
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, dims.w, dims.h);

    const revealedSet = new Set(player?.revealedPlanets ?? []);

    // ── Planets ──────────────────────────────────────────────────────────
    for (const planet of planets) {
      const { x, y } = toPixel(planet);
      const isRevealed = revealedSet.has(planet.id) || planet.owner === player?.uid;
      const isHome = planet.isHome && planet.owner === player?.uid;
      const isSelected = selected?.id === planet.id;
      const isMyPlanet = planet.owner === player?.uid;
      const isOwned = !!planet.owner;
      const idx = planetIndex(planet.id);

      ctx.save();

      if (!isRevealed) {
        // ── FOG OF WAR ──────────────────────────────────────────────────
        const r = FOG_RADIUS;

        // Outer dashed ring
        ctx.strokeStyle = 'rgba(180, 180, 230, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(x, y, r + 10, 0, Math.PI * 2);
        ctx.stroke();

        // Filled body
        ctx.setLineDash([]);
        const fogGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
        fogGrad.addColorStop(0, isSelected ? 'rgba(180,180,255,0.65)' : 'rgba(150,150,200,0.50)');
        fogGrad.addColorStop(1, isSelected ? 'rgba(120,120,200,0.35)' : 'rgba(100,100,160,0.20)');
        ctx.fillStyle = fogGrad;
        ctx.shadowColor = 'rgba(160,160,255,0.5)';
        ctx.shadowBlur = isSelected ? 20 : 8;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (isSelected) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(x, y, r + 14, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Planet index + "?" indicator
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 13px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`#${idx}`, x, y - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '10px "Space Mono", monospace';
        ctx.fillText('?', x, y + 10);

        ctx.restore();
        continue;
      }

      // ── REVEALED PLANET ───────────────────────────────────────────────
      const radius = getRadius(planet);

      const planetColor = isHome
        ? '#44ffaa'
        : isMyPlanet
        ? '#7b7bff'
        : isOwned
        ? '#ff5577'
        : '#8888bb';

      // Glow
      ctx.shadowColor = planetColor;
      ctx.shadowBlur = isSelected ? 32 : 20;

      // Fill gradient
      const grad = ctx.createRadialGradient(
        x - radius * 0.25, y - radius * 0.25, 0,
        x, y, radius
      );
      grad.addColorStop(0, planetColor);
      grad.addColorStop(0.7, planetColor + 'aa');
      grad.addColorStop(1, planetColor + '33');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── Ship count (large, centered) ──────────────────────────────────
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${radius >= 30 ? 16 : 14}px "Space Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(planet.ships), x, y);

      // ── Planet index label (above planet) ─────────────────────────────
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '11px "Space Mono", monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`#${idx}`, x, y - radius - 6);

      ctx.restore();
    }
  }, [planets, fleets, player, selected, dims, toPixel, currentYear, sortedIds]);

  // ── Click handler ───────────────────────────────────────────────────────
  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dims.w === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const revealedSet = new Set(player?.revealedPlanets ?? []);

    const hitPlanet = planets.find((p) => {
      const { x, y } = toPixel(p);
      const isRevealed = revealedSet.has(p.id) || p.owner === player?.uid;
      const hitR = isRevealed ? getRadius(p) + 10 : FOG_RADIUS + 14;
      return Math.hypot(mx - x, my - y) <= hitR;
    });

    if (!hitPlanet) {
      setSelected(null);
      return;
    }

    setSelected(hitPlanet.id === selected?.id ? null : hitPlanet);
    onPlanetClick?.(hitPlanet);
  }

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ display: 'block', cursor: 'crosshair', width: '100%', height: '100%' }}
        aria-label="Space game board"
      />
      {selected && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(13,13,26,0.92)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(123,123,255,0.3)',
          borderRadius: 8,
          padding: '12px 24px',
          color: 'var(--text-secondary)',
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          {selected.owner === player?.uid
            ? <><span style={{ color: '#7b7bff', fontWeight: 700 }}>Planet #{planetIndex(selected.id)} · {selected.ships} ships</span> — use Fleet Orders to deploy</>
            : <><span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Target #{planetIndex(selected.id)}</span> — add as destination in Fleet Orders</>
          }
        </div>
      )}
    </div>
  );
}
