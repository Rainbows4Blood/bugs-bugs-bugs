// Derives dist/embed.html from the single-file build. The embed variant is the
// same film laid out as a 16:9 box that follows its container's width (instead of
// filling the window), so it can be dropped into a page or an iframe-less host.
import { readFile, writeFile } from 'node:fs/promises';

const src = new URL('../dist/index.html', import.meta.url);
const out = new URL('../dist/embed.html', import.meta.url);

const html = await readFile(src, 'utf8');
if (!html.includes('data-layout="full"')) throw new Error('make-embed: layout marker not found in dist/index.html');
await writeFile(out, html.replace('data-layout="full"', 'data-layout="embed"'));
console.log(`dist/embed.html  ${(html.length / 1024).toFixed(1)} kB`);
