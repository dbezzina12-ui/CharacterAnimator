// Renders projection reference images, part-ID masks, depth + normal passes, camera/pose
// metadata and texture-space coverage for each character, from its exported GLB in a fresh page.
//   node scripts/render-references.mjs [characterId ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : JSON.parse(fs.readFileSync(path.join(ROOT, 'characters/index.json'), 'utf8')).characters.map((c) => c.id);
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const save = (file, dataUrl) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64')); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

for (const id of ids) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'characters', id, `${id}.character.json`)));
  const glbRel = `characters/${id}/${cfg.files.glb}`;
  const out = path.join(ROOT, 'references', id);
  fs.rmSync(out, { recursive: true, force: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/viewer/render.html`);
  await page.waitForFunction(() => window.__ready);
  const info = await page.evaluate((u) => window.R.load(u), `/${glbRel}`);
  const cams = await page.evaluate(() => window.R.cameras());
  const passes = {};
  for (const cam of cams) {
    passes[cam.name] = {};
    for (const pass of ['beauty', 'partid', 'depth', 'normal']) {
      const r = await page.evaluate(([v, p]) => window.R.render(v, p), [cam.name, pass]);
      const rel = pass === 'beauty' ? `${cam.name}.png` : `${pass === 'partid' ? 'masks' : pass}/${cam.name}_${pass}.png`;
      save(path.join(out, rel), r.png);
      const { png, ...meta } = r;
      passes[cam.name][pass] = { file: rel, ...meta };
    }
  }
  const cov = await page.evaluate(() => window.R.coverage());
  save(path.join(out, 'coverage', 'coverage_uv.png'), cov.coverageUV);
  save(path.join(out, 'coverage', 'part_id_uv.png'), cov.partsUV);
  cov.views3d.forEach((v, i) => save(path.join(out, 'coverage', `coverage_3d_az${v.azimuth}_el${v.elevation}.png`), v.png));
  const totals = { texels: 0, none: 0, grazing: 0, one: 0, multi: 0 };
  for (const s of Object.values(cov.stats)) for (const k of Object.keys(totals)) totals[k] += s[k];
  const legend = JSON.parse(fs.readFileSync(path.join(ROOT, 'textures', 'part_id_colors.json')));
  const record = {
    schema: 'gamboligy.projection-references/1.0',
    characterId: id,
    glb: glbRel,
    glbSha256: sha(path.join(ROOT, glbRel)),
    geometryHash: cfg.geometry.hash,
    uvLayout: `${cfg.uvLayout.id} v${cfg.uvLayout.version}`,
    pose: { name: 'rest/bind A-pose', animation: null, note: 'All passes use the GLB bind pose (no clip applied). Reproduce by loading the GLB and not playing any animation.' },
    coordinateSystem: cfg.coordinateSystem,
    lighting: 'beauty: HemisphereLight(white, #8a8a8a, 1.9) + camera-aligned DirectionalLight(1.2); no shadows; transparent background',
    characterHeight: info.height,
    cameras: cams,
    passes,
    partIdLegend: legend,
    masksNote: 'Part-ID masks are unlit, non-antialiased flat colours (see partIdLegend); background alpha 0.',
    coverage: {
      files: { uv: 'coverage/coverage_uv.png', partIdUV: 'coverage/part_id_uv.png', views3d: cov.views3d.map((v) => `coverage/coverage_3d_az${v.azimuth}_el${v.elevation}.png`) },
      legend: { magenta: 'not seen by ANY reference view', orange: 'only grazing views (facing < 0.35)', yellow: 'one good view', green: 'two or more good views' },
      uvTexelFractions: Object.fromEntries(Object.entries(totals).filter(([k]) => k !== 'texels').map(([k, v]) => [k, +(v / totals.texels).toFixed(4)])),
      perPart: Object.fromEntries(Object.entries(cov.stats).map(([n, s]) => [n, { unseen: +(s.none / s.texels).toFixed(3), grazingOnly: +(s.grazing / s.texels).toFixed(3), oneView: +(s.one / s.texels).toFixed(3), multiView: +(s.multi / s.texels).toFixed(3) }])),
      singleViewTexelCoverage: cov.singleViewTexelCoverage,
      warning: 'A single view never covers the model. Unseen/grazing regions must be filled from additional views or painted before baking.',
    },
  };
  fs.writeFileSync(path.join(out, 'cameras.json'), JSON.stringify(record, null, 2));
  cfg.projection = { references: `references/${id}/cameras.json`, views: cams.map((c) => c.name), coverage: record.coverage.uvTexelFractions };
  fs.writeFileSync(path.join(ROOT, 'characters', id, `${id}.character.json`), JSON.stringify(cfg, null, 2));
  console.log(id, 'refs ok; coverage', JSON.stringify(record.coverage.uvTexelFractions), 'single', JSON.stringify(cov.singleViewTexelCoverage));
  await page.close();
}
await browser.close();
server.close();
