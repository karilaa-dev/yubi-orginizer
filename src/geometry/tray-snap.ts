import { TRAY_STACK } from './tray-stack';

// Solid, frame-supported catch blocks. The continuous mating skirt supplies
// compliance; the catches are not individually cut-out cantilever leaves.
const skirt = 2.4, clearance = .4, catchThickness = 3, guideGap = .6, guideThickness = 1.2;
const catchOuter = skirt + clearance, guideOuter = catchOuter + catchThickness + guideGap;
const receiverInner = guideOuter + guideThickness + clearance;
const skirtDepth = 8, roofBridge = .4;
const receiverTop = skirtDepth + (receiverInner - skirt - roofBridge) / 2;
const channelDepth = 2, web = 2;
export const TRAY_SNAP = {
  gap: TRAY_STACK.compactGap,
  minimumHeight: receiverTop + channelDepth + web,
  lidThickness: receiverTop + web + .4,
  captureHeight: 4, catchWidth: 8, catchThickness, catchOuter,
  engagement: .2, clearance, skirtThickness: skirt, skirtDepth,
  guideOuter, guideThickness, guideHeight: 1.2, channelDepth,
  receiverInner, receiverTop, roofBridge, web, cornerCenterInset: receiverInner + .6,
  hookCenter: 1.4, recessDepth: .7, recessFlatBottom: .9, recessFlatTop: 1.9,
  margin: receiverInner + web, minimumDepth: 42,
  couponWidth: 42, couponDepth: 60,
  couponHeight: receiverTop + channelDepth + web,
} as const;

export const TRAY_SNAP_ENGAGEMENTS = [.1, .2, .3] as const;
export function traySnapStations(depth: number): number[] { const center = (depth - 2 * TRAY_SNAP.cornerCenterInset) / 4; return [-center, center]; }

/** Clearance demand at the mating wall, not a force/strain simulation.
 * Both profiles are piecewise linear, so their breakpoints bound the demand. */
export function traySnapRequiredSpread(lift: number, engagement: number = TRAY_SNAP.engagement): number {
  const s = TRAY_SNAP, projection = s.clearance + engagement;
  if (lift < 0 || lift >= s.captureHeight) return 0;
  const hook = (z: number) => s.catchOuter - Math.max(0, projection - Math.abs(z - s.hookCenter));
  const recess = (z: number) => Math.max(0, Math.min(s.recessDepth,
    z - (s.recessFlatBottom - s.recessDepth), s.recessFlatTop + s.recessDepth - z));
  const levels = [lift, s.captureHeight, s.hookCenter - projection, s.hookCenter, s.hookCenter + projection,
    ...[s.recessFlatBottom - s.recessDepth, s.recessFlatBottom, s.recessFlatTop, s.recessFlatTop + s.recessDepth].map(z => z + lift)]
    .filter(z => z >= lift && z <= s.captureHeight);
  return Math.max(0, ...levels.map(z => s.skirtThickness - recess(z - lift) - hook(z)));
}

