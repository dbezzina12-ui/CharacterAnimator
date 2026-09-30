// Repackage existing assets without rebuilding the source rig or animation data.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]||path.join(root,'dist-knight'));
const cfgRel='characters/aureate_knight/aureate_knight.character.json';
const glbRel='characters/aureate_knight/aureate_knight.glb';
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const b64=p=>fs.readFileSync(path.join(root,p)).toString('base64');
const embedded={
  json:{'characters/index.json':{characters:[json('characters/index.json').characters.find(c=>c.id==='aureate_knight')]},[cfgRel]:json(cfgRel),'props/weapons.json':json('props/weapons.json')},
  binary:{[glbRel]:b64(glbRel),'props/weapons.glb':b64('props/weapons.glb'),'characters/aureate_knight/test_props.glb':b64('characters/aureate_knight/test_props.glb')},
  checker:'data:image/png;base64,'+b64('textures/uv_checker_2048.png')
};
const bundle=await build({entryPoints:[path.join(root,'viewer/js/app.js')],bundle:true,write:false,format:'iife',minify:true});
let html=fs.readFileSync(path.join(root,'viewer/knight.html'),'utf8').replace(/<script type="importmap">[\s\S]*?<\/script>/,'');
html=html.replace('<script type="module" src="./js/app.js"></script>',`<script>window.__CB_BASE='';window.__CB_EMBED=${JSON.stringify(embedded)};</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`);
fs.mkdirSync(out,{recursive:true});
const file=path.join(out,'Aureate-Knight-Playground.html');fs.writeFileSync(file,html);
console.log(JSON.stringify({file,bytes:fs.statSync(file).size}));
