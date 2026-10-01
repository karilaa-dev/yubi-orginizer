/**
 * H20/V7 mating contract from the supplied two-pin reference.
 * Local mating geometry lives in connectors/h20-v7.scad. Units are mm.
 * Production layout reserves 13 mm at receiver edges and 5 mm at plain edges.
 */
import type { TraySlideDirection } from '../types';
import { traySlideDirection } from '../tray-slide';
import { TRAY_STACK } from './tray-stack';
import connectorScad from './connectors/h20-v7.scad?raw';

export const H20_V7 = Object.freeze({
  id: 'h20_slide_v7' as const,
  pinCount: 2 as const,
  guideCount: 2 as const,
  margin: 13,
  edgeMargin: 5,
  minimumWidth: 40,
  minimumDepth: 28,
  lidThickness: 7.8, // exterior rim/housings; the key-facing panel starts at Z=0
  lidWall: 1.6,
  travel: 6,
  pinLength: 4,
  pinNeckWidth: 3.6,
  pinRootRadius: 0.8,
  pinHeight: 4.2,
  headWidth: 5.8,
  gripWidth: 5.6,
  totalInterference: 0.2,
  gripProfileG: -0.1,
  pinEndRelief: 0.4,
  guideLength: 8 as const,
  guideWidth: 6,
  guideHeight: 3,
  guideRootRadius: 0.6,
  guideTopChamfer: 0.35,
  guideSideGapPerSide: 0.15,
  guideStopGap: 0,
  pinPocketRoofZ: 6.2,
  guidePocketRoofZ: 6.15,
  referenceRoofCover: 2.2,
} as const);

export type H20Point = readonly [number, number];
export type H20Guide = readonly [number, number, 8];
export interface H20V7Stations {
  readonly pins: readonly [H20Point, H20Point];
  readonly guides: readonly [H20Guide, H20Guide];
}

/** Deterministic centred-footprint datums. Storage stays outside the reserved border. */
export function h20V7Stations(width: number, depth: number, direction: TraySlideDirection = 'left'): H20V7Stations {
  const angle = traySlideDirection(direction).angle;
  if (angle % 180) [width, depth] = [depth, width];
  const rotate = ([x, y]: H20Point): H20Point => angle === 90 ? [-y, x] : angle === 180 ? [-x, -y] : angle === 270 ? [y, -x] : [x, y];
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width < 40 || depth < 28) {
    throw new RangeError('H20/V7 station layout requires at least 40 mm along the slide and 28 mm across it; storage may require more.');
  }
  const y0 = -depth / 2 + 7;
  const y1 = depth / 2 - 7;
  const pinX = -width / 2 + 14;
  const guideX = width / 2 - 8;
  return {
    pins: [rotate([pinX, y0]), rotate([pinX, y1])],
    guides: [[...rotate([guideX, y0]), 8], [...rotate([guideX, y1]), 8]],
  };
}

/** The app must BUILD solid lands up to this plane, not just translate pins. */
export function h20V7SeatZ(bodyHeight: number, actualGap: number): number {
  if (!Number.isFinite(bodyHeight) || bodyHeight < 8.4 ||
      !Number.isFinite(actualGap) || actualGap < 0) {
    throw new RangeError('H20/V7 requires finite body height ≥ 8.4 mm and gap ≥ 0; local webs still need validation.');
  }
  return bodyHeight + actualGap;
}

