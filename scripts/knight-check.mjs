import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import {startServer,CHROME,CHROME_ARGS} from './serve.mjs';
const offlineDir=process.argv[2] ? path.resolve(process.argv[2]) : null;
const server=await startServer(0,offlineDir?{'/offline/':offlineDir}:{});
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:[...CHROME_ARGS,'--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE',m.text());}});
await page.goto(`http://127.0.0.1:${server.address().port}/${offlineDir?'offline/Aureate-Knight-Playground.html':'viewer/knight.html'}`);
await page.waitForFunction(()=>window.viewer?.ready||window.viewer?.error,null,{timeout:30000}).catch(async e=>{console.log(await page.locator('body').innerText());throw e;});
const result=await page.evaluate(()=>({ready:viewer.ready,error:viewer.error,clips:viewer.state.ch?.clips.map(c=>c.name),bones:Object.keys(viewer.state.ch?.bones||{}).length}));
fs.mkdirSync('validation/knight',{recursive:true});
for(const [clip,t] of [['hover_sword_vigil',0],['sword_2h_idle',1],['sword_2h_slash',.8],['walk_in_place',.3],['knight_salute',1.8]]){
 await page.evaluate(([c,t])=>viewer.playClip(c,t,false),[clip,t]);
 await page.screenshot({path:`validation/knight/${clip}.png`});
}
console.log(JSON.stringify({result,errors}));
// Read the exported asset in a fresh Character and sample the custom loop.
const checks=await page.evaluate(async()=>{
 const v=viewer, ch=v.state.ch, bones=Object.keys(ch.bones).length;
 let meshCount=0,morphCount=0;ch.root.traverse(o=>{if(o.isMesh)meshCount++;if(o.morphTargetInfluences)morphCount++;});
 const clip=ch.clip('hover_sword_vigil');
 let loopMax=0;
 for(const track of clip.tracks){const n=track.getValueSize();for(let k=0;k<n;k++)loopMax=Math.max(loopMax,Math.abs(track.values[k]-track.values[track.values.length-n+k]));}
 let minFoot=Infinity,maxContactDrift=0,offset=null;
 for(let i=0;i<16;i++){
  v.playClip('hover_sword_vigil',clip.duration*i/16,false);ch.root.updateMatrixWorld(true);
  const l=ch.bones.hand_L.getWorldPosition(new v.THREE.Vector3()),r=ch.bones.hand_R.getWorldPosition(new v.THREE.Vector3());
  const d=l.sub(r);if(!offset)offset=d.clone();maxContactDrift=Math.max(maxContactDrift,d.distanceTo(offset));
  for(const side of ['L','R'])minFoot=Math.min(minFoot,ch.bones['foot_'+side].getWorldPosition(new v.THREE.Vector3()).y);
 }
 const buf=await v.exportGLB();
 const countBefore=ch.clips.length;
 const cfg=v.exportConfig();await v.loadCharacter(buf,cfg,null);
 const countAfter=v.state.ch.clips.length;
 return {bones,meshCount,morphCount,loopMax,maxContactDrift,minFoot,exportBytes:buf.byteLength,countBefore,countAfter,exportCfgRebuildsArmor:cfg.knightBuild};
});
if(errors.length||checks.bones!==63||checks.countAfter!==24||checks.loopMax>.0001||checks.maxContactDrift>.001||checks.minFoot<.1||checks.exportCfgRebuildsArmor)throw new Error(JSON.stringify({errors,checks}));
await page.setViewportSize({width:390,height:844});
const mobile=await page.evaluate(()=>({fits:document.documentElement.scrollWidth<=innerWidth,canvasWidth:document.querySelector('#main').clientWidth}));
if(!mobile.fits||mobile.canvasWidth<300)throw new Error('Mobile overflow '+JSON.stringify(mobile));
fs.writeFileSync('validation/knight/checks.json',JSON.stringify({checks,mobile,errors},null,2));
console.log(JSON.stringify({checks,mobile}));
await browser.close();server.close();
