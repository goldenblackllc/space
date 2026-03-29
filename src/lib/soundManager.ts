/**
 * SoundManager — 8-bit retro arcade sounds via Web Audio API
 * Zero external dependencies; all sounds are synthesized in-browser.
 */

type AudioCtx = AudioContext;

class SoundManager {
  private ctx: AudioCtx | null = null;
  private unlocked = false;

  // ── AudioContext lazy init ─────────────────────────────────────────────────
  private getCtx(): AudioCtx | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor() as AudioCtx;
    }
    return this.ctx;
  }

  // ── Autoplay unlock (call once on first user gesture) ─────────────────────
  unlock() {
    if (this.unlocked) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {/* ignore */});
    }
    this.unlocked = true;
  }

  // ── Convenience: init unlock listener ─────────────────────────────────────
  /** Call this once on mount. Attaches a one-shot document click listener. */
  initAutoUnlock() {
    if (typeof document === 'undefined') return;
    const handler = () => {
      this.unlock();
      document.removeEventListener('click', handler);
    };
    document.addEventListener('click', handler);
  }

  // ── playBlip ──────────────────────────────────────────────────────────────
  /** Very short (0.05s) quiet sine at 400Hz — standard UI feedback. */
  playBlip() {
    const ctx = this.getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, ctx.currentTime);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  }

  // ── playLaser ─────────────────────────────────────────────────────────────
  /** Rapid descending sawtooth 800Hz→200Hz over 0.1s — classic "pew". */
  playLaser() {
    const ctx = this.getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  }

  // ── playExplosion ─────────────────────────────────────────────────────────
  /** White noise + low-freq square wave with rapid volume decay — crunchy "boom". */
  playExplosion() {
    const ctx = this.getCtx();
    if (!ctx) return;

    const duration = 0.38;

    // ① White noise buffer
    const bufferSize = ctx.sampleRate * duration;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    // ② Low square wave sub-thump
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(60, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + duration);

    // ③ Shared gain envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    noise.connect(gain);
    osc.connect(gain);
    gain.connect(ctx.destination);

    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  // ── playJackpot ───────────────────────────────────────────────────────────
  /** Fast ascending square arpeggio (C5→E5→G5) — positive event jingle. */
  playJackpot() {
    const ctx = this.getCtx();
    if (!ctx) return;

    // C5=523.25, E5=659.25, G5=783.99
    const notes = [523.25, 659.25, 783.99];
    const stepDur = 0.065; // seconds per note
    const noteDur = 0.06;

    notes.forEach((freq, i) => {
      const startTime = ctx.currentTime + i * stepDur;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.22, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDur);

      osc.start(startTime);
      osc.stop(startTime + noteDur + 0.01);
    });
  }
}

// Singleton export
const soundManager = new SoundManager();
export default soundManager;
