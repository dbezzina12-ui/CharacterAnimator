"""Bake portable basis poses using CharacterAnimator's existing IK and joint helpers."""
import json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from cbase.params import resolve
from cbase.skeleton import build_skeleton,socket_defs,DRIVERS
from cbase.poses import Rig,Pose,rx,ry,rz,quat_from_matrix,curl_fingers
from cbase.library import reach,pelvis_offset,plant_legs,raise_arm
from cbase.clips import socket_matrix
ROOT=Path(__file__).resolve().parents[1]
rig=Rig(build_skeleton(resolve()))
socks=socket_defs(rig.sk)
clips=[]
for name,n in [('hover_sword_vigil',150),('knight_salute',120)]:
 frames=[]
 for f in range(n+1):
  t=2*np.pi*f/n;p=Pose()
  if name=='hover_sword_vigil':
   lift=.34+.026*np.sin(t)
   p.loc['pelvis']=pelvis_offset(rig,[.007*np.sin(t),.004*np.sin(t),lift])
   p.rot['spine_02']=rx(2+1*np.sin(t));p.rot['chest']=ry(1.5*np.sin(t));p.rot['head']=rx(8+1.2*np.sin(t))
   for sd,sx in [('L',1),('R',-1)]:
    p.rot[f'thigh_{sd}']=rx(12+(2 if sd=='L' else 0)+2*np.sin(t))
    p.rot[f'shin_{sd}']=rx(26+(5 if sd=='L' else 0)+2*np.sin(t))
    p.rot[f'foot_{sd}']=rx(-25);p.rot[f'toe_{sd}']=rx(-8)
    reach(rig,p,sd,np.array([sx*.23+.007*np.sin(t),-.325+.004*np.sin(t),1.13+lift]),np.array([sx*.7,.25,-1]),np.array([0,0,1]),np.array([0,-1,0]),clav=6)
    curl_fingers(p,sd,.10,thumb=.20)
  else:
   ease=np.sin(np.pi*min(1,f/28)/2)**2 if f<28 else (np.cos(np.pi*min(1,(f-82)/38)/2)**2 if f>82 else 1)
   p.rot['head']=rx(12*ease)
   raise_arm(rig,p,'L',-35,clavicle_share=0);p.rot['forearm_L']=rx(12);curl_fingers(p,'L',.2,thumb=.2)
   rest=rig.rest['hand_R'][:3,3]
   tgt=rest*(1-ease)+np.array([.035,-.245,1.27])*ease
   palm=np.array([0,1,0]);fingers=np.array([.35,0,1]);
   reach(rig,p,'R',tgt,np.array([-.7,.15,-1]),palm,fingers,clav=4*ease)
   curl_fingers(p,'R',.65*ease+.15,thumb=.6*ease)
   plant_legs(rig,p)
  frames.append(p)
 out={'name':name,'duration':n/30,'times':[round(f/30,6) for f in range(n+1)],'rotations':{},'positions':{}}
 for bn in rig.order:
  quats=[];prev=None
  for p in frames:
   q=quat_from_matrix(rig.driven_rotation(p,bn) if bn in DRIVERS else p.rot.get(bn,np.eye(3)))
   if prev is not None and np.dot(prev,q)<0:q=-q
   prev=q;quats.extend([round(float(q[1]),7),round(float(q[2]),7),round(float(q[3]),7),round(float(q[0]),7)])
  out['rotations'][bn]=quats
 for bn in ['root','pelvis']:
  out['positions'][bn]=[round(float(v),7) for p in frames for v in p.loc.get(bn,np.zeros(3))]
 if name=='hover_sword_vigil':
  p=frames[0];W=rig.fk(p)
  S=W['hand_R']@np.linalg.inv(rig.rest['hand_R'])@socket_matrix(socks['socket_hand_R_prop'])
  # Sword +Y points horizontally across both open palms; its wide face lies flat.
  P=np.eye(4);P[:3,:3]=np.array([[0,1,0],[-.8660254,0,-.5],[-.5,0,.8660254]]);P[:3,3]=[-.325,-.40,1.493]
  rel=np.linalg.inv(S)@P
  out['propTransform']=rel.tolist()
  # Track socket and sword contact geometry; the entire assembly shares a slow bob.
  out['supportNote']='Blade supported on open palms; right socket carries the sword with a fixed local offset.'
 clips.append(out)
(ROOT/'characters/aureate_knight/knight-motion.json').write_text(json.dumps(clips,separators=(',',':')))
print('Baked',[(x['name'],x['duration']) for x in clips])
