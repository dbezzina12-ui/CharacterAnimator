// Single-file standalone player: runtime + package (JSON + atlas pages) inlined into one HTML file that
// plays offline by double-click (no server, no editor, no three.js).
//   node scripts/build-standalone-player.mjs [--package=runtime/example/package/aureate_knight_2d.runtime.json] [--out=exports/player/aureate-knight-2d-player.html]
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const pkgPath = arg('package', 'runtime/example/package/aureate_knight_2d.runtime.json');
const out = arg('out', 'exports/player/aureate-knight-2d-player.html');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const dir = path.dirname(pkgPath);
const atlas = Object.fromEntries(pkg.atlas.pages.map((p) => [p.path, `data:image/png;base64,${fs.readFileSync(path.join(dir, p.path)).toString('base64')}`]));
const runtime = fs.readFileSync('runtime/gamboligy-character2d.js', 'utf8');
if (/<\/script/i.test(runtime)) throw new Error('runtime contains </script>');
let html = fs.readFileSync('runtime/example/index.html', 'utf8');
const safeJSON = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
html = html.replace("import { Character2D } from '../gamboligy-character2d.js';",
  `${runtime}\nconst PACKAGE = JSON.parse(document.getElementById('pkg').textContent);\nconst ATLAS = ${safeJSON(atlas)};`);
html = html.replace("const pkgUrl = q.get('package') || './package/aureate_knight_2d.runtime.json';\n", '');
html = html.replace("await Character2D.load(pkgUrl, {", "await Character2D.load({ json: PACKAGE, resolve: (p) => ATLAS[p] }, {");
html = html.replace('This page loads only <code>package/*.runtime.json</code> + atlas pages through <code>../gamboligy-character2d.js</code>. No editor, no three.js, no 3D files.',
  'One self-contained file: the runtime, the character package and its atlas pages are embedded. Works offline; no editor, no three.js, no 3D files.');
html = html.replace('<script type="module">', `<script type="application/json" id="pkg">${safeJSON(pkg)}</script>\n<script type="module">`);
for (const must of ['PACKAGE', 'ATLAS[p]', 'id="pkg"']) if (!html.includes(must)) throw new Error(`template changed: ${must} not injected`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
