# Art brief — Base-Dwarf

You are painting the parts of a 2D game character that is animated as a cut-out rig in Spine 4.2.
The attached paint sheet (2400×1600 px) shows every part in its own box on a flat #ff00ff background.

## Rules
1. Keep every part inside its box, at the same position, size and angle as the placeholder. The boxes are cut out by position, so a part that drifts into another box or across the gap is lost.
2. The character faces RIGHT in a three-quarter view. "near" parts are on the viewer's side; "far" parts are on the other side and are usually a little darker.
3. Paint each part complete, including the area hidden under its neighbour. Joints overlap: the top of a forearm continues under the upper arm, the top of a thigh continues under the trousers, the neck continues under the head.
4. Keep the background flat #ff00ff (or fully transparent). No shadows, glow or texture on the background, and do not paint over the labels.
5. Return one image with the same aspect ratio (3:2) and the same layout. Do not add, remove, mirror or rearrange parts.

## Hands (the part that most often goes wrong)
- Both hands are CLOSED FISTS seen from the side, knuckles pointing along the forearm, with an empty channel through the fist where a weapon shaft passes.
- hand-near is one piece: the back of the hand and fingers, drawn in front of the weapon.
- The far hand is two pieces: hand-far-back is the palm (drawn behind the weapon); hand-far-front is the four fingers and thumb (drawn in front of it). Together they wrap the shaft.
- Do not paint open hands, pointing fingers or a hand at a different angle. The rig rotates the fist to match the weapon.

## Parts
- head: 140×147 units — whole head with hair and open eyes; hats, beards and horns can extend past the box edge a little
- torso: 164×179 units — chest, belly, neck and the cap of the near shoulder
- pelvis: 127×82 units — hips; both thighs tuck into it
- upper-near: 63×125 units — near upper arm, shoulder to elbow
- forearm-near: 53×113 units — near forearm, elbow to wrist
- hand-near: 67×65 units — near fist, one piece
- upper-far: 63×127 units — far upper arm
- forearm-far: 59×112 units — far forearm
- hand-far-back: 59×63 units — far fist: palm only
- hand-far-front: 60×52 units — far fist: fingers and thumb only
- thigh-near: 69×129 units — near thigh, hip to knee
- shin-near: 72×114 units — near shin, knee to ankle
- foot-near: 109×50 units — near foot, flat on the ground, toe to the right
- thigh-far: 71×129 units — far thigh
- shin-far: 61×115 units — far shin
- foot-far: 106×52 units — far foot
- eyes-closed: 53×18 units — only the closed eyelids, to cover the open eyes during a blink
- gun: 124×90 units — barrel pointing right; the fist closes around the grip
- muzzle-flash: 91×100 units — flash pointing right, bright on transparent
- cape: 173×280 units — hangs straight down from the shoulders; the rig bends and sways it
- staff: 50×521 units — upright; the hands hold it between the two dark bands

## This character
Name: Dwarf. Height 468 units (3.3 heads tall). No cape (the cape part can stay as it is).

## Changing the body shape instead of the art
The shape is a small JSON object. Edit the numbers and paste it into the Character Kit app (Export → Character settings → Apply), or save it as a file and run `node spine-base/generator/build.mjs --config file.json --out outdir`.
```json
{
 "name": "Dwarf",
 "height": 468,
 "head": 0.3,
 "headWidth": 0.94,
 "legs": 0.3675,
 "arms": 0.327,
 "shoulders": 0.245,
 "build": 1.9,
 "hands": 0.107,
 "stance": 0.09,
 "cape": false
}
```
height is in units (1 unit = 2 px at export). Everything else is a ratio: head = head height ÷ height, headWidth = head width ÷ head height, legs = hip height ÷ height, arms = shoulder-to-wrist ÷ height, shoulders = shoulder span ÷ height, build = thickness (1 = average adult, about 1.9 = stocky dwarf), hands = fist length ÷ height, stance = half the gap between the ankles ÷ height, cape = true or false.
