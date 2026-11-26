// Renders the film to an .mp4.
//
// The built page is opened in a headless Chromium browser (Edge or Chrome,
// whichever is installed) and stepped frame by frame through its debug hook.
// The film is a pure function of time, so every frame is exact however long it
// takes to draw; the screenshots - picture and console overlay together - are
// piped straight into ffmpeg. The soundtrack is rendered offline in the same
// page and muxed in.
//
//   npm run render                                 1920x1080, 60 fps, with sound
//   npm run render -- --size 1280x720 --fps 30 --no-audio
//   npm run render -- --stills 9.5,44,59           PNG frames instead of a video
//
// Needs ffmpeg on the PATH and nothing else: the browser is driven over the
// DevTools protocol directly.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BEAT } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  out: 'renders/bugs-bugs-bugs.mp4',
  size: '1920x1080',
  fps: 60,
  quality: 'ultra', // the film's own tiers: potato | low | medium | high | ultra
  from: 0,
  to: BEAT.free, // where the film hands the camera to the viewer
  crf: 20, // x264 quality: lower is better and bigger (the swarm is expensive: +2 saves about a fifth)
  preset: 'slow',
  fade: 1.1, // seconds of fade to black at the end; 0 for a hard stop
  'hud-scale': 1.3, // size of the console overlay; 1 is what the page shows on a 1080p screen
  loudness: -16, // LUFS the soundtrack is levelled to
  stills: '', // comma-separated film times: write PNGs, no video
  browser: '', // path to msedge / chrome, if it is not found by itself
};
const FLAGS = ['no-audio', 'no-hud', 'headful', 'allow-software', 'keep', 'help'];

const HELP = `Usage: node scripts/render-mp4.mjs [options]

${Object.entries(DEFAULTS).map(([k, v]) => `  --${k} <${typeof v}>`.padEnd(26) + `default: ${v === '' ? '-' : v}`).join('\n')}
${FLAGS.map((f) => `  --${f}`).join('\n')}`;

function parseArgs(argv) {
  const opt = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const [key, inline] = argv[i].slice(2).split(/=(.*)/s);
    if (FLAGS.includes(key)) {
      opt[key] = true;
      continue;
    }
    if (!(key in DEFAULTS)) throw new Error(`Unknown option --${key}`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    opt[key] = typeof DEFAULTS[key] === 'number' ? Number(value) : value;
    if (Number.isNaN(opt[key])) throw new Error(`--${key} needs a number`);
  }
  return opt;
}