// Connector dimensions are intentionally independent of the global fit offsets.
export const trayH20Scad = `${connectorScad}
function h20_frame_size(w,d,direction)=direction%180==0?[w,d]:[d,w];
function h20_pins(w,d)=[[-w/2+14,-d/2+7],[-w/2+14,d/2-7]];
function h20_guides(w,d)=[[w/2-8,-d/2+7,8],[w/2-8,d/2-7,8]];
module h20_lands(w,d,h,gap) {
  // A continuous flat rim closes the headroom gap on every side without
  // adding a tongue above the bearing plane that would obstruct the slide.
  translate([0,0,h-eps]) linear_extrude(gap+eps)
    tray_ring_2d(w,d,0,${TRAY_STACK.rimWidth});
  // Local pads support each filleted root. No full-width solid bearing bands.
  // Pin pads overlap the 2.7 mm outside rim by 0.7 mm, just like the guides.
  for(p=h20_pins(w,d)) translate([p[0]-4.2,p[1]-5,h-eps])
    cube([8.4,10,gap+eps]);
  for(g=h20_guides(w,d)) translate([g[0]-6,g[1]-5,h-eps])
    cube([12,10,gap+eps]);
}
module inventory_tray_h20(ks,ls,xy,w,d,h=8.6,scoop_r=6,label_width=23,retention=true,stackable=true,side_text="",support_xy=[],label_scale=1,has_lid=false,direction=0,side_text_percent=undef) {
  gap=tray_stack_gap(retention);
  frame=h20_frame_size(w,d,direction);
  union() {
    difference() {
      union() {
        inventory_tray(ks,ls,xy,w,d,h,scoop_r,label_width,retention,false,side_text,[],label_scale,false,side_text_percent);
        rotate([0,0,direction]) h20_lands(frame[0],frame[1],h,gap);
        tray_stack_pillars(support_xy,h,gap);
      }
      rotate([0,0,direction]) yo_v7_bottom_cuts(h20_pins(frame[0],frame[1]),h20_guides(frame[0],frame[1]));
    }
    rotate([0,0,direction]) yo_v7_top(h20_pins(frame[0],frame[1]),h20_guides(frame[0],frame[1]),h+gap);
  }
}
// A continuous rounded bezel hides the individual receiver housings. Its
// inner wall slopes out at 45 degrees; all extra material is above the panel.
module h20_lid_bezel(w,d) {
  outer=[[2.39,0],[6.8,0],[7.3,.134],[7.666,.5],[7.8,1]];
  inner=[[2.38,13.6,8],[3.3,13.6,8],[7.8,9.1,12.5],[8.8,9.1,12.5]];
  difference() {
    union() for(i=[0:len(outer)-2]) hull() for(j=[i,i+1])
      translate([0,0,outer[j][0]-.01]) linear_extrude(.01)
        rr(w-2*outer[j][1],d-2*outer[j][1],4-outer[j][1]);
    union() for(i=[0:len(inner)-2]) hull() for(j=[i,i+1])
      let(iw=w-2*inner[j][1],id=d-2*inner[j][1])
      translate([0,0,inner[j][0]]) linear_extrude(.01)
        rr(iw,id,min(inner[j][2],min(iw,id)/2-.01));
  }
}
// Thumb wells provide a ledge to push against in either direction. The three
// shallow transverse grooves add traction. Keep them between the receivers,
// never over their sloped roofs, even on the smallest supported footprint.
module h20_lid_grip_cuts(w,d) {
  span=min(24,d-28);
  if(span>=8) for(side=[-1,1]) translate([side*(w/2-5.4),0,0]) {
    translate([0,0,6.5]) linear_extrude(2) rr(6,span,2.6);
    for(x=[-1.6,0,1.6]) translate([x,0,6.15])
      linear_extrude(.36) rr(.8,span-4,.35);
  }
}
module h20_lid_assembled(w,d,s="",requested=6,percent=undef,angle=undef,direction=0,style="regular") {
  t=${H20_V7.lidThickness};
  frame=h20_frame_size(w,d,direction);
  difference() {
    union() {
      // Both variants close at the same Z=0 plane as an upper tray. The
      // required connector height is outside, never empty headroom over keys.
      tray_lid_plate(w,d,style);
      if(style=="regular") h20_lid_bezel(w,d);
      intersection() {
        slab(w,d,t,4);
        rotate([0,0,direction]) {
          for(p=h20_pins(frame[0],frame[1])) translate([p[0],p[1],0])
            yo_v7_rect_loft([[0,-10.65,5.05,-5.55,5.55],[3.3,-10.65,5.05,-5.55,5.55],[t,-10.65,5.05,-1.6,1.6]]);
          for(g=h20_guides(frame[0],frame[1])) translate([g[0],g[1],0])
            yo_v7_rect_loft([[0,-12.65,6.4,-5.55,5.55],[3.3,-12.65,6.4,-5.55,5.55],[t,-12.65,6.4,-1.6,1.6]]);
        }
      }
    }
    // Full sloped roofs allow printing with the flat key-facing surface down.
    rotate([0,0,direction]) yo_v7_bottom_cuts(h20_pins(frame[0],frame[1]),h20_guides(frame[0],frame[1]));
    if(style=="regular") rotate([0,0,direction]) h20_lid_grip_cuts(frame[0],frame[1]);
    // Keep engraving inside the receiver border. It cuts through exterior
    // ribs but leaves at least 0.85 mm of the continuous lightweight skin.
    if(len(s)>0) translate([0,0,tray_lid_panel(style)-.35]) linear_extrude(t)
      lid_text(s,w-(style=="regular"?22:14),d-(style=="regular"?22:14),requested,percent,angle);
  }
}
module inventory_tray_h20_lid(w,d,s="",requested=6,percent=undef,angle=undef,direction=0,style="regular") {
  h20_lid_assembled(w,d,s,requested,percent,angle,direction,style);
}
module inventory_tray_h20_lid_legacy(w,d,s="",requested=6,direction=0,style="regular") {
  inventory_tray_h20_lid(w,d,s,requested,direction=direction,style=style);
}
module inventory_tray_h20_lid_percent(w,d,s="",percent=100,angle=0,direction=0,style="regular") {
  inventory_tray_h20_lid(w,d,s,percent=percent,angle=angle,direction=direction,style=style);
}
module tray_h20_coupon() {
  $fn=96;
  yo_v7_apply(h20_pins(40,28),h20_guides(40,28),8.4) difference() {
    slab(40,28,8.4,2);
    // Original reference arrow: slide left to lock.
    translate([-20,-14,8]) linear_extrude(.42)
      polygon([[23.5,14],[26,12.5],[26,13.4],[30.5,13.4],[30.5,14.6],[26,14.6],[26,15.5]]);
  }
}
`;
