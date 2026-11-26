<img src="assets/icon.svg" width="64" height="64" alt="">

# bugs_bugs_bugs

A 66-second three.js short film: **computer bugs invade the OpenAI headquarters.**
It is 03:14 AM, the nightly build is passing, and there is exactly one unresolved issue on the plaza.

Created in [T3 Code](https://t3.codes).

## Watch it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

or build it once and open the result straight from disk – no server needed:

```bash
npm run build      # -> dist/index.html (fullscreen) and dist/embed.html (16:9 box)
```

Both files are fully self-contained (three.js, shaders, font and styles are inlined; nothing is fetched at runtime).

### Controls

| Key / button | Action |
| --- | --- |
| `Space` | pause / resume |
| `R` | replay from the start |
| `F` | take the camera (drag to orbit, wheel to zoom) – it is handed over automatically when the film ends |
| `M` | sound on/off (synthesised live, off by default) |
| `H` | hide the console overlay |
| `←` / `→` | skip 5 s |
| progress line | click or drag to scrub |

URL options: `?t=33` start time, `?pause`, `?free`, `?hud=0`, `?quality=potato|low|medium|high|ultra`, `?fixed` (no adaptive resolution), `?debug`.

### As a video

```bash
npm run render     # -> renders/bugs-bugs-bugs.mp4 (1920×1080, 60 fps, H.264 + AAC)
```

The built page is opened in a headless Edge or Chrome and stepped frame by frame through its debug hook. Because the film is a function of time, every frame is exact however long it takes to draw, so the swarm runs at its `ultra` setting. The soundtrack is rendered offline by the same page and levelled to −16 LUFS. This needs `ffmpeg` on the PATH and a GPU the browser can use; on a laptop with integrated graphics it takes about nine minutes.

The swarm is expensive to compress: the default quality gives a file of about 260 MB. `npm run render -- --help` lists the options, for example `--crf 24` (about 40 % smaller), `--size 1280x720 --fps 30 --crf 26` for a small file, `--no-audio`, `--no-hud`, or `--stills 9.5,44,59` for PNG frames instead of a video. The `renders/` folder is not tracked by git.

## The film

| Time | Shot | What happens |
| --- | --- | --- |
| 0:00 | establish | Calm night, all systems nominal. |
| 0:07 | macro | Patient zero walks along the stone sign. Its eyes turn red. |
| 0:12 | reverse | A manhole cover blows; eyes appear in the dark beyond the street. |
| 0:16 | ride | Skimming over the plaza with the swarm. |
| 0:23 | crane | The tide hits the building; the first windows flip to code rain. |
| 0:27 | climb | Up the facade with the infection front. Alarm at 0:36. |
| 0:40 | sign | The wordmark stutters, scrambles, and settles on something else. |
| 0:49 | drone | The queen comes over the back of the roof. |
| 0:56 | hero | She screams; the shockwave blacks out the city. |
| 1:06 | free | The camera is yours. Loops after a while if you leave it alone. |

## How it works

Everything is a **pure function of time** – nothing is simulated step by step – which is why the film can be scrubbed, replayed or started at any second instantly.

- **The swarm** (`src/bugs/swarm.js`) – up to 22 000 instanced bugs with zero per-frame CPU cost. Each bug's route lives in the 2D "strip" space of the wall it is heading for (ground → wall → roof unfolded into one plane). The vertex shader evaluates the route, folds it back onto the building, builds an orientation frame from two samples along the path so bodies pivot naturally over edges, and animates the tripod gait.
- **Infection** – at start-up every climber's path is walked once to bake *when* each window gets overrun; the facade shader looks that time up, so rooms fail exactly as the bugs cross them.
- **The building** (`src/world/building.js`) – each facade is one quad. The shader lays out bays and floors and ray-casts a virtual room behind every pane (interior mapping), with ceiling lights, blinds, monitors, and – once infected – strobing, code rain and error screens.
- **The two characters** (`src/bugs/hero.js`) – patient zero and the 28 m queen are articulated, with two-bone IK legs solved against footholds that are a closed-form function of distance travelled.
- **The plaza** (`src/world/ground.js`) – one quad: pavers, street markings, puddles and a planar reflection whose sharpness follows the wetness.
- **Post** (`src/core/postfx.js`) – HDR scene with MSAA → gather depth of field → bloom → glitch / chromatic aberration / grain → ACES tone mapping.
- **Direction** (`src/film/director.js`) – the shot list and every film-wide curve (alarm, power, glitch, lightning).
- **Sound** (`src/film/audio.js`) – Web Audio only, no samples. The same graph runs in an offline context for the video render.

Resolution adapts to the measured GPU time per frame (timer queries, so a throttled background tab is not mistaken for a slow GPU), and a quality tier is picked from the GPU name.

## Layout

```
index.html            entry page (data-layout="full" | "embed")
src/main.js           wiring, loop, adaptive quality
src/config.js         site layout, beat times, quality tiers
src/core/             math, shared GLSL, font, post-processing
src/world/            sky, building, ground, props, city, sign, textures
src/bugs/             swarm, flyers, hero rig
src/fx/               error-message embers, beacons, shockwave
src/film/             director, HUD, audio
scripts/make-embed.mjs
scripts/render-mp4.mjs   film -> .mp4 (headless browser + ffmpeg)
```

## Credits

- [three.js](https://threejs.org) (MIT).
- Sign lettering: Helvetiker Bold, MgOpen licence – see `src/assets/fonts/LICENSE`. Only the glyphs the film uses are bundled.
- All textures are painted at start-up with the 2D canvas API.

This is a parody. It is not affiliated with or endorsed by OpenAI.
