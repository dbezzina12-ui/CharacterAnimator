// The code reaper's clips, with foot IK targets lifted to this skeleton's ankle height.
import { CLIPS as BASE } from '../../reaper/src/clips.js';
const DY = -52 - (-24);
function patch(clip) {
  const tracks = {};
  for (const [k, keys] of Object.entries(clip.tracks)) tracks[k] = k.startsWith('ik:foot') ? keys.map(([t, v, e]) => [t, { ...v, y: v.y + DY }, e]) : keys;
  return { ...clip, tracks };
}
export const CLIPS = Object.fromEntries(Object.entries(BASE).map(([k, c]) => [k, patch(c)]));
export const CLIP_LIST = Object.keys(CLIPS);
