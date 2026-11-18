// Deterministic offline render: drives window.__video.renderAt(t) in headless Chromium,
// screenshots each frame, then encodes an MP4 with ffmpeg.
//
//   node scripts/render.mjs                    -> out/chimborazo.mp4
//   node scripts/render.mjs --stills=1,4.5,10  -> out/stills/t-1.00.png ...
//   options: --workers=3 --fps=30 --out=out/chimborazo.mp4 --audio=assets/soundtrack.wav
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const WORKERS = Number(args.workers || 3);
const OUT = path.resolve(ROOT, args.out || 'out/chimborazo.mp4');
const FRAMES_DIR = path.resolve(ROOT, args.frames || 'frames');
const AUDIO = args.audio === false ? null : path.resolve(ROOT, args.audio || 'assets/soundtrack.wav');

const LAUNCH = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'],
};
if (process.env.CHROMIUM_PATH) LAUNCH.executablePath = process.env.CHROMIUM_PATH;

async function openPage(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text());
  });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(`${base}/index.html?capture`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__video, null, { timeout: 60000 });
  await page.evaluate(() => window.__video.ready);
  return page;
}

async function grab(page, t, file) {
  await page.evaluate((tt) => window.__video.renderAt(tt), t);
  await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

async function main() {
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(LAUNCH);
  try {
    if (args.stills) {
      const dir = path.resolve(ROOT, args.stillsDir || 'out/stills');
      fs.mkdirSync(dir, { recursive: true });
      const page = await openPage(browser, base);
      for (const t of String(args.stills).split(',').map(Number)) {
        const f = path.join(dir, `t-${t.toFixed(2)}.png`);
        const t0 = Date.now();
        await grab(page, t, f);
        console.log(`still t=${t} -> ${path.relative(ROOT, f)} (${Date.now() - t0} ms)`);
      }
      return;
    }

    const probe = await openPage(browser, base);
    const { duration, fps: pageFps } = await probe.evaluate(() => ({ duration: window.__video.duration, fps: window.__video.fps }));
    await probe.close();
    const fps = Number(args.fps || pageFps);
    const total = Math.round(duration * fps);
    fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
    fs.mkdirSync(FRAMES_DIR, { recursive: true });

    let next = 0, done = 0;
    const started = Date.now();
    const worker = async () => {
      const page = await openPage(browser, base);
      while (next < total) {
        const i = next++;
        await grab(page, i / fps, path.join(FRAMES_DIR, `f${String(i).padStart(5, '0')}.png`));
        done++;
        if (done % 15 === 0 || done === total) {
          const el = (Date.now() - started) / 1000;
          process.stdout.write(`\rframes ${done}/${total}  ${el.toFixed(0)}s elapsed, ~${((el / done) * (total - done)).toFixed(0)}s left   `);
        }
      }
      await page.close();
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    process.stdout.write('\n');

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const ff = ['-y', '-framerate', String(fps), '-i', path.join(FRAMES_DIR, 'f%05d.png')];
    const useAudio = AUDIO && fs.existsSync(AUDIO);
    if (useAudio) ff.push('-i', AUDIO);
    ff.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'film');
    if (useAudio) ff.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    ff.push('-movflags', '+faststart', '-t', String(duration), OUT);
    await run('ffmpeg', ff);
    console.log(`wrote ${path.relative(ROOT, OUT)}${useAudio ? ' (with soundtrack)' : ''}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
