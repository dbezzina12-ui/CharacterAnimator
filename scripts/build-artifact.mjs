// Builds a single-page, hosted copy of the viewer (for publishing as a web page):
// the viewer modules are inlined into one page, three.js comes from jsDelivr (pinned),
// and the character GLBs/configs/textures are copied next to it.
//   node scripts/build-artifact.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist-web'));
const THREE_V = fs.readFileSync(path.join(ROOT, 'viewer/vendor/three/VERSION'), 'utf8').trim();
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const strip = (src) => src.split('\n')
  .filter((l) => !/^import\s.+from\s+['"].+['"];?\s*$/.test(l))
  .map((l) => l.replace(/^export\s+(?=(async\s+)?(function|class|const|let)\b)/, ''))
  .join('\n');
const mods = ['refcams.js', 'character.js', 'coverage.js', 'app.js']
  .map((f) => `// ---- ${f}\n` + strip(fs.readFileSync(path.join(ROOT, 'viewer/js', f), 'utf8')));

const html = fs.readFileSync(path.join(ROOT, 'viewer/index.html'), 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1]
  .replace('html, body { margin: 0; height: 100%;', 'html, body { margin: 0; height: 100%; color-scheme: dark;')
  .replace('#side { width: 300px; min-width: 300px; overflow-y: auto; background: var(--panel); border-right: 1px solid var(--line); padding: 8px 10px 40px; }',
    '#side { width: 300px; min-width: 300px; overflow-y: auto; background: var(--panel); border-right: 1px solid var(--line); padding: 8px 16px 40px; }');
let body = html.match(/<body>([\s\S]*?)<script type="module"/)[1]
  .replace('<div class="muted">Exports geometry,', '<div class="muted">Web version: Export keeps the GLB in memory and Reload rebuilds the character from those bytes only (file downloads need the local viewer). Exports geometry,');
const page = `<title>Character Base Viewer</title>
<style>
/* Layout: sidebar of controls + full-height 3D viewport; single dark workspace theme by choice. */
:root { color-scheme: dark; }
${style}
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--acc); outline-offset: 1px; }
</style>
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@${THREE_V}/build/three.module.js",
               "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_V}/examples/jsm/" } }
</script>
${body}
<script>window.__CB_HOSTED = true; window.__CB_BASE = '';</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
${mods.join('\n')}
</script>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), page);

const copy = (rel) => { const d = path.join(OUT, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), d); return rel; };
const files = [copy('characters/index.json'), copy('textures/uv_checker_2048.png')];
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'characters/index.json')));
for (const c of idx.characters) {
  files.push(copy(`characters/${c.id}/${c.config}`));
  for (const f of [c.glb, c.props]) {          // GLB -> base64 text (the web host serves web types only)
    const rel = `characters/${c.id}/${f}.b64.txt`;
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), fs.readFileSync(path.join(ROOT, `characters/${c.id}/${f}`)).toString('base64'));
    files.push(rel);
  }
}
// shared weapon props (auto-attached by the weapon clips)
files.push(copy('props/weapons.json'));
fs.writeFileSync(path.join(OUT, 'props/weapons.glb.b64.txt'), fs.readFileSync(path.join(ROOT, 'props/weapons.glb')).toString('base64'));
files.push('props/weapons.glb.b64.txt');
fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify(files, null, 1));
console.log('built', OUT, files.length + 1, 'files');
