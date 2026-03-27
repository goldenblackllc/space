'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Planet, Fleet, Player } from '@/lib/types';

interface CanvasProps {
  planets: Planet[];
  fleets: Fleet[];
  player: Player | null;
  currentYear: number;
  onPlanetClick?: (planet: Planet) => void;
}

const PLANET_BASE_RADIUS = 14;
const MAX_EXTRA_RADIUS = 12;

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dims.w;
    canvas.height = dims.h;
    ctx.clearRect(0, 0, dims.w, dims.h);

    const revealedSet = new Set(player?.revealedPlanets ?? []);

    // Assign stable index to each planet for labelling
    const sortedIds = [...planets].sort((a, b) => a.id.localeCompare(b.id)).map(p => p.id);
    const planetIndex = (id: string) => sortedIds.indexOf(id) + 1;

    // ── Fleet travel lines ────────────────────────────────────────────────
    for (const fleet of fleets) {
      const fromPlanet = planets.find((p) => p.id === fleet.fromPlanetId);
      const toPlanet = planets.find((p) => p.id === fleet.toPlanetId);
      if (!fromPlanet || !toPlanet) continue;

      const from = toPixel(fromPlanet);
      const to = toPixel(toPlanet);
      const totalYears = fleet.arriveYear - fleet.departYear;
      const progress = Math.min(1, (currentYear - fleet.departYear) / totalYears);
      const fleetX = from.x + (to.x - from.x) * progress;
      const fleetY = from.y + (to.y - from.y) * progress;

      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = 'rgba(123, 123, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      ctx.fillStyle = '#7b7bff';
      ctx.shadowColor = '#7b7bff';
      ctx.shadowBlur = 12;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(fleetX, fleetY, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Planets ───────────────────────────────────────────────────────────
    for (const planet of planets) {
      const { x, y } = toPixel(planet);
      const isRevealed = revealedSet.has(planet.id) || planet.owner === player?.uid;
      const isHome = planet.isHome && planet.owner === player?.uid;
      const isSelected = selected?.id === planet.id;
      const isOwned = !!planet.owner;
      const isMyPlanet = planet.owner === player?.uid;
      const idx = planetIndex(planet.id);

      ctx.save();

      if (!isRevealed) {
        // ── Fog of War: clearly visible but mysterious ──────────────────
        const fogRadius = 14;
        const fogColor = isSelected ? 'rgba(200, 200, 255, 0.6)' : 'rgba(140, 140, 180, 0.5)';

        // Subtle outer ring
        ctx.strokeStyle = 'rgba(160, 160, 220, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(x, y, fogRadius + 8, 0, Math.PI * 2);
        ctx.stroke();

        // Filled circle
        ctx.setLineDash([]);
        ctx.fillStyle = fogColor;
        ctx.shadowColor = 'rgba(160,160,255,0.4)';
        ctx.shadowBlur = isSelected ? 16 : 6;
        ctx.beginPath();
        ctx.arc(x, y, fogRadius, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (isSelected) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, fogRadius + 8, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Planet number
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 11px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${idx}`, x, y);

        ctx.restore();
        continue;
      }

      // ── Revealed planet ───────────────────────────────────────────────
      const radius = PLANET_BASE_RADIUS + Math.min(MAX_EXTRA_RADIUS, (planet.ships / 40) * MAX_EXTRA_RADIUS);

      const planetColor = isHome
        ? '#44ffaa'
        : isMyPlanet
        ? '#7b7bff'
        : isOwned
        ? '#ff5577'
        : '#8888bb';

      ctx.shadowColor = planetColor;
      ctx.shadowBlur = isSelected ? 28 : 16;

      const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
      grad.addColorStop(0, planetColor);
      grad.addColorStop(1, planetColor + '55');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Ship count
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = `bold ${radius > 12 ? 11 : 9}px "Space Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(planet.ships), x, y);

      // Planet number label (above)
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '10px "Space Mono", monospace';
      ctx.fillText(`#${idx}`, x, y - radius - 9);

      ctx.restore();
    }
  }, [planets, fleets, player, selected, dims, toPixel, currentYear]);

  function getPlanetRadius(p: Planet, isRevealed: boolean) {
    if (!isRevealed) return 14 + 8; // fogRadius + hit margin
    return PLANET_BASE_RADIUS + Math.min(MAX_EXTRA_RADIUS, (p.ships / 40) * MAX_EXTRA_RADIUS) + 8;
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dims.w === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const revealedSet = new Set(player?.revealedPlanets ?? []);

    const hitPlanet = planets.find((p) => {
      const { x, y } = toPixel(p);
      const isRevealed = revealedSet.has(p.id) || p.owner === player?.uid;
      return Math.hypot(mx - x, my - y) <= getPlanetRadius(p, isRevealed);
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
          padding: '10px 20px',
          color: 'var(--text-secondary)',
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          {selected.owner === player?.uid
            ? <><span style={{ color: '#7b7bff' }}>★ {selected.ships} ships</span> · Select in Fleet Orders to queue a launch</>
            : <><span style={{ color: 'var(--text-primary)' }}>Target planet selected</span> · Add as destination in Fleet Orders</>
          }
        </div>
      )}
    </div>
  );
}
