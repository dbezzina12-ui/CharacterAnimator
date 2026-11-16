// Skeletons for the two illustrated outlaws, in cutout PIXEL coordinates (x right, y down).
// bone: [name, parent, headX, headY, tailX, tailY, influenceRadius]
// Weights are computed from the distance of every mesh vertex to each bone segment, so bones only
// need to sit roughly on the drawing. Idle motion is small, so overlapping parts (arms over coat)
// can share one mesh without tearing.
export const RANGER = {
  name: 'ranger', image: 'assets/ranger.png', width: 550, height: 1002,
  glow: { color: '#ff7a1a' },
  eyes: null,                                              // no blink (the eyes stay as painted)
  lights: [{ at: [245, 165], size: 22, color: '#ff8a2a' }, { at: [330, 165], size: 22, color: '#ff8a2a' }],   // respirator filter discs
  bones: [
    ['root', null, 280, 1000, 280, 940, 60],
    ['pelvis', 'root', 280, 560, 280, 480, 110],
    ['spine', 'pelvis', 280, 480, 280, 380, 120],
    ['chest', 'spine', 280, 380, 280, 250, 140],
    ['neck', 'chest', 280, 230, 280, 190, 60],
    ['head', 'neck', 280, 190, 280, 60, 120],
    ['hair', 'head', 280, 60, 280, 10, 70],
    ['scarf', 'neck', 280, 200, 280, 260, 70],
    ['shoulder_L', 'chest', 250, 250, 150, 250, 70],
    ['upperarm_L', 'shoulder_L', 150, 250, 95, 420, 70],
    ['forearm_L', 'upperarm_L', 95, 420, 85, 600, 60],
    ['hand_L', 'forearm_L', 85, 600, 95, 690, 55],
    ['shoulder_R', 'chest', 310, 250, 420, 250, 70],
    ['upperarm_R', 'shoulder_R', 420, 250, 470, 420, 70],
    ['forearm_R', 'upperarm_R', 470, 420, 480, 600, 60],
    ['hand_R', 'forearm_R', 480, 600, 470, 690, 55],
    ['thigh_L', 'pelvis', 235, 580, 215, 800, 80],
    ['shin_L', 'thigh_L', 215, 800, 210, 1000, 70],
    ['thigh_R', 'pelvis', 330, 580, 345, 800, 80],
    ['shin_R', 'thigh_R', 345, 800, 350, 1000, 70],
    ['coat_L1', 'pelvis', 175, 560, 150, 760, 110],
    ['coat_L2', 'coat_L1', 150, 760, 120, 990, 130],
    ['coat_R1', 'pelvis', 395, 560, 420, 760, 110],
    ['coat_R2', 'coat_R1', 420, 760, 450, 990, 130],
  ],
};
export const GUNSLINGER = {
  name: 'gunslinger', image: 'assets/gunslinger.png', width: 557, height: 995,
  glow: { color: '#2fb8b0' },
  eyes: null,
  lights: [{ at: [252, 108], size: 26, color: '#7af6ff' }, { at: [310, 108], size: 26, color: '#7af6ff' }, { at: [497, 571], size: 18, color: '#7af6ff' }, { at: [107, 706], size: 14, color: '#7af6ff' }, { at: [472, 706], size: 14, color: '#7af6ff' }],
  bones: [
    ['root', null, 250, 995, 250, 940, 60],
    ['pelvis', 'root', 250, 560, 250, 480, 110],
    ['spine', 'pelvis', 250, 480, 250, 380, 120],
    ['chest', 'spine', 250, 380, 250, 250, 140],
    ['neck', 'chest', 250, 235, 250, 195, 60],
    ['head', 'neck', 250, 195, 250, 80, 110],
    ['hat', 'head', 250, 80, 250, 10, 160],
    ['scarf', 'neck', 250, 210, 250, 300, 80],
    ['shoulder_L', 'chest', 220, 250, 120, 250, 70],
    ['upperarm_L', 'shoulder_L', 120, 250, 70, 420, 70],
    ['forearm_L', 'upperarm_L', 70, 420, 60, 600, 60],
    ['hand_L', 'forearm_L', 60, 600, 70, 690, 55],
    ['shoulder_R', 'chest', 280, 250, 385, 250, 70],
    ['upperarm_R', 'shoulder_R', 385, 250, 430, 420, 70],
    ['forearm_R', 'upperarm_R', 430, 420, 440, 600, 60],
    ['hand_R', 'forearm_R', 440, 600, 435, 690, 55],
    ['thigh_L', 'pelvis', 205, 580, 185, 800, 80],
    ['shin_L', 'thigh_L', 185, 800, 180, 990, 70],
    ['thigh_R', 'pelvis', 300, 580, 320, 800, 80],
    ['shin_R', 'thigh_R', 320, 800, 325, 990, 70],
    ['coat_L1', 'pelvis', 140, 560, 110, 760, 110],
    ['coat_L2', 'coat_L1', 110, 760, 60, 985, 130],
    ['coat_R1', 'pelvis', 370, 560, 400, 760, 110],
    ['coat_R2', 'coat_R1', 400, 760, 455, 985, 130],
  ],
};
