import * as THREE from 'three';

// Fitted armor in the master rig's bind space. Every piece follows an existing
// anatomical bone; there is no second skeleton or screen-space character.
const V = (a) => new THREE.Vector3(...a);
const Y = new THREE.Vector3(0, 1, 0);
export function dressKnight(ch, recipes) {
  ch.resetPose();
  const mats = {
    steel: new THREE.MeshStandardMaterial({ color: 0x859caf, metalness: .86, roughness: .29 }),
    light: new THREE.MeshStandardMaterial({ color: 0xcbd7df, metalness: .8, roughness: .24 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x152230, metalness: .65, roughness: .48 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a650, metalness: .82, roughness: .28 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x171b27, metalness: .05, roughness: .84 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x252652, metalness: .03, roughness: .93, side: THREE.DoubleSide }),
    lining: new THREE.MeshStandardMaterial({ color: 0x655c87, metalness: .08, roughness: .82, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: 0x030b13, roughness: .55, metalness: .3 }),
    jewel: new THREE.MeshStandardMaterial({ color: 0x5bb7ca, metalness: .45, roughness: .15, emissive: 0x1a647b, emissiveIntensity: .4 }),
  };
  for (const [name, mesh] of Object.entries(ch.parts)) {
    mesh.material = (name.startsWith('Hand') ? mats.dark : mats.leather).clone();
    ch.originalMaterials[name] = mesh.material;
    mesh.castShadow = mesh.receiveShadow = true;
  }
  ch.parts.Head.removeFromParent(); delete ch.parts.Head; delete ch.originalMaterials.Head;
  let serial = 0;
  function mount(geo, mat, bone, name, pos, scale, q) {
    const m = new THREE.Mesh(geo, mats[mat] || mat);
    m.name = `Knight_${name}_${++serial}`;
    if (pos) m.position.copy(V(pos));
    if (scale) m.scale.copy(V(scale));
    if (q) m.quaternion.copy(q);
    m.castShadow = true; m.receiveShadow = true;
    ch.root.add(m); ch.root.updateMatrixWorld(true); ch.bones[bone].attach(m);
    return m;
  }
  function ell(name, bone, p, size, mat = 'steel', segments = 24) {
    return mount(new THREE.SphereGeometry(1, segments, 14), mat, bone, name, p, size);
  }
  function path(name, bone, pts, r = .003, mat = 'gold', closed = false) {
    if(name.startsWith('Chest_')) pts=pts.map(p=>[p[0],p[1],chestSurface(p[0],p[1])]);
    const c = new THREE.CatmullRomCurve3(pts.map(V), closed, 'centripetal');
    return mount(new THREE.TubeGeometry(c, Math.max(16, pts.length * 8), r, 6, closed), mat, bone, name);
  }
  function plate(name, bone, xy, z, depth, mat = 'steel', bevel = .006) {
    const s = new THREE.Shape(xy.map(([x,y]) => new THREE.Vector2(x,y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 2, curveSegments: 2, steps: 1 });
    return mount(g, mat, bone, name, [0, 0, z]);
  }
  function ring(name, bone, cy, rx, rz, z0 = 0, r = .004, mat = 'gold') {
    return path(name,bone,Array.from({length:32},(_,i)=>{const a=i/32*Math.PI*2;return [rx*Math.sin(a),cy,z0+rz*Math.cos(a)];}),r,mat,true);
  }
  function shell(name, bone, rows, mat='steel', segments=32) {
    const p=[], ids=[];
    rows.forEach(([y,rx,rz,z0=0],j)=>{for(let i=0;i<=segments;i++){let a=i/segments*Math.PI*2;p.push(rx*Math.sin(a),y,z0+rz*Math.cos(a));if(j&&i){const k=j*(segments+1)+i;ids.push(k,k-1,k-segments-1,k-1,k-segments-2,k-segments-1);}}});
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ids);g.computeVertexNormals();
    return mount(g,mat,bone,name);
  }
  function segment(name,bone,a,b,r0,r1,mat='steel',squash=1) {
    const d=V(b).sub(V(a)),q=new THREE.Quaternion().setFromUnitVectors(Y,d.clone().normalize());
    return mount(new THREE.CylinderGeometry(r1,r0,d.length(),16,1,false),mat,bone,name,V(a).addScaledVector(d,.5).toArray(),[1,1,squash],q);
  }
  function star(name,bone,x,y,z,r,mat='gold') {
    const pts=Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;const rr=i%2?r*.28:r*(i%4===0?1:.65);return [x+Math.sin(a)*rr,y+Math.cos(a)*rr];});
    return plate(name,bone,pts,z,.004,mat,.001);
  }
  function rivet(name,bone,p,r=.006){ell(name,bone,p,[r,r,r*.65],'gold',10);}

  const cuirassRows=[[1.105,.151,.128,.003],[1.17,.172,.141,.003],[1.28,.209,.155,.003],[1.355,.194,.137,.003],[1.398,.105,.10,0]];
  function chestSurface(x,y){let a=cuirassRows[0],b=cuirassRows[1];for(let i=1;i<cuirassRows.length;i++)if(y>=cuirassRows[i-1][0]){a=cuirassRows[i-1];b=cuirassRows[i];}const t=Math.max(0,Math.min(1,(y-a[0])/(b[0]-a[0]))),rx=a[1]+(b[1]-a[1])*t,rz=a[2]+(b[2]-a[2])*t;return .008+rz*Math.sqrt(Math.max(.05,1-(x/rx)**2));}
  // Cuirass: layered curved steel with raised seams and a sunstone insignia.
  shell('Cuirass','chest',cuirassRows);
  ring('Waist_Rim','chest',1.11,.153,.131,.003,.006);
  ring('Gorget','chest',1.399,.106,.09,0,.009);
  shell('Neck_Guard','chest',[[1.378,.108,.09],[1.437,.086,.079],[1.461,.077,.071]],'dark');
  ring('Collar_Rim','chest',1.444,.087,.079,0,.0045);
  path('Chest_Center','chest',[[0,1.38,.100],[0,1.31,.151],[0,1.20,.124],[0,1.113,.099]],.004);
  for(const sx of [-1,1]) {
    path('Chest_Engraving','chest',[[sx*.087,1.387,.09],[sx*.148,1.34,.103],[sx*.152,1.272,.105],[sx*.105,1.212,.123],[sx*.02,1.178,.122]],.003);
    path('Chest_Engraving_Inner','chest',[[sx*.09,1.365,.111],[sx*.125,1.328,.129],[sx*.115,1.282,.139]],.0015,'light');
    for(let i=0;i<3;i++)rivet('Cuirass_Rivet','chest',[sx*(.155-i*.009),1.32-i*.035,chestSurface(sx*(.155-i*.009),1.32-i*.035)],.004);
  }
  star('Solar_Crest','chest',0,1.301,.168,.055);
  ell('Crest_Stone','chest',[0,1.301,.180],[.015,.021,.008],'jewel',12);
  for(let i=0;i<3;i++) {
    const y=1.075-i*.041;
    shell('Abdominal_Lame','spine_01',[[y-.02,.148-i*.002,.127],[y+.025,.152-i*.003,.126]],i%2?'dark':'steel');
    ring('Abdominal_Inlay','spine_01',y-.013,.15-i*.002,.13,0,.003);
  }
  shell('Belt','pelvis',[[.947,.174,.139],[.989,.173,.139]],'leather');
  ring('Belt_Top','pelvis',.988,.175,.142,0,.003);
  ring('Belt_Bottom','pelvis',.948,.176,.142,0,.003);
  plate('Buckle','pelvis',[[-.029,.944],[.029,.944],[.034,.99],[-.034,.99]],.145,.013,'gold',.003);
  star('Buckle_Star','pelvis',0,.968,.166,.017,'dark');

  // Closed armet, swept brow and narrow luminous visor.
  shell('Helmet','head',[[1.475,.068,.073],[1.52,.096,.103],[1.59,.114,.124],[1.68,.117,.126],[1.741,.091,.102],[1.783,.04,.047],[1.791,.004,.004]],'steel');
  plate('Visor_Shadow','head',[[-.097,1.652],[.097,1.652],[.088,1.607],[0,1.589],[-.088,1.607]],.118,.008,'black',.003);
  for(const sx of [-1,1]) {
    plate('Eye_Slit','head',[[sx*.014,1.628],[sx*.087,1.643],[sx*.083,1.631],[sx*.02,1.618]],.131,.002,'jewel',.0005);
    path('Brow_Trim','head',[[0,1.655,.141],[sx*.061,1.666,.137],[sx*.108,1.663,.103]],.0045);
    plate('Visor_Cheek','head',[[sx*.008,1.614],[sx*.095,1.62],[sx*.083,1.537],[sx*.014,1.51]],.113,.018,'light',.005);
    for(let j=0;j<4;j++)path('Breather','head',[[sx*(.028+j*.014),1.572+j*.004,.140],[sx*(.028+j*.014),1.548+j*.004,.14]],.002,'black');
    rivet('Visor_Hinge','head',[sx*.113,1.64,.035],.012);
  }
  plate('Nasal_Guard','head',[[-.008,1.665],[.008,1.665],[.014,1.524],[0,1.505],[-.014,1.524]],.14,.009,'gold',.002);
  path('Helmet_Crown','head',[[0,1.647,-.131],[0,1.746,-.095],[0,1.805,0],[0,1.764,.085],[0,1.67,.139]],.008,'gold');
  for(const sx of [-1,1])path('Helmet_Etching','head',[[sx*.07,1.681,.11],[sx*.078,1.717,.08],[sx*.055,1.756,.061]],.0018,'gold');
  // Sculpted crest ribbons, rather than a single featureless cone.
  for(let i=0;i<7;i++) {
    const z=-.018-i*.031;
    const pts=[[-.015,1.787,z],[0,1.85+Math.sin(i/7*Math.PI)*.052,z-.015],[.015,1.81,z-.045],[0,1.76,z-.10]];
    path('Indigo_Crest','head',pts,.016,i%2?'cloth':'lining');
  }

  // Arm/leg plates stay rigid; dark articulated joints keep every bend readable.
  for(const [side,sx] of [['L',1],['R',-1]]) {
    const bonePos=n=>ch.bones[n].getWorldPosition(new THREE.Vector3());
    const sh=bonePos('upperarm_'+side),el=bonePos('forearm_'+side),wr=bonePos('hand_'+side);
    const hip=bonePos('thigh_'+side),knee=bonePos('shin_'+side),ank=bonePos('foot_'+side);
    const mix=(a,b,t)=>a.clone().lerp(b,t).toArray();
    const upper='upperarm_'+side,fore='forearm_'+side,thigh='thigh_'+side,shin='shin_'+side;
    
    for(let i=0;i<3;i++) {
      ell('Pauldron_Lame',upper,[sh.x+sx*(.018+i*.044),sh.y+.026-i*.046,sh.z+.009],[.137-i*.015,.092-i*.02,.145-i*.008],i===0?'light':'steel');
      path('Pauldron_Inlay',upper,Array.from({length:16},(_,j)=>{const a=Math.PI*.1+j/15*Math.PI*.8;return [sh.x+sx*(.024+i*.035+.095*Math.cos(a)),sh.y+.035-i*.028+.05*Math.sin(a),sh.z+.151-i*.007];}),.004);
    }
    star('Pauldron_Seal',upper,sh.x+sx*.035,sh.y+.035,sh.z+.158,.029);
    segment('Rerebrace',upper,mix(sh,el,.26),mix(sh,el,.82),.076,.060,'steel',1.06);
    segment('UpperArm_Band',upper,mix(sh,el,.70),mix(sh,el,.77),.064,.063,'gold',1.08);
    ell('Elbow_Couter',fore,[el.x,el.y,el.z+.024],[.067,.065,.065],'light');
    ell('Elbow_Rivet',fore,[el.x,el.y,el.z+.084],[.011,.011,.007],'gold');
    segment('Vambrace',fore,mix(el,wr,.16),mix(el,wr,.91),.068,.046,'steel',1.1);
    segment('Vambrace_Cuff',fore,mix(el,wr,.78),mix(el,wr,.96),.053,.054,'gold');
    path('Vambrace_Ridge',fore,[mix(el,wr,.22),mix(el,wr,.53),mix(el,wr,.84)].map(p=>[p[0],p[1],p[2]+.057]),.004);
    // Joint-by-joint knuckle caps: the original rig still moves every finger.
    for(const finger of ['thumb','index','middle','ring','pinky'])for(let j=1;j<=3;j++) {
      const bn=`${finger}_${String(j).padStart(2,'0')}_${side}`;
      const b=ch.bones[bn];if(!b)continue;
      const p=b.getWorldPosition(new THREE.Vector3());
      const next=b.children.find(c=>c.isBone);
      const end=next?next.getWorldPosition(new THREE.Vector3()):p.clone().add(new THREE.Vector3(0,.018,0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())));
      segment('Finger_Plate',bn,mix(p,end,.08),mix(p,end,.65),finger==='thumb'?.012:.0095,finger==='thumb'?.010:.008,'steel');
    }
    segment('Cuisse',thigh,mix(hip,knee,.17),mix(hip,knee,.89),.091,.074,'steel',1.2);
    segment('Thigh_Inlay',thigh,mix(hip,knee,.74),mix(hip,knee,.79),.079,.078,'gold',1.2);
    ell('Knee_Poleyn',shin,[knee.x,knee.y,knee.z+.039],[.087,.069,.056],'light');
    star('Knee_Seal',shin,knee.x,knee.y,knee.z+.098,.03);
    segment('Greave',shin,mix(knee,ank,.13),mix(knee,ank,.94),.076,.051,'steel',1.1);
    path('Greave_Ridge',shin,[mix(knee,ank,.18),mix(knee,ank,.54),mix(knee,ank,.90)].map(p=>[p[0],p[1],p[2]+.073]),.005);
    segment('Ankle_Rim',shin,mix(knee,ank,.86),mix(knee,ank,.94),.057,.055,'gold',1.1);
    for(let j=0;j<4;j++)ell('Sabatons','foot_'+side,[ank.x+sx*.006, .045+j*.007,ank.z+.028+j*.034],[.062-j*.002,.046-j*.003,.072-j*.006],j%2?'steel':'light');
    // Three short tassets over indigo cloth, allowing the thigh to swing beneath.
    for(let j=0;j<3;j++) {
      const yy=.92-j*.052;
      plate('Tasset',thigh,[[sx*.023,yy+.018],[sx*.166,yy+.018],[sx*.151,yy-.049],[sx*.032,yy-.065]],.132,.012,'steel',.004);
      path('Tasset_Edge',thigh,[[sx*.029,yy-.055,.15],[sx*.09,yy-.06,.15],[sx*.15,yy-.045,.15]],.003);
    }
  }

  // Tailored split tabard and a draped mantle. Real geometry, included in export.
  for(const sx of [-1,1]) {
    plate('Tabard',sx>0?'thigh_L':'thigh_R',[[sx*.01,.94],[sx*.071,.94],[sx*.084,.64],[sx*.019,.585]],.163,.002,'cloth',.002);
    path('Tabard_Embroidery',sx>0?'thigh_L':'thigh_R',[[sx*.022,.912,.17],[sx*.03,.67,.17],[sx*.069,.685,.17]],.002);
  }
  const cp=[],ci=[],uN=28,vN=24;
  for(let j=0;j<=vN;j++)for(let i=0;i<=uN;i++) {
    const u=i/uN*2-1,v=j/vN,wide=.19+.08*Math.sin(v*Math.PI*.7);
    cp.push(u*wide,1.397-.64*v-.025*Math.cos(u*Math.PI*2)*v, -.109-.055*v-.024*Math.cos(u*Math.PI*4)*(.3+v));
    if(i&&j){let k=j*(uN+1)+i;ci.push(k,k-uN-1,k-1,k-1,k-uN-1,k-uN-2);}
  }
  const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(cp,3));cg.setIndex(ci);cg.computeVertexNormals();
  cg.morphAttributes.position=[0,1].map(phase=>{
    const values=cp.slice();
    for(let j=0;j<=vN;j++)for(let i=0;i<=uN;i++){
      const k=(j*(uN+1)+i)*3,v=j/vN,u=i/uN;
      values[k+2]+=.026*v*v*Math.sin(u*Math.PI)*Math.sin(u*Math.PI*3+v*2+phase*Math.PI/2);
      values[k+1]+=.007*v*v*Math.sin(u*Math.PI)*Math.cos(u*Math.PI*4+phase*Math.PI/2);
    }
    return new THREE.Float32BufferAttribute(values,3);
  });
  const mantle=mount(cg,'cloth','chest','Mantle');
  mantle.updateMorphTargets();
  for(const sx of [-1,1])path('Mantle_Border','chest',Array.from({length:18},(_,j)=>{let v=j/17;return [sx*(.19+.08*Math.sin(v*Math.PI*.7)),1.397-.64*v-.025*v,-.109-.055*v-.024*(.3+v)];}),.004);
  for(const sx of [-1,1])ell('Mantle_Clasp','chest',[sx*.128,1.373,.098],[.016,.016,.008],'gold');

  // Basis animation is multiplied by the exact rest quaternion used by this rig.
  for(const recipe of recipes) {
    const tracks=[];
    for(const [name,values] of Object.entries(recipe.rotations)) {
      const out=[];for(let i=0;i<values.length;i+=4){const q=ch.rest[name].q.clone().multiply(new THREE.Quaternion().fromArray(values,i));out.push(...q.toArray());}
      tracks.push(new THREE.QuaternionKeyframeTrack(name+'.quaternion',recipe.times,out));
    }
    for(const [name,values] of Object.entries(recipe.positions)) {
      const out=[];for(let i=0;i<values.length;i+=3)out.push(...ch.rest[name].p.clone().add(new THREE.Vector3().fromArray(values,i)).toArray());
      tracks.push(new THREE.VectorKeyframeTrack(name+'.position',recipe.times,out));
    }
    ch.clips.push(new THREE.AnimationClip(recipe.name,recipe.duration,tracks));
  }
  for(const clip of ch.clips){
    const times=Array.from({length:31},(_,i)=>clip.duration*i/30);
    for(let phase=0;phase<2;phase++)clip.tracks.push(new THREE.NumberKeyframeTrack(
      mantle.name+'.morphTargetInfluences['+phase+']', times,
      times.map(t=>.5+.5*Math.sin(2*Math.PI*t/clip.duration+phase*Math.PI/2))));
  }
  ch.root.updateMatrixWorld(true);
  return { armorPieces: serial };
}

