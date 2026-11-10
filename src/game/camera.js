// game/camera.js — puts the chase camera behind and above the runner, rolled so the runner's lane
// is always at the bottom of the screen. World space handed to cam3d is the TUBE FRAME:
//   origin on the tube axis at the runner's depth, x right, y up, +z ahead, angle 0 = bottom lane.
import { APOTHEM, GEAR_FOV } from './config.js';
import { lerp, clamp } from '../engine/math.js';

export const CAM_BACK = 8;       // metres behind the runner
export const CAM_UP = 2.4;       // metres above the lane surface (toward the axis)

// kick: { fov (degrees added), back (metres pulled back), dip (metres), curveX, curveY } — all optional
export function setupCamera(cam, frame, kick) {
  const g = clamp(frame.gearF, 1, 5), gi = Math.floor(g), gf = g - gi;
  const fovDeg = lerp(GEAR_FOV[gi], GEAR_FOV[Math.min(5, gi + 1)], gf) + (kick && kick.fov ? kick.fov : 0);
  cam.fov = (fovDeg * Math.PI) / 180;
  const r = APOTHEM - CAM_UP + (kick && kick.dip ? kick.dip : 0);   // distance below the axis, in the rolled frame
  cam.roll = frame.roll;
  cam.x = Math.sin(frame.roll) * r;
  cam.y = -Math.cos(frame.roll) * r;
  cam.z = -(CAM_BACK + (kick && kick.back ? kick.back : 0));
  cam.yaw = 0; cam.pitch = 0;
  cam.cx = 0.5; cam.cy = 0.5;
  // the tunnel snakes on a slow LFO (pure view-space bend, so lane logic never notices)
  const sway = frame.time * 0.21;
  cam.curveX = (kick && kick.curveX !== undefined ? kick.curveX : Math.sin(sway) * 1.1e-4 + Math.sin(sway * 2.3 + 1.7) * 0.5e-4);
  cam.curveY = (kick && kick.curveY !== undefined ? kick.curveY : Math.sin(sway * 0.7 + 0.6) * 0.7e-4);
  cam.near = 0.5;
  cam.fogStart = 40; cam.fogEnd = 620; cam.fogPow = 1.6;
  cam.widthScale = 1;
  cam.begin();
}
