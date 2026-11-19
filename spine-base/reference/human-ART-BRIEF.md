# Art brief — Base-Human

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
- head: 107×130 units — whole head with hair and open eyes; hats, beards and horns can extend past the box edge a little
- torso: 142×231 units — chest, belly, neck and the cap of the near shoulder
- pelvis: 108×97 units — hips; both thighs tuck into it
- upper-near: 54×157 units — near upper arm, shoulder to elbow
- forearm-near: 49×142 units — near forearm, elbow to wrist
- hand-near: 60×57 units — near fist, one piece
- upper-far: 51×159 units — far upper arm
- forearm-far: 55×141 units — far forearm
- hand-far-back: 51×56 units — far fist: palm only
- hand-far-front: 52×47 units — far fist: fingers and thumb only
- thigh-near: 59×217 units — near thigh, hip to knee
- shin-near: 85×202 units — near shin, knee to ankle
- foot-near: 118×63 units — near foot, flat on the ground, toe to the right
- thigh-far: 68×217 units — far thigh
- shin-far: 53×204 units — far shin
- foot-far: 115×65 units — far foot
- eyes-closed: 42×17 units — only the closed eyelids, to cover the open eyes during a blink
- gun: 109×79 units — barrel pointing right; the fist closes around the grip
- muzzle-flash: 81×88 units — flash pointing right, bright on transparent
- cape: 177×500 units — hangs straight down from the shoulders; the rig bends and sways it
- staff: 50×792 units — upright; the hands hold it between the two dark bands

## This character
Name: Human. Height 722 units (5.8 heads tall). No cape (the cape part can stay as it is).

## Changing the body shape instead of the art
The shape is a small JSON object. Edit the numbers and paste it into the Character Kit app (Export → Character settings → Apply), or save it as a file and run `node spine-base/generator/build.mjs --config file.json --out outdir`.
```json
{
 "name": "Human",
 "height": 722,
 "head": 0.172,
 "headWidth": 0.8,
 "legs": 0.5235,
 "arms": 0.313,
 "shoulders": 0.14,
 "build": 1,
 "hands": 0.061,
 "stance": 0.061,
 "cape": false
}
```
height is in units (1 unit = 2 px at export). Everything else is a ratio: head = head height ÷ height, headWidth = head width ÷ head height, legs = hip height ÷ height, arms = shoulder-to-wrist ÷ height, shoulders = shoulder span ÷ height, build = thickness (1 = average adult, about 1.9 = stocky dwarf), hands = fist length ÷ height, stance = half the gap between the ankles ÷ height, cape = true or false.