export function knightSword() {
  const group=new THREE.Group();group.name='Sword2H';
  const steel=new THREE.MeshStandardMaterial({color:0xc7d7e2,metalness:.91,roughness:.2});
  const edge=new THREE.MeshStandardMaterial({color:0xebf0ee,metalness:.95,roughness:.15});
  const gold=new THREE.MeshStandardMaterial({color:0xd7a957,metalness:.85,roughness:.25});
  const grip=new THREE.MeshStandardMaterial({color:0x171d35,roughness:.76});
  const gem=new THREE.MeshStandardMaterial({color:0x5aaed1,metalness:.45,roughness:.14,emissive:0x135972,emissiveIntensity:.5});
  const add=(g,m,p=[0,0,0],s=null)=>{const o=new THREE.Mesh(g,m);o.position.copy(V(p));if(s)o.scale.copy(V(s));o.castShadow=true;group.add(o);return o;};
  add(new THREE.CylinderGeometry(.016,.016,.25,16),grip,[0,-.065,0]);
  for(let i=0;i<12;i++)add(new THREE.TorusGeometry(.0164,.0016,5,16),gold,[0,-.18+i*.020,0]).rotation.x=Math.PI/2;
  add(new THREE.SphereGeometry(.027,16,12),gold,[0,-.212,0],[1,1.3,.8]);
  add(new THREE.OctahedronGeometry(.018,0),gem,[0,-.214,.019],[1,1,.5]);
  const guard=new THREE.CatmullRomCurve3([V([-.15,.041,0]),V([-.09,.079,0]),V([0,.067,0]),V([.09,.079,0]),V([.15,.041,0])]);
  add(new THREE.TubeGeometry(guard,32,.014,8,false),gold);
  add(new THREE.OctahedronGeometry(.028),gold,[0,.074,0],[1.1,1,.7]);
  add(new THREE.OctahedronGeometry(.015),gem,[0,.074,.023],[1,1,.5]);
  const positions=[],ids=[];
  const rows=[[.088,.038],[.20,.034],[.27,.042],[.81,.027],[.98,0]];
  rows.forEach(([y,w],j)=>{positions.push(-w,y,0,0,y,.012,w,y,0,0,y,-.012);if(j)for(let k=0;k<4;k++){let a=j*4+k,b=j*4+(k+1)%4;ids.push(a,b,a-4,b,b-4,a-4);}});
  // Blade faces must point outwards; otherwise an expanded ink hull hides them.
  for(let i=0;i<ids.length;i+=3)[ids[i+1],ids[i+2]]=[ids[i+2],ids[i+1]];
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(ids);g.computeVertexNormals();add(g,steel);
  for(const sx of [-1,1]){
    const line=rows.map(([y,w])=>V([sx*w,y,0]));add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line),32,.0019,5),edge);
  }
  for(let i=0;i<6;i++){
    const y=.27+i*.073;
    const c=new THREE.CatmullRomCurve3([V([-.008,y+.013,.013]),V([0,y,.014]),V([.008,y+.013,.013])]);
    add(new THREE.TubeGeometry(c,4,.0014,4),gold);
  }
  return group;
}
