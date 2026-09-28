/**
 * sfx.ts — every sound in the game is synthesised on the fly with the
 * Web Audio API: oscillators (tones), noise bursts and envelopes. No audio
 * files to download, and each sound is a few lines you can tweak.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is
 * created lazily on the first sound (which is always triggered by a click).
 */

import { settings } from '../app/store.ts';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!settings.value.sound) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    master!.gain.value = settings.value.volume * 0.5;
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

interface ToneOpts {
  freq: number;
  to?: number; // glide target frequency
  type?: OscillatorType;
  dur?: number; // seconds
  delay?: number;
  gain?: number;
  attack?: number;
  detune?: number;
}

function tone(o: ToneOpts): void {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + (o.delay ?? 0);
  const dur = o.dur ?? 0.15;
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  if (o.detune) osc.detune.value = o.detune;
  // Envelope: quick attack, exponential decay (avoids clicks).
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t0 + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain = 0.2, delay = 0, filterFreq = 2000): void {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + delay;
  const buffer = a.ctx.createBuffer(1, Math.ceil(a.ctx.sampleRate * dur), a.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.ctx.createBufferSource();
  src.buffer = buffer;
  const filter = a.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const g = a.ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.out);
  src.start(t0);
}

export const sfx = {
  click: () => tone({ freq: 660, dur: 0.05, gain: 0.08, type: 'triangle' }),
  select: () => tone({ freq: 520, to: 700, dur: 0.08, gain: 0.1, type: 'triangle' }),
  error: () => {
    tone({ freq: 220, dur: 0.12, gain: 0.12, type: 'square' });
    tone({ freq: 180, dur: 0.14, gain: 0.1, type: 'square', delay: 0.08 });
  },
  place: () => {
    tone({ freq: 440, to: 520, dur: 0.12, gain: 0.25, type: 'triangle' });
    noise(0.05, 0.08, 0, 3000);
  },
  /** Two slightly detuned voices: one token, two places. */
  split: () => {
    tone({ freq: 523, dur: 0.35, gain: 0.16, detune: -12 });
    tone({ freq: 523, dur: 0.35, gain: 0.16, detune: 12, delay: 0.03 });
    tone({ freq: 784, to: 1046, dur: 0.3, gain: 0.08, delay: 0.08 });
  },
  /** Two tones that swap places. */
  link: () => {
    tone({ freq: 392, to: 587, dur: 0.3, gain: 0.16, type: 'sine' });
    tone({ freq: 587, to: 392, dur: 0.3, gain: 0.16, type: 'sine' });
  },
  /** A camera-shutter "click" and a clear tone. */
  observe: () => {
    noise(0.07, 0.25, 0, 1500);
    tone({ freq: 880, dur: 0.25, gain: 0.12, delay: 0.06, type: 'sine' });
  },
  /** Beating tones (interference, audible!) resolving into one note. */
  merge: () => {
    tone({ freq: 440, dur: 0.5, gain: 0.14 });
    tone({ freq: 446, dur: 0.5, gain: 0.14 });
    tone({ freq: 660, dur: 0.25, gain: 0.1, delay: 0.4 });
  },
  tick: () => tone({ freq: 1200, dur: 0.02, gain: 0.05, type: 'square' }),
  land: () => {
    tone({ freq: 523, dur: 0.18, gain: 0.18, type: 'triangle' });
    tone({ freq: 659, dur: 0.18, gain: 0.16, type: 'triangle', delay: 0.07 });
    tone({ freq: 784, dur: 0.35, gain: 0.16, type: 'triangle', delay: 0.14 });
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.3, gain: 0.16, delay: i * 0.1, type: 'triangle' }));
  },
  lose: () => {
    [392, 349, 311].forEach((f, i) => tone({ freq: f, dur: 0.35, gain: 0.14, delay: i * 0.14, type: 'sine' }));
  },
  draw: () => {
    tone({ freq: 440, dur: 0.25, gain: 0.14, type: 'triangle' });
    tone({ freq: 440, dur: 0.3, gain: 0.12, type: 'triangle', delay: 0.18 });
  },
  chat: () => tone({ freq: 988, dur: 0.08, gain: 0.08, type: 'sine' }),
  join: () => tone({ freq: 660, to: 880, dur: 0.15, gain: 0.1, type: 'sine' }),
};
