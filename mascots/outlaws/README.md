# Wasteland Outlaws — idle animation on painted artwork

Two finished illustrations (a ranger in an orange coat and a robotic gunslinger) brought to life
with layered idle motion, without repainting a single frame.

- `assets/segment.py` cuts the characters out of the source image (texture-guided GrabCut: the
  painted hatching is textured, the backdrop gradient is smooth) and writes feathered RGBA cutouts.
- `rigs.js` places a 24-bone skeleton on each cutout in pixel coordinates (spine, head, hair/hat,
  scarf, arms, hands, legs, two-link coat flaps). Vertex weights come from the distance of each mesh
  vertex to the bone segments, so bones only need to sit roughly on the drawing.
- `outlaws.js` builds a Three.js `SkinnedMesh` over each cutout (a grid trimmed to the alpha), and
  `idle()` poses the bones from time alone: a 4.2 s breath (chest swell, shoulders, head), a slow
  weight shift through pelvis and spine, glances, hair and scarf flutter with wind gusts rolling
  down the coat flaps, finger flexes, a mesh-squash blink for the ranger (eyes collapse toward the
  eye line in the vertex shader), pulsing respirator and eye lights, backdrop glow and dust motes.
- `index.html` shows both, with a motion-amount slider, bone and mesh overlays and a pause.

`npm run viewer`, then open `/mascots/outlaws/index.html`.
