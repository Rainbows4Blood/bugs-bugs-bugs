import { BEAT } from '../config.js';
import { smoothstep } from '../core/util.js';
import { CUTS } from './director.js';

// Optional soundtrack, synthesised live with Web Audio (no samples): a low
// drone that opens up as the building is corrupted, the dry skitter of legs,
// a two-tone alarm, and one-shots for the story beats. Off until the viewer
// asks for it, since browsers will not start audio without a gesture.
//
// Pass an OfflineAudioContext to build the same graph for an offline render
// (see renderSoundtrack below); that instance is live from the start.

export function createAudio(offline = null) {
  let ctx = null;
  let n = null;
  let enabled = false;
  let lastTime = null;

  const noise = (seconds, fn) => {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    fn(buf.getChannelData(0), len);
    return buf;
  };
  const loopSource = (buffer) => {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start();
    return s;
  };
  const gain = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type, freq, q = 1) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };

  function build() {
    ctx = offline ?? new (window.AudioContext || window.webkitAudioContext)();
    const master = gain(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 8;
    master.connect(comp).connect(ctx.destination);

    // drone
    const droneFilter = filter('lowpass', 130, 4);
    const droneGain = gain(0);
    for (const f of [55, 55.7, 82.5, 27.5]) {
      const o = ctx.createOscillator();
      const sub = f < 30;
      o.type = sub ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      // the sub is felt more than heard: kept low so it does not eat the headroom
      if (sub) o.connect(gain(0.5)).connect(droneFilter);
      else o.connect(droneFilter);
      o.start();
    }
    droneFilter.connect(droneGain).connect(master);

    // night air
    const air = loopSource(
      noise(4, (d, len) => {
        let b = 0;
        for (let i = 0; i < len; i++) {
          b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          d[i] = b * 3.2;
        }
      }),
    );
    const airGain = gain(0.05);
    air.connect(filter('lowpass', 480)).connect(airGain).connect(master);

    // skitter: thousands of tiny dry clicks
    const skitter = loopSource(
      noise(3, (d, len) => {
        for (let k = 0; k < 2600; k++) {
          const at = Math.floor(Math.random() * (len - 200));
          const amp = 0.25 + Math.random() * 0.75;
          const decay = 20 + Math.random() * 70;
          for (let i = 0; i < 160; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / decay);
        }
      }),
    );
    const skitterGain = gain(0);
    skitter.connect(filter('bandpass', 4300, 0.7)).connect(skitterGain).connect(master);

    // alarm
    const alarm = ctx.createOscillator();
    alarm.type = 'square';
    alarm.frequency.value = 620;
    alarm.start();
    const alarmGain = gain(0);
    alarm.connect(filter('lowpass', 1500)).connect(alarmGain).connect(master);

    // the queen's footfalls
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 41;
    rumble.start();
    const rumbleGain = gain(0);
    rumble.connect(rumbleGain).connect(master);

    n = { master, droneFilter, droneGain, airGain, skitter, skitterGain, alarm, alarmGain, rumbleGain };
  }

  // ---- one-shots ------------------------------------------------------------
  const env = (g, peak, attack, release) => {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  };
  const burst = (dur) => {
    const s = ctx.createBufferSource();
    s.buffer = noise(dur, (d, len) => {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    });
    s.start();
    return s;
  };

  function tick() {
    const g = gain(0);
    burst(0.08).connect(filter('highpass', 3000)).connect(g).connect(n.master);
    env(g, 0.2, 0.004, 0.07);
  }
  function zap(power = 1) {
    const g = gain(0);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(48, ctx.currentTime + 0.4);
    const trem = ctx.createOscillator();
    trem.type = 'square';
    trem.frequency.value = 43;
    const tg = gain(0.5);
    trem.connect(tg.gain);
    o.connect(tg);
    burst(0.45).connect(filter('bandpass', 2600, 1.2)).connect(tg);
    tg.connect(g).connect(n.master);
    o.start();
    trem.start();
    o.stop(ctx.currentTime + 0.6);
    trem.stop(ctx.currentTime + 0.6);
    env(g, 0.22 * power, 0.01, 0.42);
  }
  function clang() {
    for (const [f, a] of [[523, 0.16], [1187, 0.12], [1640, 0.1], [2210, 0.07], [3140, 0.05]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = gain(0);
      o.connect(g).connect(n.master);
      o.start();
      o.stop(ctx.currentTime + 1.2);
      env(g, a, 0.003, 0.5 + 300 / f);
    }
    const g = gain(0);
    burst(0.2).connect(filter('lowpass', 500)).connect(g).connect(n.master);
    env(g, 0.5, 0.004, 0.16);
  }
  function boom() {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(74, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 1.7);
    const g = gain(0);
    o.connect(g).connect(n.master);
    o.start();
    o.stop(ctx.currentTime + 2.4);
    env(g, 0.6, 0.02, 2.1);
  }
  function screech() {
    const out = gain(0);
    const band = filter('bandpass', 1700, 0.8);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 3.5);
    shaper.curve = curve;
    const trem = ctx.createOscillator();
    trem.frequency.value = 29;
    const tg = gain(0.6);
    trem.connect(tg.gain);
    trem.start();
    trem.stop(ctx.currentTime + 2.6);
    for (const f of [870, 925, 1240, 1863]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.7, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(f, ctx.currentTime + 0.25);
      o.frequency.exponentialRampToValueAtTime(f * 0.32, ctx.currentTime + 2.3);
      o.connect(tg);
      o.start();
      o.stop(ctx.currentTime + 2.6);
    }
    burst(2.4).connect(filter('highpass', 2200)).connect(tg);
    tg.connect(shaper).connect(band).connect(out).connect(n.master);
    // held for as long as her jaws stay open, then let go
    const t = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.6, t + 0.06);
    out.gain.linearRampToValueAtTime(0.42, t + 1.1);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
  }

  const EVENTS = [
    ...CUTS.map((t) => [t, tick]),
    [BEAT.eyesRed, () => zap(0.6)],
    [BEAT.manhole, clang],
    [43.3, () => zap(1.6)],
    [44.3, () => zap(2.0)],
    [45.3, () => zap(2.0)],
    [BEAT.signOops, () => zap(2.8)],
    [BEAT.screech, () => { screech(); boom(); }],
  ];

  if (offline) {
    build();
    enabled = true;
  }

  return {
    get enabled() {
      return enabled;
    },
    /** Turns sound on/off. Must be called from a user gesture the first time. */
    toggle() {
      try {
        if (!ctx) build();
        enabled = !enabled;
        if (enabled) ctx.resume();
        lastTime = null;
      } catch (err) {
        console.warn('[bugs] audio unavailable', err);
        enabled = false;
      }
      return enabled;
    },
    /** Call after a seek so skipped-over beats do not fire. */
    resync() {
      lastTime = null;
    },
    update(state, playing, extra) {
      if (!ctx || !n) return;
      const t = state.time;
      const now = ctx.currentTime;
      const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, now, tc);
      const live = enabled && playing;
      set(n.master.gain, live ? 0.75 * state.fade : 0, 0.05);
      if (!live) {
        lastTime = null;
        return;
      }
      const c = state.corruption;
      // the bed must leave room on top: the zaps and the scream have to cut through it
      set(n.droneGain.gain, (0.05 + 0.08 * c) * (0.4 + 0.6 * state.power));
      set(n.droneFilter.frequency, 120 + 600 * c + 350 * state.alarm);
      set(n.airGain.gain, 0.055 * state.power);
      set(n.skitterGain.gain, 0.34 * smoothstep(BEAT.manhole, 27, t) * (0.75 + 0.25 * Math.sin(t * 0.9)));
      n.skitter.playbackRate.value = 0.95 + 0.25 * c;
      const alarmOn = state.alarm * state.power * (t < BEAT.screech ? 1 : 0.4);
      set(n.alarmGain.gain, 0.04 * alarmOn, 0.03);
      n.alarm.frequency.value = Math.floor(t / 0.45) % 2 ? 470 : 620;
      set(n.rumbleGain.gain, 0.55 * (extra?.stomp ?? 0), 0.03);

      if (lastTime !== null && t > lastTime && t - lastTime < 0.5) {
        for (const [at, fn] of EVENTS) if (at > lastTime && at <= t) fn();
      }
      lastTime = t;
    },
  };
}

