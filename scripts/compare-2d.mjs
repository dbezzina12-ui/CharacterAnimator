// 3D vs 2D at the same clip time through the saved art camera, side by side:
// node scripts/compare-2d.mjs out.png clip:t[,clip:t...] [--rect=x0,y0,x1,y1] [--project=characters2d/aureate_knight/character.json] [--skin=painted]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const [out, list] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const shots = list.split(',').map((s) => { const [c, t] = s.split(':'); return [c, +t]; });
const rect = (arg('rect') || '-420,-20,420,1080').split(',').map(Number);
const projectPath = arg('project', 'characters2d/aureate_knight/character.json');
const scale = +(arg('scale') || 0.5), skin = arg('skin');
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/knight.html?hideui=1`);
await page.waitForFunction(() => window.viewer?.ready, null, { timeout: 60000 });
const png = await page.evaluate(async ({ shots, rect, projectPath, scale, skin }) => {
  const { Rig } = await import('./js/art2d/core.js');
  const { Renderer2D } = await import('./js/art2d/render2d.js');
  const { ArtCamera } = await import('./js/art2d/bridge3d.js');
  const project = await (await fetch('../' + projectPath)).json();
  const rig = new Rig(project); if (skin) rig.setSkin(skin);
  const [x0, y0, x1, y1] = rect, W = Math.round((x1 - x0) * scale), H = Math.round((y1 - y0) * scale);
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const r2 = new Renderer2D(c2, { background: [0.13, 0.14, 0.17, 1] });
  await r2.loadImages(project, (p) => new URL(p, new URL('../' + projectPath, location.href)).href);
  r2.view = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: scale };
  const av = project.artView, cam = new ArtCamera({ ...av, pixelsPerMeter: av.pixelsPerMeter });
  const cam3 = cam.threeCamera(x0, y0, x1, y1);
  const sheet = document.createElement('canvas'); sheet.width = W * 2 + 10; sheet.height = (H + 24) * shots.length;
  const g = sheet.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
  const v = viewer, R = v.renderer; v.state.suspendLoop = true;
  const size = R.getSize(new v.THREE.Vector2()), pr = R.getPixelRatio(), bg = v.scene.background;
  for (let i = 0; i < shots.length; i++) {
    const [clip, t] = shots[i];
    v.playClip(clip, t, false); v.illustration?.update(); v.state.ch.root.updateMatrixWorld(true);
    R.setPixelRatio(1); R.setSize(W, H, false); v.scene.background = new v.THREE.Color(0.13, 0.14, 0.17);
    R.render(v.scene, cam3);
    g.drawImage(R.domElement, 0, i * (H + 24) + 24);
    const pose = rig.evaluate(clip, t);
    r2.draw(rig, pose, { dpr: 1 });
    g.drawImage(c2, W + 10, i * (H + 24) + 24);
    g.fillStyle = '#ddd'; g.font = '14px sans-serif'; g.fillText(`${clip} @ ${t}s — 3D (left) | 2D (right)`, 6, i * (H + 24) + 17);
  }
  R.setPixelRatio(pr); R.setSize(size.x, size.y, false); v.scene.background = bg; v.state.suspendLoop = false;
  return sheet.toDataURL('image/png');
}, { shots, rect, projectPath, scale, skin });
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
await browser.close(); server.close();
