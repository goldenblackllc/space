'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Planet, Fleet, Player } from '@/lib/types';

interface CanvasProps {
  planets: Planet[];
  fleets: Fleet[];
  player: Player | null;
  currentYear: number;
  onFleetDispatch?: (from: Planet, to: Planet) => void;
}

const PLANET_BASE_RADIUS = 7;
const MAX_EXTRA_RADIUS = 8; // grows with ship count

export default function Canvas({
  planets,
  fleets,
  player,
  currentYear,
  onFleetDispatch,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Planet | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // Convert percentage coords to pixel coords
  const toPixel = useCallback(
    (planet: Planet) => ({
      x: (planet.x / 100) * dims.w,
      y: (planet.y / 100) * dims.h,
    }),
    [dims]
  );

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

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dims.w;
    canvas.height = dims.h;

    ctx.clearRect(0, 0, dims.w, dims.h);

    const revealedSet = new Set(player?.revealedPlanets ?? []);

    // ── Fleets (travel lines) ─────────────────────────────────────────────
    for (const fleet of fleets) {
      const fromPlanet = planets.find((p) => p.id === fleet.fromPlanetId);
      const toPlanet = planets.find((p) => p.id === fleet.toPlanetId);
      if (!fromPlanet || !toPlanet) continue;

      const from = toPixel(fromPlanet);
      const to = toPixel(toPlanet);

      // Progress interpolation
      const totalYears = fleet.arriveYear - fleet.departYear;
      const progress = Math.min(1, (currentYear - fleet.departYear) / totalYears);
      const fleetX = from.x + (to.x - from.x) * progress;
      const fleetY = from.y + (to.y - from.y) * progress;

      // Dashed travel line
      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = 'rgba(123, 123, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();

      // Fleet dot
      ctx.save();
      ctx.fillStyle = '#7b7bff';
      ctx.shadowColor = '#7b7bff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(fleetX, fleetY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Selection line ────────────────────────────────────────────────────
    if (selected) {
      const sel = toPixel(selected);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sel.x, sel.y);
      // Draw crosshair
      ctx.arc(sel.x, sel.y, PLANET_BASE_RADIUS + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Planets ───────────────────────────────────────────────────────────
    for (const planet of planets) {
      const { x, y } = toPixel(planet);
      const isRevealed = revealedSet.has(planet.id) || planet.owner === player?.uid;
      const isHome = planet.isHome && planet.owner === player?.uid;
      const isSelected = selected?.id === planet.id;
      const isOwned = !!planet.owner;
      const radius = PLANET_BASE_RADIUS + Math.min(MAX_EXTRA_RADIUS, planet.ships / 20 * MAX_EXTRA_RADIUS);

      ctx.save();

      if (!isRevealed) {
        // Fog of War — dim, unidentified dot
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#444466';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      // Glow
      const glowColor = isHome
        ? 'rgba(68, 255, 170, 0.4)'
        : planet.owner === player?.uid
        ? 'rgba(123, 123, 255, 0.35)'
        : isOwned
        ? 'rgba(255, 85, 119, 0.3)'
        : 'rgba(180, 180, 255, 0.15)';

      ctx.shadowColor = glowColor.replace(/[\d.]+\)$/, '1)');
      ctx.shadowBlur = isSelected ? 24 : 14;

      // Planet fill gradient
      const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
      const planetColor = isHome
        ? '#44ffaa'
        : planet.owner === player?.uid
        ? '#7b7bff'
        : isOwned
        ? '#ff5577'
        : '#666688';

      grad.addColorStop(0, planetColor);
      grad.addColorStop(1, planetColor + '66');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Ship count label
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${radius > 10 ? 11 : 9}px "Space Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(planet.ships), x, y);

      ctx.restore();
    }
  }, [planets, fleets, player, selected, dims, toPixel, currentYear]);

  // Click handler
  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dims.w === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hitPlanet = planets.find((p) => {
      const { x, y } = toPixel(p);
      return Math.hypot(mx - x, my - y) <= PLANET_BASE_RADIUS + MAX_EXTRA_RADIUS + 4;
    });

    if (!hitPlanet) {
      setSelected(null);
      return;
    }

    if (selected && selected.id !== hitPlanet.id) {
      // Second click → dispatch fleet
      onFleetDispatch?.(selected, hitPlanet);
      setSelected(null);
    } else {
      setSelected(hitPlanet);
    }
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
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(13, 13, 26, 0.9)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(123, 123, 255, 0.25)',
            borderRadius: 8,
            padding: '10px 20px',
            color: 'var(--text-secondary)',
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>{selected.ships} ships</span>
          &nbsp;·&nbsp;click a target planet to launch fleet
        </div>
      )}
    </div>
  );
}
