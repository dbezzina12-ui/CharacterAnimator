// Writes the body-only page used when the app is published as a claude.ai artifact: same markup as app.html, stylesheet inlined.
// usage: node spine-base/scripts/build-artifact-page.mjs <out.html>   (publish it with app/, generator/ and runtime/ as supporting files)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const html = fs.readFileSync(path.join(base, 'app.html'), 'utf8');
const body = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->')).trim();
const font = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const out = `<title>Character Kit</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${font}\n<style>\n${fs.readFileSync(path.join(base, 'app/app.css'), 'utf8')}</style>\n\n${body}\n`;
fs.writeFileSync(process.argv[2], out); console.log('wrote', process.argv[2], out.length, 'bytes');
