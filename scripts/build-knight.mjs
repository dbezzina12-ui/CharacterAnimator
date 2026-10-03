// Build the knight through the actual viewer, export portable GLBs, and package
// a single offline HTML playground. CHROME_PATH selects an installed Chromium.
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer,CHROME,CHROME_ARGS} from './serve.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]||path.join(ROOT,'dist-knight'));
const charDir=path.join(ROOT,'characters/aureate_knight');
const cfgPath=path.join(charDir,'aureate_knight.character.json');
const server=await startServer(0);
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:[...CHROME_ARGS,'--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>console.error(e));
  await page.goto(`http://127.0.0.1:${server.address().port}/viewer/knight.html?buildKnight=1`);
  await page.waitForFunction(()=>window.viewer?.ready||window.viewer?.error,null,{timeout:45000});
  const error=await page.evaluate(()=>window.viewer.error);
  if(error)throw new Error(error);
  const assets=await page.evaluate(async()=>{
    const b64=buf=>{const a=new Uint8Array(buf);let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s);};
    const glb=await viewer.exportGLB();
    const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
    const s=new viewer.THREE.Scene();s.add(viewer.state.weapons.getObjectByName('Sword2H').clone(true));
    const sword=await new GLTFExporter().parseAsync(s,{binary:true});
    return {glb:b64(glb),sword:b64(sword),clips:viewer.state.ch.clips.map(c=>({name:c.name,duration:c.duration})),metadata:viewer.state.cfg.animations,meshes:viewer.renderer.info.render.calls};
  });
  fs.writeFileSync(path.join(charDir,'aureate_knight.glb'),Buffer.from(assets.glb,'base64'));
  fs.writeFileSync(path.join(ROOT,'props/aureate-sword.glb'),Buffer.from(assets.sword,'base64'));
  const cfg=JSON.parse(fs.readFileSync(cfgPath));cfg.knightBuild=false;
  cfg.authoring={armor:'viewer/js/knight.js',animation:'tools/knight_motion.py',build:'npm run build:knight',notes:'63 original joints; fitted bone-parented armor; baked IK clips; two cape morph targets.'};
  cfg.animations=assets.clips.map(c=>({...assets.metadata.find(a=>a.name===c.name),...c}));
  fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
  fs.mkdirSync(out,{recursive:true});
  const cfgRel='characters/aureate_knight/aureate_knight.character.json';
  const glbRel='characters/aureate_knight/aureate_knight.glb';
  const embedded={json:{'characters/index.json':{characters:[JSON.parse(fs.readFileSync(path.join(ROOT,'characters/index.json'))).characters.find(c=>c.id==='aureate_knight')]},[cfgRel]:cfg,'props/weapons.json':JSON.parse(fs.readFileSync(path.join(ROOT,'props/weapons.json')))},binary:{[glbRel]:assets.glb,'props/weapons.glb':fs.readFileSync(path.join(ROOT,'props/weapons.glb')).toString('base64'),'characters/aureate_knight/test_props.glb':fs.readFileSync(path.join(charDir,'test_props.glb')).toString('base64')},checker:'data:image/png;base64,'+fs.readFileSync(path.join(ROOT,'textures/uv_checker_2048.png')).toString('base64')};
  const bundle=await build({entryPoints:[path.join(ROOT,'viewer/js/app.js')],bundle:true,write:false,format:'iife',minify:true});
  let html=fs.readFileSync(path.join(ROOT,'viewer/knight.html'),'utf8');
  html=html.replace(/<script type="importmap">[\s\S]*?<\/script>/,'');
  // replacer function: a replacement STRING would expand `$'`, `$&` etc. found in the minified bundle and splice HTML into it
  const inline=`<script>window.__CB_BASE='';window.__CB_EMBED=${JSON.stringify(embedded)};</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`;
  html=html.replace('<script type="module" src="./js/app.js"></script>',()=>inline);
  const file=path.join(out,'Aureate-Knight-Playground.html');
  fs.writeFileSync(file,html);
  console.log(JSON.stringify({file,bytes:fs.statSync(file).size,glbBytes:Buffer.from(assets.glb,'base64').length,clips:assets.clips.length}));
} finally {await browser.close();server.close();}
