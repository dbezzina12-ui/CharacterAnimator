import {chromium} from 'playwright-core';
import {startServer,CHROME,CHROME_ARGS} from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve(process.argv[2]);
const server=await startServer(0,{'/offline/':dir});
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:[...CHROME_ARGS,'--no-sandbox','--disable-dev-shm-usage']});
try{
  const p=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto(`http://127.0.0.1:${server.address().port}/offline/Aureate-Knight-Playground.html`);
  await p.waitForFunction(()=>viewer.ready||viewer.error,null,{timeout:45000});
  fs.mkdirSync('validation/illustrated',{recursive:true});
  const info=await p.evaluate(()=>({error:viewer.error,bones:Object.keys(viewer.state.ch.bones).length,clips:viewer.state.ch.clips.length,flat:viewer.camera.isOrthographicCamera}));
  if(info.error||info.bones!==63||info.clips!==24||!info.flat)throw Error(JSON.stringify(info));
  for(const [clip,t] of [['hover_sword_vigil',.8],['sword_2h_slash',.8],['walk_in_place',.3],['knight_salute',1.8]]){
    await p.evaluate(([clip,t])=>{viewer.playClip(clip,t,false);viewer.illustration.update();},[clip,t]);
    await p.screenshot({path:`validation/illustrated/${clip}.png`});
  }
  await p.evaluate(()=>viewer.playClip('hover_sword_vigil',.8,false));
  await p.locator('#artOriginal').click();
  await p.screenshot({path:'validation/illustrated/original.png'});
  await p.locator('#artPainted').click();
  await p.locator('#flatCamera').uncheck();
  if(!await p.evaluate(()=>viewer.camera.isPerspectiveCamera))throw Error('Camera switch failed');
  await p.locator('#flatCamera').check();
  const downloadPromise=p.waitForEvent('download');
  await p.locator('#btnPNG').click();
  await (await downloadPromise).saveAs('validation/illustrated/transparent-frame.png');
  const result=await p.evaluate(async()=>{
    const v=viewer;
    for(let i=0;i<12;i++){v.playClip(i%2?'sword_2h_idle':'hover_sword_vigil',.3,false);v.illustration.update();}
    const cacheSize=v.illustration.records.size;
    const data=await v.exportGLB(),cfg=v.exportConfig();
    const bytes=new Uint8Array(data);
    const jsonSize=new DataView(data).getUint32(12,true);
    const gltf=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+jsonSize)));
    const painted=gltf.materials.filter(m=>m.extras?.illustrated);
    if(painted.some(m=>!m.extensions?.KHR_materials_unlit||!m.pbrMetallicRoughness?.baseColorTexture))throw Error('Export lost paint');
    await v.loadCharacter(data,cfg,null);v.illustration.update();
    v.playClip('hover_sword_vigil',.8,false);v.illustration.update();
    const root=v.state.ch.root;
    let ink=0,converted=0,invalid=0;
    root.traverse(o=>{if(o.isMesh){if(o.userData.illustrationInk)ink++;else if(o.material.userData.illustrated)converted++;const a=o.geometry.attributes.position.array;for(const value of a)if(!Number.isFinite(value))invalid++;}});
    return {cacheSize,exportBytes:data.byteLength,paintedMaterials:painted.length,ink,converted,invalid,bones:Object.keys(v.state.ch.bones).length,clips:v.state.ch.clips.length,importedPaint:v.illustration.records.size};
  });
  if(result.cacheSize>220||result.converted<170||result.ink<170||result.invalid||result.bones!==63||result.clips!==24)throw Error(JSON.stringify(result));
  await p.screenshot({path:'validation/illustrated/reloaded.png'});
  await p.setViewportSize({width:390,height:844});
  if(!await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#main').clientHeight>=300))throw Error('Mobile layout failed');
  await p.screenshot({path:'validation/illustrated/mobile.png'});
  if(errors.length)throw Error(JSON.stringify(errors));
  fs.writeFileSync('validation/illustrated/checks.json',JSON.stringify({info,result,errors},null,2));
  console.log(JSON.stringify({info,result,errors}));
} finally {await browser.close();server.close();}