export function findBrowser(explicit) {
  const env = process.env;
  const bases = [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean);
  const candidates = [
    explicit,
    env.BROWSER_PATH,
    ...bases.map((b) => path.join(b, 'Microsoft/Edge/Application/msedge.exe')),
    ...bases.map((b) => path.join(b, 'Google/Chrome/Application/chrome.exe')),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
  return candidates.find((p) => p && existsSync(p));
}

/** Runs a command to completion and returns what it printed. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} was not found on the PATH.`) : e));
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} failed (${code})\n${err.slice(-2000)}`))));
  });
}

// ---------------------------------------------------------------------------
// A minimal DevTools-protocol client over the browser's debugging pipe
// (fd 3 in, fd 4 out, messages are JSON terminated by a NUL byte).
// ---------------------------------------------------------------------------
export function launchBrowser(exe, args) {
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const [, , stderr, toBrowser, fromBrowser] = proc.stdio;
  let log = '';
  stderr.on('data', (d) => (log = (log + d).slice(-3000)));
  toBrowser.on('error', () => {}); // a dead browser is reported through 'exit'

  let nextId = 0;
  let dead = null;
  const pending = new Map();
  const handlers = new Map();
  const fail = (err) => {
    dead ??= err;
    for (const p of pending.values()) p.reject(dead);
    pending.clear();
  };
  proc.on('error', fail);
  proc.on('exit', (code) => fail(new Error(`The browser exited unexpectedly (code ${code}).\n${log}`)));

  let parts = [];
  fromBrowser.on('data', (chunk) => {
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(0, start);
      if (end < 0) {
        parts.push(chunk.subarray(start));
        return;
      }
      parts.push(chunk.subarray(start, end));
      const msg = JSON.parse(Buffer.concat(parts).toString());
      parts = [];
      start = end + 1;
      if (msg.id === undefined) {
        handlers.get(msg.method)?.forEach((fn) => fn(msg.params));
        continue;
      }
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p?.resolve(msg.result);
    }
  });

  return {
    send(method, params = {}, sessionId) {
      if (dead) return Promise.reject(dead);
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        toBrowser.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
      });
    },
    on(method, fn) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(fn);
    },
    async close() {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      const exited = once(proc, 'exit').catch(() => {});
      this.send('Browser.close').catch(() => {});
      const timer = setTimeout(() => proc.kill(), 5000);
      await exited;
      clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// Code that runs inside the page
// ---------------------------------------------------------------------------

/** Takes the film off the wall clock: from here on a frame exists only when asked for. */
function installCapture(hudFontSize, startTime) {
  const bugs = window.__bugs;
  bugs.renderer.setAnimationLoop(null);

  const style = document.createElement('style');
  style.textContent = `
    .hud .controls, .hud .scrub { display: none !important; }
    .hud { font-size: ${hudFontSize} !important; }
    @keyframes capture-pulse { 50% { opacity: 0.25; } }`;
  document.head.append(style);

  // A headless browser only hands out screenshots promptly while something on
  // the page is animating; left idle, each one takes over a second. One pixel
  // pulsing behind the (opaque) stage keeps it awake without touching the picture.
  const pulse = document.createElement('div');
  pulse.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:#000;animation:capture-pulse 1s linear infinite';
  document.body.prepend(pulse);

  let lost = false;
  bugs.renderer.domElement.addEventListener('webglcontextlost', () => (lost = true));

  // CSS transitions and animations (the status light, the integrity meter)
  // run on real time; they are paused and moved along with the film instead.
  for (const a of document.getAnimations()) if (a instanceof CSSTransition) a.finish();
  const started = new Map();

  window.__capture = {
    audio: '',
    frame(t) {
      bugs.frame(t);
      for (const a of document.getAnimations()) {
        if (a.effect?.target === pulse) continue;
        let t0 = started.get(a);
        if (t0 === undefined) {
          started.set(a, (t0 = t));
          a.pause();
        }
        const at = Math.max(0, (t - t0) * 1000);
        if (at >= a.effect.getComputedTiming().endTime) {
          a.finish();
          started.delete(a);
        } else a.currentTime = at;
      }
      if (lost) throw new Error('The WebGL context was lost.');
      if (bugs.errors.length) throw new Error(bugs.errors.join('\n'));
    },
    /** Fills the canvas with one colour (for the capture check). */
    flood(hex) {
      const r = bugs.renderer;
      const color = r.getClearColor(bugs.scene.fog.color.clone());
      const alpha = r.getClearAlpha();
      r.setRenderTarget(null);
      r.setClearColor(hex, 1);
      r.clear();
      r.setClearColor(color, alpha);
    },
  };
  window.__capture.frame(startTime);
}

/** Renders the soundtrack and parks it in the page as base64 (32-bit float, interleaved stereo). */
async function grabSoundtrack(from, to, sampleRate) {
  const buffer = await window.__bugs.soundtrack(from, to, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0);
  const pcm = new Float32Array(buffer.length * 2);
  for (let i = 0; i < buffer.length; i++) {
    pcm[2 * i] = left[i];
    pcm[2 * i + 1] = right[i];
  }
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([pcm]));
  });
  window.__capture.audio = url.slice(url.indexOf(',') + 1);
  return window.__capture.audio.length;
}

function describePage() {
  const bugs = window.__bugs;
  if (!bugs) return { missing: document.querySelector('.no-webgl')?.textContent ?? 'The film did not start.' };
  const gl = bugs.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
    quality: bugs.qualityName,
    buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    view: [window.innerWidth, window.innerHeight],
    errors: bugs.errors,
  };
}

// ---------------------------------------------------------------------------