/**
 * Renders the soundtrack between two film times without playing it, for
 * exporting the film as a video file. The graph is driven exactly as it is
 * live: `at(t)` must bring the film to time t and return `[state, extra]`, and
 * is called in order, `rate` times per second of film. Resolves to an
 * AudioBuffer.
 */
export async function renderSoundtrack({ from = 0, to = BEAT.free, sampleRate = 48000, rate = 60, at }) {
  const QUANTUM = 128; // an offline context can only pause on render-quantum boundaries
  const length = Math.ceil((to - from) * sampleRate);
  const offline = new OfflineAudioContext(2, length, sampleRate);
  const audio = createAudio(offline);
  let failure = null;
  const drive = (k) => {
    try {
      const [state, extra] = at(from + k / rate);
      audio.update(state, true, extra);
    } catch (err) {
      failure ??= err; // keep rendering: a context left suspended never finishes
    }
  };
  drive(0);
  let previous = 0;
  for (let k = 1; ; k++) {
    const frame = Math.ceil((k / rate) * sampleRate / QUANTUM) * QUANTUM;
    if (frame >= length) break;
    if (frame === previous) continue; // two steps inside one quantum
    previous = frame;
    offline.suspend(frame / sampleRate).then(() => {
      drive(k);
      offline.resume();
    });
  }
  const buffer = await offline.startRendering();
  if (failure) throw failure;
  return buffer;
}
