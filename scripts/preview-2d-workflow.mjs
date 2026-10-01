import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {CHROME, CHROME_ARGS} from './serve.mjs';
const out='validation/workflow';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:[...CHROME_ARGS,'--no-sandbox','--disable-dev-shm-usage']});
try {
 const page=await browser.newPage({viewport:{width:980,height:800}}); const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.goto(pathToFileURL(path.resolve(`${out}/Painted-Knight-2D-Demo.html`)).href);
 await page.waitForFunction(()=>window.runtimeReady);
 const state=await page.evaluate(()=>{character.pause();return {clips:character.clips.length,images:Object.keys(character.pkg.images).length};});
 await page.locator('#clip').selectOption('hover_sword_vigil');await page.locator('#pause').click();
 await page.evaluate(()=>{character.seek(1.5);character.draw({x:0,y:563,zoom:0.55});});
 await page.screenshot({path:`${out}/offline-player.png`});
 fs.mkdirSync(`${out}/frames`,{recursive:true});
 let index=0;
 for(const [clip,duration] of [['hover_sword_vigil',5],['knight_salute',4]]) {
  await page.locator('#clip').selectOption(clip);await page.locator('#pause').click();
  for(let i=0;i<duration*15;i++) {
   await page.evaluate(t=>{character.seek(t);character.draw({x:0,y:563,zoom:0.55});},i/15);
   await page.locator('#c').screenshot({path:`${out}/frames/${String(index++).padStart(4,'0')}.png`});
  }
 }
 const external=requests.filter(url=>/^https?:/.test(url));
 const checks={...state,errors,externalRequests:external,frames:index};
 fs.writeFileSync(`${out}/offline-checks.json`,JSON.stringify(checks,null,2));console.log(checks);
 if(errors.length||external.length||state.clips!==26)process.exitCode=1;
}finally{await browser.close();}
