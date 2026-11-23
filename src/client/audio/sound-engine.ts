export type SoundCue = 'move' | 'capture' | 'check' | 'castle' | 'end';

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  endFreq: number,
  durationSec: number,
  gainPeak: number,
  type: OscillatorType = 'triangle',
  delaySec = 0,
): void {
  const t0 = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + durationSec);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationSec + 0.01);
}

export function playSound(cue: SoundCue, enabled: boolean): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  switch (cue) {
    case 'move':
      playTone(ctx, 210, 110, 0.065, 0.14, 'triangle');
      break;
    case 'capture':
      playTone(ctx, 320, 95, 0.09, 0.2, 'sawtooth');
      break;
    case 'castle':
      playTone(ctx, 200, 115, 0.055, 0.13, 'triangle', 0);
      playTone(ctx, 240, 130, 0.06, 0.13, 'triangle', 0.07);
      break;
    case 'check':
      playTone(ctx, 560, 420, 0.14, 0.16, 'sine');
      break;
    case 'end':
      playTone(ctx, 392, 392, 0.14, 0.13, 'triangle', 0);
      playTone(ctx, 523.25, 523.25, 0.22, 0.14, 'triangle', 0.13);
      break;
  }
}
