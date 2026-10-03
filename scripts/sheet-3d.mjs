// 3D contact sheet of one clip from the 2D art camera (front three-quarter) and, optionally, other views.
//   node scripts/sheet-3d.mjs <clip> <out.png> [--times=0,0.5,...] [--views=art,front,side,top] [--scale=0.32] [--cols=8]
// art = the fixed 2D art camera; front = facing the character; side = down the target line from the character's
// right (looking toward +X); top = from above.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const [clip, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const views = (arg('views') || 'art').split(','), scale = +(arg('scale') || 0.32), cols = +(arg('cols') || 8);
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/knight.html?hideui=1`);
await page.waitForFunction(() => window.viewer?.ready, null, { timeout: 60000 });
const png = await page.evaluate(async ({ clip, times, views, scale, cols }) => {
  const v = viewer, THREE = v.THREE, R = v.renderer;
  const { ArtCamera } = await import('./js/art2d/bridge3d.js');
  const project = await (await fetch('../characters2d/aureate_knight/character.json')).json();
  const av = project.artView, art = new ArtCamera({ ...av, pixelsPerMeter: av.pixelsPerMeter });
  const c = v.state.ch.clip(clip); if (!c) return null;
  const ts = times || Array.from({ length: 16 }, (_, i) => +(c.duration * i / 15).toFixed(3));
  const W = Math.round(1100 * scale), H = Math.round(1500 * scale);
  const cam = (name) => {
    if (name === 'art') return art.threeCamera(-560, -40, 560, 1460);
    const k = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
    const target = new THREE.Vector3(0, 0.95, 0);
    // three.js world: +Y up, character faces +Z (Blender -Y), its right = -X... (glTF): views placed accordingly
    const pos = { front: [0, 1.0, 5.2], side: [-5.2, 1.0, 0.2], top: [0, 6.0, 0.6] }[name];
    k.position.set(...pos); k.lookAt(target); k.updateProjectionMatrix(); k.updateMatrixWorld(true); return k;
  };
  const sheet = document.createElement('canvas'); const n = ts.length * views.length;
  sheet.width = Math.min(n, cols) * (W + 4); sheet.height = Math.ceil(n / cols) * (H + 20);
  const g = sheet.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height); g.font = '12px sans-serif';
  v.state.suspendLoop = true;
  const size = R.getSize(new THREE.Vector2()), pr = R.getPixelRatio(), bg = v.scene.background;
  let i = 0;
  for (const t of ts) for (const vw of views) {
    v.playClip(clip, t, false); v.state.ch.root.updateMatrixWorld(true);
    R.setPixelRatio(1); R.setSize(W, H, false); v.scene.background = new THREE.Color(0.13, 0.14, 0.17);
    R.render(v.scene, cam(vw));
    const X = (i % cols) * (W + 4), Y = Math.floor(i / cols) * (H + 20);
    g.drawImage(R.domElement, X, Y + 20); g.fillStyle = '#ddd'; g.fillText(`${clip} ${t.toFixed(2)}s ${vw}`, X + 3, Y + 14); i++;
  }
  R.setPixelRatio(pr); R.setSize(size.x, size.y, false); v.scene.background = bg; v.state.suspendLoop = false;
  return sheet.toDataURL('image/png');
}, { clip, times: arg('times') ? arg('times').split(',').map(Number) : null, views, scale, cols });
if (!png) { console.log(`clip ${clip} not found`); process.exit(1); }
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
await browser.close(); server.close();
