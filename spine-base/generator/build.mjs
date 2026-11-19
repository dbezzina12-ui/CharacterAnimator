// Build both characters: draw the placeholder pieces, pack the atlas, write Spine 4.2 JSON, template sheets and parts lists.
// usage: node spine-base/generator/build.mjs
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';
import { HUMAN, DWARF, buildRig } from './rig.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(here, '..');
const D2R = Math.PI / 180; const r2 = (v) => Math.round(v * 100) / 100; const SCALE = 2;
const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch(); const page = await browser.newPage();
page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${port}/spine-base/generator/draw.html`); await page.waitForFunction(() => window.ready);

for (const P of [HUMAN, DWARF]) {
  const R = buildRig(structuredClone(P));
  const res = await page.evaluate(({ R, S }) => window.buildCharacter(R, S), { R: { P: R.P, world: R.world, geo: R.geo }, S: SCALE });
  const dir = path.join(out, 'export', P.id); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  // attachments: body pieces are drawn upright in world space, so the attachment undoes the bone's setup rotation
  const skins = { default: {}, staff: {}, gun: {} }; const parts = [];
  for (const p of res.pieces) {
    const w = R.world[p.bone]; const cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2; let att;
    if (p.frame === 'bone') att = { x: r2(cx), y: r2(cy), width: r2(p.rect.w), height: r2(p.rect.h) };
    else { const dx = cx - w.x, dy = cy - w.y, c = Math.cos(-w.rot * D2R), s = Math.sin(-w.rot * D2R); att = { x: r2(dx * c - dy * s), y: r2(dx * s + dy * c), rotation: r2(-w.rot), width: r2(p.rect.w), height: r2(p.rect.h) }; }
    const slot = p.slot || p.name; const skin = p.skin || 'default'; (skins[skin][slot] ||= {})[p.name] = att;
    fs.writeFileSync(path.join(dir, 'images', `${p.name}.png`), png(p.png));
    const pivot = p.frame === 'bone' ? [(0 - p.rect.x) * SCALE, (p.rect.y + p.rect.h) * SCALE] : [(w.x - p.rect.x) * SCALE, (p.rect.y + p.rect.h - w.y) * SCALE];
    parts.push({ piece: p.name, slot, bone: p.bone, skin, image: `images/${p.name}.png`, sizePx: p.px, sizeUnits: [r2(p.rect.w), r2(p.rect.h)], pivotPx: pivot.map(r2), drawnIn: p.frame === 'bone' ? 'bone frame (barrel along +x)' : 'setup pose (upright, as assembled)' });
  }
  const clean = (o) => { const c = { ...o }; return c; };
  const json = {
    skeleton: { spine: '4.2.40', x: -260, y: -10, width: 620, height: Math.round(P.height * 1.12), images: './images/', fps: 30 },
    bones: R.bones, slots: R.slots, ik: R.ik.map(clean), transform: R.transform.map(clean),
    skins: [
      { name: 'default', attachments: skins.default },
      { name: 'staff', ik: ['staff/far-arm-ik', 'staff/near-arm-ik'], transform: ['staff/far-hand-rot', 'staff/near-hand-rot'], attachments: skins.staff },
      { name: 'gun', ik: ['gun/near-arm-ik'], transform: ['gun/near-hand-rot'], attachments: skins.gun },
    ],
    events: R.events, animations: R.animations,
  };
  fs.writeFileSync(path.join(dir, `${P.file}.json`), JSON.stringify(json));
  fs.writeFileSync(path.join(dir, `${P.file}.png`), png(res.atlas.png));
  const atlas = [`${P.file}.png`, `size: ${res.atlas.w},${res.atlas.h}`, 'filter: Linear,Linear', 'pma: false', ...res.pieces.flatMap((p) => [p.name, `bounds: ${p.atlas[0]},${p.atlas[1]},${p.px[0]},${p.px[1]}`]), ''].join('\n');
  fs.writeFileSync(path.join(dir, `${P.file}.atlas`), atlas);
  fs.mkdirSync(path.join(out, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(out, 'reference', `${P.id}-template.png`), png(await page.evaluate(() => window.buildSheet())));
  fs.writeFileSync(path.join(out, 'reference', `${P.id}-parts.json`), JSON.stringify({ character: P.file, unitsToPixels: SCALE, heightUnits: P.height, hand: P.hand, drawOrderBackToFront: R.slots.map((s) => s.name), parts }, null, 1));
  console.log(`${P.id}: ${R.bones.length} bones, ${R.slots.length} slots, ${res.pieces.length} pieces, atlas ${res.atlas.w}x${res.atlas.h}, ${Object.keys(R.animations).length} animations`);
}
await browser.close(); server.close();
