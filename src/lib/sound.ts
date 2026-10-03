'use client';

// Short synthesized tones (Web Audio oscillators) — no asset files needed.
// Browsers block audio until a user gesture; unlockAudio() must be called
// from a click handler, per CLAUDE.md §8.

type SoundKind = 'press' | 'correct' | 'wrong';

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  ctx = new AudioContextCtor();
}

export function isAudioUnlocked(): boolean {
  return ctx !== null;
}

function tone(freq: number, startOffset: number, duration: number, type: OscillatorType, gainPeak: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = ctx.currentTime + startOffset;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

export function playSound(kind: SoundKind): void {
  if (!ctx) return;
  switch (kind) {
    case 'press':
      tone(440, 0, 0.1, 'square', 0.15);
      break;
    case 'correct':
      tone(523.25, 0, 0.12, 'sine', 0.2); // C5
      tone(659.25, 0.1, 0.12, 'sine', 0.2); // E5
      tone(783.99, 0.2, 0.3, 'sine', 0.22); // G5
      break;
    case 'wrong':
      tone(220, 0, 0.2, 'sawtooth', 0.12);
      tone(185, 0.15, 0.3, 'sawtooth', 0.12);
      break;
  }
}
