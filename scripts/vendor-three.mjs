// Copies the few three.js files the viewer needs into viewer/vendor so the viewer runs
// from any static file server without npm or a CDN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'node_modules/three');
const dst = path.join(ROOT, 'viewer/vendor/three');
const files = ['build/three.module.js', 'build/three.core.js', 'LICENSE',
  'examples/jsm/controls/OrbitControls.js', 'examples/jsm/controls/TransformControls.js',
  'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/exporters/GLTFExporter.js',
  'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js'];
for (const f of files) {
  const out = path.join(dst, f.replace('examples/jsm/', 'addons/'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(src, f), out);
}
const v = JSON.parse(fs.readFileSync(path.join(src, 'package.json'))).version;
fs.writeFileSync(path.join(dst, 'VERSION'), v + '\n');
console.log('vendored three', v, '->', path.relative(ROOT, dst));
