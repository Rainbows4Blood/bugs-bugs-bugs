import { BEAT } from '../config.js';
import { clamp } from '../core/util.js';

// DOM overlay: a security-console dressing for the film (clock, status, live
// counters, an incident log that types itself) plus the transport controls.
// Like everything else it is a pure function of time, so scrubbing works.

const LOG = [
  [0.9, 'INFO', 'nightly build #4096 ........ passing'],
  [3.6, 'INFO', '0 open issues. go home, everyone.'],
  [8.6, 'WARN', '1 unresolved issue on the plaza'],
  [11.05, 'WARN', 'issue is ... looking back at us'],
  [12.8, 'ERROR', 'manhole.cover: unexpected EOF'],
  [16.2, 'ERROR', 'unhandled exception: too many legs'],
  [20.6, 'ERROR', 'firewall breached (it was a wall. they climbed it)'],
  [24.2, 'ERROR', 'bugs.length > Number.MAX_SAFE_INTEGER'],
  [28.6, 'FATAL', 'segfault on floor 3 ... 4 ... 5 ...'],
  [33.0, 'FATAL', 'pest_control.exe is not responding'],
  [36.1, 'ALERT', 'building alarm: ON'],
  [41.0, 'FATAL', 'rm -rf /bugs: permission denied'],
  [43.6, 'FATAL', "sign.render(): 'OpenAI' is undefined"],
  [46.5, 'FATAL', "sign.render(): 'OopsAI'"],
  [50.0, 'PANIC', 'new process spawned: QUEEN (pid 1)'],
  [55.9, 'PANIC', 'she is on the roof'],
  [58.3, 'PANIC', '0xDEADBEEF 0xDEADBEEF 0xDEADBEEF'],
  [62.0, 'INFO', 'have you tried turning it off and on again?'],
  [66.6, 'HINT', 'drag to look around / R to replay'],
];

const STATUS = [
  [0, 'ok', 'ALL SYSTEMS NOMINAL'],
  [8.6, 'warn', 'ANOMALY DETECTED'],
  [20.6, 'bad', 'BREACH IN PROGRESS'],
  [46.3, 'bad', 'CONTAINMENT FAILED'],
  [BEAT.screech, 'dead', 'TOTAL SYSTEM FAILURE'],
];

