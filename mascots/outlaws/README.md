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

## Perfect loop + game export

`?loop=8` (or the **8 s loop** toggle) switches to `idleLoop()`, where every oscillator is a whole
number of cycles over 8 s: two breaths, one weight shift, one glance, blinks at fixed beats, wind
gusts from loop harmonics. Frame 0 and the frame at 8 s are byte-identical, so it tiles seamlessly.

`node mascots/outlaws/scripts/export-loop.mjs [outDir]` renders each character alone with a fixed
camera (`?export=<name>&loop=8&bg=none`) at 24 fps and writes, per character: `<name>-idle-alpha.webm`
(VP9 with a real alpha channel), `<name>-idle-green.mp4` (the same frames on pure #00FF00 for chroma
keying), and `<name>-idle-png-half-12fps.zip` (true-alpha PNG sequence at half size). Add `&bg=green`
or `&bg=magenta` to the page URL to preview a keying background.
