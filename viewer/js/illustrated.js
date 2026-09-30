import * as THREE from 'three';

// Portable illustration: authored light is baked into ramp UVs, and ink is
// real reversed-winding geometry. Neither depends on a screen-space filter.
const RAMPS = {
  steel: ['#253b50','#456779','#7997a7','#adc5ce','#e8e9dc'],
  light: ['#344b61','#658699','#a5bfca','#d5dfdf','#fff1d6'],
  gold: ['#624125','#9e692d','#d8a14b','#f3cb78','#fff0b9'],
  dark: ['#101924','#1b2d40','#2e485b','#496479','#738c99'],
  leather: ['#0c1120','#141c2c','#242e43','#364359','#536178'],
  cloth: ['#15162f','#26254e','#3e3b77','#595396','#827aad'],
  lining: ['#292442','#48416a','#686092','#8981ae','#aaa1c8'],
  black: ['#060b13','#09131f','#102332','#153044','#294256'],
  jewel: ['#174553','#287b8b','#55bac7','#9bdedf','#e1ffff'],
};
const PALETTE = Object.fromEntries(Object.entries(RAMPS).map(([k,cs])=>[k,cs.map(c=>new THREE.Color(c))]));
const SOURCE = {
  steel:0x859caf,light:0xcbd7df,dark:0x152230,gold:0xd9a650,
  leather:0x171b27,cloth:0x252652,lining:0x655c87,black:0x030b13,jewel:0x5bb7ca,
};
const KEY = new THREE.Vector3(-.55,.72,.68).normalize();
const maps = new Map();
function paintedRamp(kind){
  if(maps.has(kind))return maps.get(kind);
  const data=new Uint8Array(512*4),ramp=PALETTE[kind];
  const stops=[0,.26,.54,.78,.96];
  for(let i=0;i<512;i++){
    const value=i/511;
    let band=0;while(band<4&&value>stops[band+1])band++;
    const c=ramp[band].clone();
    if(band<4){const blend=THREE.MathUtils.smoothstep(value,stops[band+1]-.035,stops[band+1]);c.lerp(ramp[band+1],blend);}
    c.convertLinearToSRGB();data.set([Math.round(c.r*255),Math.round(c.g*255),Math.round(c.b*255),255],i*4);
  }
  const texture=new THREE.DataTexture(data,512,1,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  texture.name='Painted_Ramp_'+kind;maps.set(kind,texture);return texture;
}
const inkMat = new THREE.MeshBasicMaterial({color:0x100f1c, toneMapped:false, fog:false});
inkMat.name='Illustration_Ink';
inkMat.userData.illustrationInk=true;

function family(material) {
  const c=material.color || new THREE.Color(0x859caf);
  let best='steel',distance=Infinity;
  for(const [name,hex] of Object.entries(SOURCE)) {
    const p=new THREE.Color(hex),d=(p.r-c.r)**2+(p.g-c.g)**2+(p.b-c.b)**2;
    if(d<distance){distance=d;best=name;}
  }
  return best;
}

function paintGeometry(mesh,kind) {
  const g=mesh.geometry.clone();
  if(!g.attributes.normal)g.computeVertexNormals();
  const n=g.attributes.normal,p=g.attributes.position;
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const v=new THREE.Vector3(),uv=new Float32Array(p.count*2);
  for(let i=0;i<p.count;i++) {
    v.fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix);
    const light=THREE.MathUtils.clamp(.40+.54*v.dot(KEY),0,1);
    uv[i*2]=light;uv[i*2+1]=.5;
  }
  g.deleteAttribute('color');g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  return g;
}

function outlineGeometry(mesh,width) {
  const g=mesh.geometry.clone(),p=g.attributes.position,n=g.attributes.normal;
  if(!n)return null;
  const worldScale=mesh.getWorldScale(new THREE.Vector3());
  // Average normals at shared positions to avoid cracks at UV/smoothing seams.
  const groups=new Map(),keys=[];
  for(let i=0;i<p.count;i++) {
    const k=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
    keys.push(k);if(!groups.has(k))groups.set(k,new THREE.Vector3());
    groups.get(k).add(new THREE.Vector3().fromBufferAttribute(n,i));
  }
  for(const v of groups.values())v.normalize();
  const offsets=[];
  for(let i=0;i<p.count;i++) {
    const v=groups.get(keys[i]);
    const d=new THREE.Vector3(v.x/Math.max(.001,Math.abs(worldScale.x)),v.y/Math.max(.001,Math.abs(worldScale.y)),v.z/Math.max(.001,Math.abs(worldScale.z))).multiplyScalar(width);
    offsets.push(d);p.setXYZ(i,p.getX(i)+d.x,p.getY(i)+d.y,p.getZ(i)+d.z);
    n.setXYZ(i,-n.getX(i),-n.getY(i),-n.getZ(i));
  }
  if(!g.morphTargetsRelative)for(const a of g.morphAttributes.position||[])for(let i=0;i<a.count;i++) {
    const d=offsets[i];a.setXYZ(i,a.getX(i)+d.x,a.getY(i)+d.y,a.getZ(i)+d.z);
  }
  const indices=g.index?Array.from(g.index.array):Array.from({length:p.count},(_,i)=>i);
  for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  g.setIndex(indices);g.deleteAttribute('color');g.deleteAttribute('uv');g.computeBoundingSphere();
  return g;
}