export const traySnapScad = `
module tsnap_xz(y,l) { translate([0,y+l,0]) rotate([90,0,0]) linear_extrude(l) children(); }
module tsnap_side(side) { if(side==1) mirror([1,0,0]) children(); else children(); }
module tsnap_sides(w) { for(s=[-1,1]) translate([s*w/2,0,0]) tsnap_side(s) children(); }
module tsnap_stations(w,d) { tsnap_sides(w) for(y=[-(d-2*${TRAY_SNAP.cornerCenterInset})/4,(d-2*${TRAY_SNAP.cornerCenterInset})/4]) translate([0,y,0]) children(); }
module tsnap_outline(w,d,inset) { rr(w-2*inset,d-2*inset,inset==0?4:max(.6,${TRAY_SNAP.cornerCenterInset}-inset)); }
module tsnap_ring(w,d,outer,inner) {
  difference() { tsnap_outline(w,d,outer); tsnap_outline(w,d,inner); }
}

// The full perimeter channel separates the receiver skirt from the key deck.
// Its roof closes at 45 degrees onto a 0.4 mm bridge, rather than a wide ceiling.
module tray_snap_sockets(w,d) {
  translate([0,0,-eps]) linear_extrude(${skirtDepth}+eps)
    tsnap_ring(w,d,${skirt},${receiverInner});
  difference() {
    hull() {
      translate([0,0,${skirtDepth}-eps]) linear_extrude(eps) tsnap_outline(w,d,${skirt});
      translate([0,0,${receiverTop}-eps]) linear_extrude(eps) tsnap_outline(w,d,${(skirt + receiverInner - roofBridge) / 2});
    }
    hull() {
      translate([0,0,${skirtDepth}-2*eps]) linear_extrude(eps) tsnap_outline(w,d,${receiverInner});
      translate([0,0,${receiverTop}+eps]) linear_extrude(eps) tsnap_outline(w,d,${(skirt + receiverInner + roofBridge) / 2});
    }
  }
  tsnap_stations(w,d) tsnap_xz(-${(TRAY_SNAP.catchWidth + 2 * clearance) / 2},${TRAY_SNAP.catchWidth + 2 * clearance})
    polygon([[${skirt+.02},.18],[${skirt-TRAY_SNAP.recessDepth},${TRAY_SNAP.recessFlatBottom}],
      [${skirt-TRAY_SNAP.recessDepth},${TRAY_SNAP.recessFlatTop}],[${skirt+.02},2.62]]);
}

module tray_snap_body_relief(w,d,h,gap=${TRAY_SNAP.gap}) {
  translate([0,0,h-${channelDepth}]) linear_extrude(${channelDepth}+gap+${TRAY_SNAP.captureHeight}+.1)
    tsnap_ring(w,d,${skirt},${guideOuter});
}

// Reinstate the entire 3 x 8 mm base in the perimeter channel. The wide block
// is backed by the tray's solid web, with 45-degree insertion AND return faces.
module tray_snap_catches(w,d,h,gap=${TRAY_SNAP.gap},engagement=${TRAY_SNAP.engagement}) {
  projection=${clearance}+engagement;
  tsnap_stations(w,d) tsnap_xz(-${TRAY_SNAP.catchWidth / 2},${TRAY_SNAP.catchWidth})
    polygon([[${catchOuter},h-${channelDepth}-.02],
      [${catchOuter + catchThickness},h-${channelDepth}-.02],
      [${catchOuter + catchThickness},h+gap+${TRAY_SNAP.captureHeight}],
      [${catchOuter},h+gap+${TRAY_SNAP.captureHeight}],
      [${catchOuter},h+gap+${TRAY_SNAP.hookCenter}+projection],
      [${catchOuter}-projection,h+gap+${TRAY_SNAP.hookCenter}],
      [${catchOuter},h+gap+${TRAY_SNAP.hookCenter}-projection]]);
}
module tray_snap_rim(w,d,h,gap=${TRAY_SNAP.gap}) {
  // Broad outside bearing land carries the stack; the inner rim locates it.
  translate([0,0,h-eps]) linear_extrude(gap+eps) tsnap_ring(w,d,0,${skirt});
  translate([0,0,h-eps]) linear_extrude(gap+${TRAY_SNAP.guideHeight}-.2+eps)
    tsnap_ring(w,d,${guideOuter},${guideOuter + guideThickness});
  translate([0,0,h+gap+${TRAY_SNAP.guideHeight}-.2-eps]) linear_extrude(.2+eps)
    tsnap_ring(w,d,${guideOuter + .2},${guideOuter + guideThickness - .2});
}
module tray_snap_lower(w,d,h,gap=${TRAY_SNAP.gap},engagement=${TRAY_SNAP.engagement}) {
  tray_snap_rim(w,d,h,gap);
  tray_snap_catches(w,d,h,gap,engagement);
}

// Accessible at the seam on the two ends, away from the four latch stations.
// The short 45-degree roof prints without a curved unsupported underside.
module tray_snap_pry_notches(w,d) {
  for(side=[-1,1]) translate([0,side*d/2,0]) rotate([0,0,side==1?-90:90])
    tsnap_xz(-4,8) polygon([[-.1,-.02],[.9,-.02],[.9,.4],[0,1.3],[-.1,1.3]]);
}
module tray_snap_lid(w,d,s="",percent=100,angle=0) {
  difference() {
    slab(w,d,${TRAY_SNAP.lidThickness},4);
    tray_snap_sockets(w,d);
    tray_snap_pry_notches(w,d);
    if(len(s)>0) translate([0,0,${TRAY_SNAP.lidThickness}-.35]) linear_extrude(.36)
      lid_text(s,w,d,6,percent,angle);
  }
}
module tray_snap_lid_legacy(w,d,s="",text_size=6) {
  difference() {
    slab(w,d,${TRAY_SNAP.lidThickness},4);
    tray_snap_sockets(w,d); tray_snap_pry_notches(w,d);
    if(len(s)>0) translate([0,0,${TRAY_SNAP.lidThickness}-.35]) linear_extrude(.36) lid_text(s,w,d,text_size);
  }
}
module tray_snap_coupon_lower(engagement=${TRAY_SNAP.engagement}) {
  w=${TRAY_SNAP.couponWidth}; d=${TRAY_SNAP.couponDepth}; h=${TRAY_SNAP.couponHeight};
  union() {
    difference() {
      slab(w,d,h,4);
      tray_snap_sockets(w,d); tray_snap_body_relief(w,d,h); tray_snap_pry_notches(w,d);
      translate([0,0,2.4]) slab(w-2*${TRAY_SNAP.margin},d-2*${TRAY_SNAP.margin},h,2);
    }
    tray_snap_lower(w,d,h,engagement=engagement);
  }
}
`;