const ICON = {
  replay: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M3 8h11v9H3zM14 11l7-3v9l-7-3"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

const pad = (n) => String(n).padStart(2, '0');

export function createHud(stage, handlers) {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="bar top"></div>
    <div class="bar bottom"></div>
    <div class="hud-tl">
      <div class="loc">OPENAI HQ <span>/</span> SAN FRANCISCO</div>
      <div class="clock">03:14:07</div>
      <div class="status ok"><i></i><span>ALL SYSTEMS NOMINAL</span></div>
    </div>
    <div class="hud-tr">
      <div class="metric"><label>BUGS DETECTED</label><b class="count">0</b></div>
      <div class="metric"><label>SYSTEM INTEGRITY</label><div class="meter"><i></i></div><b class="integrity">100%</b></div>
    </div>
    <div class="log"></div>
    <div class="title"><h1>BUGS. BUGS. BUGS.</h1><p>It&rsquo;s not a bug. It&rsquo;s a feature.</p></div>
    <div class="controls">
      <button data-act="replay" title="Replay (R)">${ICON.replay}</button>
      <button data-act="pause" title="Pause (Space)">${ICON.pause}</button>
      <button data-act="free" title="Free camera (F)">${ICON.cam}</button>
      <button data-act="sound" title="Sound (M)">${ICON.soundOff}</button>
      <button data-act="full" title="Fullscreen">${ICON.full}</button>
    </div>
    <div class="scrub" title="Seek"><i></i><em></em></div>
  `;
  stage.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const el = {
    clock: $('.clock'),
    status: $('.status'),
    statusText: $('.status span'),
    count: $('.count'),
    integrity: $('.integrity'),
    meter: $('.meter i'),
    log: $('.log'),
    title: $('.title'),
    scrub: $('.scrub'),
    scrubFill: $('.scrub i'),
    pause: $('[data-act="pause"]'),
    sound: $('[data-act="sound"]'),
    free: $('[data-act="free"]'),
  };

  root.querySelector('.controls').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) handlers[btn.dataset.act]?.();
  });

  // click / drag the progress line to seek
  const seekFromEvent = (e) => {
    const r = el.scrub.getBoundingClientRect();
    handlers.seek(clamp((e.clientX - r.left) / r.width) * BEAT.loop);
  };
  el.scrub.addEventListener('pointerdown', (e) => {
    el.scrub.setPointerCapture(e.pointerId);
    seekFromEvent(e);
    e.stopPropagation();
  });
  el.scrub.addEventListener('pointermove', (e) => {
    if (el.scrub.hasPointerCapture(e.pointerId)) seekFromEvent(e);
  });

  // controls fade out when the pointer rests
  let idleTimer = 0;
  const wake = () => {
    root.classList.add('awake');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.remove('awake'), 2600);
  };
  stage.addEventListener('pointermove', wake);
  stage.addEventListener('pointerdown', wake);
  wake();

  // rebuild the log only when its visible content changes
  let logKey = '';
  let statusIdx = -1;
  let lastCount = -1;
  let lastIntegrity = -1;
  let lastClock = -1;

  return {
    root,
    setPaused(paused) {
      el.pause.innerHTML = paused ? ICON.play : ICON.pause;
    },
    setSound(on) {
      el.sound.innerHTML = on ? ICON.soundOn : ICON.soundOff;
      el.sound.classList.toggle('on', on);
    },
    setFree(on) {
      el.free.classList.toggle('on', on);
    },
    setVisible(v) {
      root.style.display = v ? '' : 'none';
    },
    update(state, stats) {
      const t = state.time;

      const sec = Math.floor(t);
      if (sec !== lastClock) {
        lastClock = sec;
        const total = 3 * 3600 + 14 * 60 + 7 + sec;
        el.clock.textContent = `${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
      }

      let si = 0;
      for (let i = 0; i < STATUS.length; i++) if (t >= STATUS[i][0]) si = i;
      if (si !== statusIdx) {
        statusIdx = si;
        el.status.className = `status ${STATUS[si][1]}`;
        el.statusText.textContent = STATUS[si][2];
      }

      // the queen is counted separately, once she shows up
      const countKey = stats.bugs * 2 + (t > 50 ? 1 : 0);
      if (countKey !== lastCount) {
        lastCount = countKey;
        el.count.textContent = stats.bugs.toLocaleString('en-US') + (t > 50 ? ' +1' : '');
      }
      const integ = Math.round(100 * (1 - state.corruption));
      if (integ !== lastIntegrity) {
        lastIntegrity = integ;
        el.integrity.textContent = `${integ}%`;
        el.meter.style.width = `${integ}%`;
        el.meter.style.background = integ > 60 ? 'var(--hud-green)' : integ > 25 ? 'var(--hud-amber)' : 'var(--hud-red)';
      }

      // incident log: last few lines, the newest one typing itself out
      let last = -1;
      for (let i = 0; i < LOG.length; i++) if (t >= LOG[i][0]) last = i;
      const typed = last >= 0 ? Math.min(LOG[last][2].length, Math.floor((t - LOG[last][0]) * 48)) : 0;
      const key = `${last}:${typed}`;
      if (key !== logKey) {
        logKey = key;
        let html = '';
        for (let i = Math.max(0, last - 3); i <= last; i++) {
          const [lt, level, text] = LOG[i];
          const shown = i === last ? text.slice(0, typed) : text;
          const total = 3 * 3600 + 14 * 60 + 7 + Math.floor(lt);
          const stamp = `03:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
          const caret = i === last && typed < text.length ? '<u></u>' : '';
          html += `<div class="l-${level.toLowerCase()}${i === last ? ' cur' : ''}"><time>${stamp}</time><b>${level}</b><span>${shown.replace(/</g, '&lt;')}${caret}</span></div>`;
        }
        el.log.innerHTML = html;
      }

      el.title.style.opacity = state.titleCard.toFixed(3);
      el.title.style.transform = `translate(-50%, -50%) scale(${(0.94 + 0.06 * state.titleCard).toFixed(3)})`;
      el.scrubFill.style.width = `${clamp(t / BEAT.loop) * 100}%`;
      root.classList.toggle('cinematic', state.cinematic);
      root.classList.toggle('glitching', state.glitch > 0.35);
    },
  };
}
