"use client";

/**
 * «Ka-ching» de caja registradora para cada venta con el panel abierto. Sintetizado con Web Audio (no es el archivo de Shopify, que es de ellos): el golpe del cajón
 * y dos campanas brillantes. Los navegadores solo dejan sonar después de que tocaste la página una vez:
 * el contexto se prepara en el primer toque.
 */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx ??= new C();
  return ctx;
}

if (typeof window !== "undefined") {
  const wake = () => { void ac()?.resume().catch(() => {}); };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, wake, { passive: true, capture: true });
}

function bell(c: AudioContext, at: number, f: number, gain: number) {
  // Campana: fundamental + parciales inarmónicos que se apagan rápido.
  for (const [mult, g, dec] of [[1, 1, 0.9], [2.76, 0.45, 0.45], [5.4, 0.25, 0.25], [8.93, 0.12, 0.15]] as const) {
    const o = c.createOscillator(), v = c.createGain();
    o.type = "sine"; o.frequency.value = f * mult;
    v.gain.setValueAtTime(0, at);
    v.gain.linearRampToValueAtTime(gain * g, at + 0.004);
    v.gain.exponentialRampToValueAtTime(0.0001, at + dec);
    o.connect(v).connect(c.destination);
    o.start(at); o.stop(at + dec + 0.05);
  }
}

function clack(c: AudioContext, at: number) {
  // El cajón: un golpe de ruido corto y filtrado.
  const len = Math.floor(c.sampleRate * 0.06);
  const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), v = c.createGain();
  s.buffer = buf; f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.8; v.gain.value = 0.5;
  s.connect(f).connect(v).connect(c.destination);
  s.start(at);
}

export function playCashSound() {
  const c = ac();
  if (!c) return;
  void c.resume().catch(() => {});
  const t = c.currentTime + 0.02;
  clack(c, t);
  bell(c, t + 0.07, 1568, 0.22); // G6
  bell(c, t + 0.17, 2093, 0.26); // C7
}