function wavHeader(bytes, sampleRate, channels) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 4, 28);
  h.writeUInt16LE(channels * 4, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

const PEAK_CEILING = -2; // dBFS the soundtrack's peaks are held under

/** Integrated loudness (LUFS) and true peak (dBFS) of an audio file. */
async function measureLoudness(file) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = err.slice(err.lastIndexOf('Summary:'));
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  return { integrated, peak };
}

const clock = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) {
    console.log(HELP);
    return;
  }

  const size = /^(\d+)x(\d+)$/.exec(opt.size);
  if (!size) throw new Error('--size must look like 1920x1080');
  const width = Number(size[1]);
  const height = Number(size[2]);
  if (width % 2 || height % 2) throw new Error('--size must have even dimensions');
  if (!(opt.fps > 0)) throw new Error('--fps must be positive');
  const stills = opt.stills ? opt.stills.split(',').map(Number) : null;
  if (stills?.some((t) => Number.isNaN(t))) throw new Error('--stills must be a list of times, like 9.5,44,59');
  if (!(opt.from >= 0 && opt.to > opt.from)) throw new Error('--from/--to: nothing to render');
  if (opt.to > BEAT.free) throw new Error(`The film ends at ${BEAT.free} s; after that the camera is the viewer's.`);
  const frames = Math.round((opt.to - opt.from) * opt.fps);
  const duration = frames / opt.fps;
  const fade = Math.min(opt.fade, duration);
  const withAudio = !opt['no-audio'] && !stills;

  const page = path.join(root, 'dist/index.html');
  if (!existsSync(page)) throw new Error('dist/index.html is missing: run "npm run build" first.');
  const exe = findBrowser(opt.browser);
  if (!exe) throw new Error('No Edge or Chrome found. Point --browser (or BROWSER_PATH) at one.');
  await run('ffmpeg', ['-version']);

  const out = path.resolve(root, opt.out);
  await mkdir(path.dirname(out), { recursive: true });
  const work = await mkdtemp(path.join(os.tmpdir(), 'bugs-render-'));

  let browser = null;
  let encoder = null;
  const cleanup = async () => {
    encoder?.kill();
    await browser?.close();
    if (opt.keep) console.log(`Work files kept in ${work}`);
    else await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
  };
  process.once('SIGINT', () => cleanup().finally(() => process.exit(130)));

  try {
    browser = launchBrowser(exe, [
      ...(opt.headful ? [] : ['--headless=new']),
      '--remote-debugging-pipe',
      `--user-data-dir=${path.join(work, 'profile')}`,
      `--window-size=${width},${height}`,
      '--force-device-scale-factor=1',
      '--force-color-profile=srgb',
      '--disable-lcd-text',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      'about:blank',
    ]);

    // attach to the tab the browser opened
    const { targetInfos } = await browser.send('Target.getTargets');
    const tab =
      targetInfos.find((t) => t.type === 'page')?.targetId ??
      (await browser.send('Target.createTarget', { url: 'about:blank' })).targetId;
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId: tab, flatten: true });
    const send = (method, params) => browser.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`In the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    const call = (fn, ...args) => evaluate(`(${fn})(${args.map((a) => JSON.stringify(a)).join(', ')})`);

    const pageErrors = [];
    browser.on('Runtime.exceptionThrown', (e) => pageErrors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
    browser.on('Inspector.targetCrashed', () => pageErrors.push('The tab crashed.'));

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // the film calms its glitches down for viewers who ask for less motion; a render should not depend on that
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

    const query = new URLSearchParams({ debug: '', pause: '', fixed: '', quality: opt.quality, t: String(opt.from) });
    if (opt['no-hud']) query.set('hud', '0');
    const loaded = new Promise((resolve) => browser.on('Page.loadEventFired', resolve));
    await send('Page.navigate', { url: `${pathToFileURL(page).href}?${query}` });
    await loaded;
    await evaluate('document.fonts.ready.then(() => true)');

    const info = await call(describePage);
    if (info.missing || info.errors.length || pageErrors.length) {
      throw new Error([info.missing, ...(info.errors ?? []), ...pageErrors].filter(Boolean).join('\n'));
    }
    console.log(`Browser   ${path.basename(exe)}${opt.headful ? '' : ' (headless)'}`);
    console.log(`GPU       ${info.gpu}`);
    console.log(`Picture   ${width}x${height}, quality "${info.quality}"`);
    if (/swiftshader|llvmpipe|software|basic render/i.test(info.gpu) && !opt['allow-software']) {
      throw new Error('The browser is rendering in software, which would take hours. Try --headful, or pass --allow-software.');
    }
    if (info.view[0] !== width || info.view[1] !== height) throw new Error(`The page is ${info.view.join('x')}, not ${width}x${height}.`);
    if (info.buffer[0] < width) {
      console.log(`Note      "${info.quality}" draws ${info.buffer.join('x')} and scales it up; use --quality high or ultra for a sharp picture.`);
    }

    // The overlay's type is capped at 15 px on screen; in a video it scales with the frame instead.
    await call(installCapture, `${((15 / 1920) * 100 * opt['hud-scale']).toFixed(4)}cqw`, opt.from);
    const shoot = async () => (await send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data;
    const grab = async (t) => {
      await evaluate(`__capture.frame(${t})`);
      return shoot();
    };

    // Make sure a screenshot shows what was drawn just before it, not the frame
    // before that: fill the canvas red, blue, and blue again, and look.
    {
      const flood = async (hex) => {
        await evaluate(`__capture.flood(${hex})`);
        return shoot();
      };
      const red = await flood(0xff0000);
      const blue = await flood(0x0000ff);
      const again = await flood(0x0000ff);
      if (red === blue || blue !== again) throw new Error('Capture check failed: screenshots do not show the frame that was just drawn.');
    }

    if (stills) {
      const base = out.replace(/\.[^.\\/]+$/, '');
      for (const t of stills) {
        const file = `${base}-${t.toFixed(2)}s.png`;
        await writeFile(file, Buffer.from(await grab(t), 'base64'));
        console.log(`Still     ${file}`);
      }
      return;
    }

    // ---- soundtrack -------------------------------------------------------
    let audio = null;
    if (withAudio) {
      const RATE = 48000;
      const started = Date.now();
      const chars = await call(grabSoundtrack, opt.from, opt.from + duration, RATE);
      const STEP = 4 << 20; // a multiple of 4, so every slice of base64 decodes on its own
      const parts = [];
      for (let o = 0; o < chars; o += STEP) parts.push(Buffer.from(await evaluate(`__capture.audio.slice(${o}, ${o + STEP})`), 'base64'));
      await evaluate('__capture.audio = ""');
      const pcm = Buffer.concat(parts);
      const file = path.join(work, 'soundtrack.wav');
      await writeFile(file, Buffer.concat([wavHeader(pcm.length, RATE, 2), pcm]));
      const { integrated, peak } = await measureLoudness(file);
      if (!Number.isFinite(integrated) || !Number.isFinite(peak) || integrated < -60) {
        console.log('Sound     the soundtrack came out silent; rendering without it.');
      } else {
        // One fixed gain brings it to the loudness asked for; a limiter then holds
        // the few peaks that go over (the scream, the footfalls). The gain stops
        // short of making the limiter take more than 6 dB off the loudest of them.
        const gain = Math.min(opt.loudness - integrated, PEAK_CEILING + 6 - peak);
        audio = { file, gain };
        console.log(
          `Sound     ${duration.toFixed(1)} s in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
            `${integrated.toFixed(1)} LUFS, peak ${peak.toFixed(1)} dB -> gain ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`,
        );
      }
    }

    // ---- picture ----------------------------------------------------------
    const vf = [];
    const af = audio
      ? [`volume=${audio.gain.toFixed(2)}dB`, `alimiter=limit=${(10 ** (PEAK_CEILING / 20)).toFixed(4)}:attack=5:release=60:level=false:latency=true`]
      : [];
    if (fade > 0) {
      const at = `st=${(duration - fade).toFixed(4)}:d=${fade.toFixed(4)}`;
      vf.push(`fade=t=out:${at}`);
      af.push(`afade=t=out:${at}`);
    }
    // HD video is BT.709, limited range; say so, and convert with that matrix
    vf.push('scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv');
    // The swarm at full tilt costs a lot of bits. Cap the peaks at 0.4 bit per
    // pixel (50 Mbit/s for 1080p60), which is what hardware decoders are sure to take.
    const maxrate = Math.round((width * height * opt.fps * 0.4) / 1e5) / 10;
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(opt.fps), '-c:v', 'png', '-i', 'pipe:0',
        ...(audio ? ['-i', audio.file] : []),
        '-vf', vf.join(','),
        '-c:v', 'libx264', '-preset', opt.preset, '-crf', String(opt.crf), '-profile:v', 'high',
        '-refs', '4', // keeps 1080p60 inside level 4.2, which every hardware decoder plays
        '-maxrate', `${maxrate}M`, '-bufsize', `${(maxrate * 1.25).toFixed(1)}M`,
        '-g', String(Math.round(opt.fps * 2)),
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        ...(audio ? ['-af', af.join(','), '-c:a', 'aac', '-b:a', '192k'] : []),
        '-movflags', '+faststart',
        '-metadata', 'title=Bugs. Bugs. Bugs.',
        out,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    encoder = ffmpeg;
    let encoderLog = '';
    let encoderDone = false;
    ffmpeg.stderr.on('data', (d) => (encoderLog = (encoderLog + d).slice(-3000)));
    ffmpeg.stdin.on('error', () => {}); // reported through the exit code
    const encoded = new Promise((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        encoderDone = true;
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg failed (${code})\n${encoderLog}`));
      });
    });
    encoded.catch(() => {}); // awaited below; do not crash on an early exit

    console.log(`Rendering ${frames} frames (${opt.from}-${opt.from + duration} s at ${opt.fps} fps) ...`);
    const started = Date.now();
    let reported = started;
    let previous = '';
    let repeats = 0;
    for (let i = 0; i < frames; i++) {
      if (encoderDone) break;
      const data = await grab(opt.from + i / opt.fps);
      // grain alone makes every frame unique (bar the black ones the film opens
      // on), so a run of repeats would mean stale screenshots
      if (data === previous) repeats++;
      previous = data;
      if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) await Promise.race([once(ffmpeg.stdin, 'drain'), encoded.catch(() => {})]);
      const now = Date.now();
      if (now - reported > 5000 || i === frames - 1) {
        reported = now;
        const rate = (i + 1) / ((now - started) / 1000);
        console.log(`  ${String(i + 1).padStart(5)} / ${frames}   ${rate.toFixed(1)} frames/s   ${clock((frames - i - 1) / rate)} left`);
      }
    }
    ffmpeg.stdin.end();
    await encoded;
    encoder = null;
    if (repeats > 8) console.log(`Warning   ${repeats} frames were identical to the one before them.`);

    // ---- check what was written ---------------------------------------------
    const probe = JSON.parse(
      (
        await run('ffprobe', [
          '-v', 'error', '-count_packets', '-show_entries',
          'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_read_packets,color_space:format=duration,bit_rate',
          '-of', 'json', out,
        ])
      ).out,
    );
    const video = probe.streams.find((s) => s.codec_type === 'video');
    const sound = probe.streams.find((s) => s.codec_type === 'audio');
    if (Number(video.nb_read_packets) !== frames) throw new Error(`Expected ${frames} frames in the file, found ${video.nb_read_packets}.`);
    const bytes = (await stat(out)).size;
    console.log(
      `Done      ${out}\n          ${video.width}x${video.height} ${video.codec_name} ${video.pix_fmt} ${video.color_space}, ${video.nb_read_packets} frames at ${video.r_frame_rate} fps, ` +
        `${Number(probe.format.duration).toFixed(2)} s, ${sound ? `${sound.codec_name} sound` : 'silent'}, ` +
        `${(bytes / 2 ** 20).toFixed(1)} MB (${(Number(probe.format.bit_rate) / 1e6).toFixed(1)} Mbit/s), rendered in ${clock((Date.now() - started) / 1000)}`,
    );
  } finally {
    await cleanup();
  }
}

// run only when started as a script, so the pieces above can be imported
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  });
}
