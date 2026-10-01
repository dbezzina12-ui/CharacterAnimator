// Real UI and artwork replacement regressions, beyond the numeric acceptance suite.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
const out = 'validation/workflow'; fs.mkdirSync(out, {recursive:true});
const server = await startServer(0);
const browser = await chromium.launch({executablePath:CHROME,headless:true,args:[...CHROME_ARGS,'--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage({viewport:{width:1440,height:950}});
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
try {
 await page.goto(`http://127.0.0.1:${server.address().port}/viewer/knight.html?art=2d`);
 await page.waitForFunction(()=>window.art2d?.editor?.ready, null, {timeout:120000});
 await page.evaluate(()=>art2d.editor.ready);
 await page.locator('#p2Pause').click();
 await page.locator('[data-ov="bones"]').uncheck(); await page.locator('[data-ov="contacts"]').uncheck();
 await page.locator('#p2Clip').selectOption('hover_sword_vigil');
 await page.evaluate(()=>{art2d.seek(1.5); art2d.editor.fitView(true);});
 await page.locator('#stage2d').screenshot({path:`${out}/before.png`});
 const prepared = await page.evaluate(async()=>{
   const io=await import('./js/art2d/project-io.js');
   const img=await io.decodeImage(new Uint8Array(await (await fetch('../validation/workflow/art/painted-helmet-source.png')).arrayBuffer()));
   const input=document.createElement('canvas');input.width=img.width;input.height=img.height;input.getContext('2d').putImageData(img,0,0);
   const target=document.createElement('canvas');target.width=279;target.height=487;target.getContext('2d').drawImage(input,0,0,279,487);
   const bytes=await io.encodePNG(target.getContext('2d').getImageData(0,0,279,487));
   let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(binary);
 });
 fs.writeFileSync(`${out}/art/painted-helmet.png`,Buffer.from(prepared,'base64'));
 const hash = ()=>page.evaluate(async()=>{
   const p=art2d.project, a=p.attachments['helmet.default'], bytes=art2d.store.bytes(p.images[a.image].path);
   return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 });
 const originalHash=await hash();
 await page.evaluate(()=>art2d.selectSlot('helmet','helmet.default'));
 await page.locator('#p2Replace').setInputFiles(`${out}/art/painted-helmet.png`);
 await page.waitForFunction(()=>art2d.project.attachments['helmet.default'].source.kind==='imported');
 await page.waitForFunction(()=>!document.querySelector('#p2Replace').value);
 const paintedHash=await hash();
 await page.locator('#p2Undo').click(); const undoneHash=await hash();
 await page.locator('#p2Redo').click(); const redoneHash=await hash();
 // Author a joint correction and finger curl through the actual inspector/hand controls, then undo.
 await page.locator('#p2Clip').selectOption('idle');
 await page.evaluate(()=>{art2d.seek(1);art2d.selectBone('upperarm_R');});
 const rotation=page.locator('[data-bk="rotate"]'); await rotation.fill('25'); await rotation.press('Tab');
 const posed=await page.evaluate(()=>art2d.project.clips.find(c=>c.name==='idle').corrections.bones.upperarm_R.rotate.v.includes(25));
 await page.locator('#p2Undo').click();
 await page.locator('[data-hp="R"][data-p="fist"]').click();
 const handPosed=await page.evaluate(()=>art2d.project.clips.find(c=>c.name==='idle').corrections.hands.R.curl.includes(1));
 await page.locator('#p2Undo').click();
 await page.locator('#p2Clip').selectOption('knight_salute');
 await page.evaluate(()=>{art2d.seek(1.8);art2d.editor.fitView(true);});
 await page.locator('#stage2d').screenshot({path:`${out}/painted-salute.png`});
 const downloads = async(button,path)=>{const pending=page.waitForEvent('download');await page.locator(button).click();const d=await pending;await d.saveAs(path);};
 await downloads('#p2Save',`${out}/painted-knight.character2d.zip`);
 await downloads('#p2Runtime',`${out}/painted-knight.runtime.zip`);
 await page.locator('#p2Open').setInputFiles(`${out}/painted-knight.character2d.zip`);
 await page.waitForFunction(()=>art2d.editor.from==='painted-knight.character2d.zip');await page.evaluate(()=>art2d.editor.ready);
 const reopenedHash=await hash();
 // A resized copy of the SAME prop should preserve grip/button landmark positions.
 const prop = await page.evaluate(async()=>{
   const io=await import('./js/art2d/project-io.js'), {Rig}=await import('./js/art2d/core.js');
   const p=art2d.project, a=Object.values(p.attachments).find(a=>a.slot==='prop_R'&&a.markers?.button);
   const points=()=>{const r=new Rig(p);r.evaluate(null,0);return Object.fromEntries(Object.keys(a.markers).map(k=>[k,r.markerWorld(a.id,k)]));};
   const before=points(), im=p.images[a.image], data=await io.decodeImage(art2d.store.bytes(im.path));
   const src=document.createElement('canvas');src.width=data.width;src.height=data.height;src.getContext('2d').putImageData(data,0,0);
   const dst=document.createElement('canvas');dst.width=data.width*2;dst.height=data.height*2;dst.getContext('2d').drawImage(src,0,0,dst.width,dst.height);
   await io.replaceImage(p,art2d.store,a.id,await io.encodePNG(dst.getContext('2d').getImageData(0,0,dst.width,dst.height)));
   const after=points();return {id:a.id,before,after,maxDrift:Math.max(...Object.keys(before).map(k=>Math.hypot(before[k][0]-after[k][0],before[k][1]-after[k][1])))};
 });
 // Clicking the already selected 2D mode must not register extra animation loops.
 const loops=await page.evaluate(async()=>{
   const old=window.requestAnimationFrame;let callbacks=new Set();
   window.requestAnimationFrame=(fn)=>{if(fn.toString().includes('this.frame(dt)'))callbacks.add(fn);return old.call(window,fn);};
   const measure=()=>new Promise(resolve=>{callbacks=new Set();setTimeout(()=>resolve(callbacks.size),400);});
   const before=await measure();
   document.querySelector('.modeSwitch [data-m="2d"]').click();document.querySelector('.modeSwitch [data-m="2d"]').click();
   await new Promise(resolve=>setTimeout(resolve,100));const after=await measure();
   await viewer.art2d.setMode('3d'); await viewer.art2d.setMode('2d');
   await new Promise(resolve=>setTimeout(resolve,100)); const afterRapidSwitch=await measure();window.requestAnimationFrame=old;
   return {before,after,afterRapidSwitch,pass:before===1&&after===1&&afterRapidSwitch===1};
 });
 const result={undoArtwork:{originalHash,paintedHash,undoneHash,redoneHash,pass:originalHash===undoneHash&&paintedHash===redoneHash},posing:{joint:posed,hand:handPosed},saveReopen:paintedHash===reopenedHash,prop,loops,errors};
 fs.writeFileSync(`${out}/checks.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 if(!result.undoArtwork.pass||!result.saveReopen||!posed||!handPosed||prop.maxDrift>0.01||!loops.pass||errors.length)process.exitCode=1;
} finally {await browser.close();server.close();}