function makeInk(mesh,geom) {
  const o=mesh.isSkinnedMesh?new THREE.SkinnedMesh(geom,inkMat):new THREE.Mesh(geom,inkMat);
  o.name=mesh.name+'_Ink';o.position.copy(mesh.position);o.quaternion.copy(mesh.quaternion);o.scale.copy(mesh.scale);
  if(mesh.isSkinnedMesh){o.bindMode=mesh.bindMode;o.bind(mesh.skeleton,mesh.bindMatrix);}
  o.frustumCulled=false;o.userData.illustrationInk=true;
  if(mesh.morphTargetInfluences)o.morphTargetInfluences=mesh.morphTargetInfluences;
  mesh.parent.add(o);
  return o;
}

export class Illustration {
  constructor(viewer) {
    this.viewer=viewer;this.records=new Map();this.enabled=true;this.ink=true;
    this.stage=viewer.scene.children.filter(o=>o.isMesh);
    this.background=viewer.scene.background;
    this.prepare(viewer.state.ch.root);
    this.apply();
  }
  prepare(root) {
    root.updateMatrixWorld(true);
    root.traverse(m=>{if(m.isMesh&&m.material.userData?.illustrationInk){m.material.toneMapped=false;m.material.fog=false;}});
    const list=[];root.traverse(m=>{if(m.isMesh&&!m.userData.illustrationInk&&!this.records.has(m))list.push(m);});
    for(const m of list) {
      // A reloaded illustrated GLB already contains its portable paint and ink.
      if(m.material.userData.illustrated){m.material.toneMapped=false;m.material.fog=false;this.records.set(m,{imported:true});continue;}
      if(Array.isArray(m.material))continue;
      const kind=family(m.material),painted=paintGeometry(m,kind);
      const material=new THREE.MeshBasicMaterial({color:0xffffff,map:paintedRamp(kind),side:m.material.side,toneMapped:false,fog:false});
      material.name='Painted_'+kind;material.userData.illustrated=true;
      const decorative=/Engrav|Ridge|Inlay|Breather|Rivet|Stone|Eye_Slit|Finger_Plate|Crest_Stone/.test(m.name);
      const bounds=new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position);
      const size=bounds.getSize(new THREE.Vector3()).multiply(m.getWorldScale(new THREE.Vector3()));
      const width=decorative?.0012:Math.min(.005,Math.max(.0018,Math.max(size.x,size.y,size.z)*.016));
      // A zero-thickness, double-sided cape cannot use an inverted hull: the
      // hull would cover its back face. Its authored gold perimeter supplies ink.
      const hull=/^Knight_Mantle_\d+$/.test(m.name)?null:outlineGeometry(m,width);
      const ink=hull?makeInk(m,hull):null;
      this.records.set(m,{geometry:m.geometry,material:m.material,painted,paintMaterial:material,ink});
    }
  }
  apply() {
    this.viewer.state.ch?.root.traverse(o=>{if(o.userData.illustrationInk)o.visible=this.enabled&&this.ink;});
    for(const [mesh,r] of this.records) {
      if(r.imported)continue;
      mesh.geometry=this.enabled?r.painted:r.geometry;
      mesh.material=this.enabled?r.paintMaterial:r.material;
      if(r.ink)r.ink.visible=this.enabled&&this.ink&&mesh.visible;
    }
    for(const o of this.stage)o.visible=!this.enabled;
    this.viewer.renderer.shadowMap.enabled=!this.enabled;
    this.viewer.scene.background=this.enabled?new THREE.Color(0x101a28):this.background;
  }
  update() {
    if(this.lastRoot!==this.viewer.state.ch?.root){
      if(this.lastRoot)this.release(this.lastRoot);
      this.lastRoot=this.viewer.state.ch?.root;
      if(this.lastRoot){
        this.prepare(this.lastRoot);this.apply();
        const original=document.getElementById('artOriginal');
        if(original){original.disabled=Array.from(this.records.values()).some(r=>r.imported);original.title=original.disabled?'Reload the playground to compare the original materials.':'';}
      }
    }
    if(this.lastProp!==this.viewer.state.clipProp){
      if(this.lastProp)this.release(this.lastProp);
      this.lastProp=this.viewer.state.clipProp;
      if(this.lastProp){this.prepare(this.lastProp);this.apply();}
    }
    for(const [mesh,r] of this.records)if(r.ink){
      r.ink.visible=this.enabled&&this.ink&&mesh.visible;
      if(mesh.morphTargetInfluences)r.ink.morphTargetInfluences=mesh.morphTargetInfluences;
    }
  }
  release(root){
    for(const [m,r] of this.records){
      let p=m;while(p&&p!==root)p=p.parent;
      if(!p)continue;
      if(!r.imported){r.painted.dispose();r.paintMaterial.dispose();if(r.ink){r.ink.geometry.dispose();r.ink.removeFromParent();}}
      this.records.delete(m);
    }
  }
  exportTracks(clips) {
    return clips.map(clip=>{
      const c=clip.clone();
      for(const track of clip.tracks)if(track.name.includes('.morphTargetInfluences')){
        const target=track.name.split('.')[0];
        const entry=Array.from(this.records).find(([m,r])=>m.name===target&&r.ink);
        if(entry){const t=track.clone();t.name=t.name.replace(target,entry[1].ink.name);c.tracks.push(t);}
      }
      return c;
    });
  }
}
