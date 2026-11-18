// Painted renderer: the skeleton overlay comes from the code reaper; drawPose needs a loaded puppet.
export { drawSkeleton } from '../../reaper/src/renderer.js';
import { drawPose as drawPainted } from './puppet.js';
let current = null;
export function setPuppet(p) { current = p; }
export function drawPose(ctx, pose, view, hidden) { if (!current) throw new Error('painted renderer: call setPuppet() first'); drawPainted(ctx, pose, current, view, hidden); }
