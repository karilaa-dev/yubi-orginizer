import pryProfile from './profiles/c-nano-pry-7b.scad?raw';

/** The approved 7B coupon, in the centred flat-pocket coordinate system.
 * Different tray heights translate the entire pocket in Z; never scale it. */
export const CN_FLAT_PRY = {
  angleDegrees: 20,
  clearance: 0.2,
  baselineTop: 8.6,
  bodyFloorDepth: 6.6,
  noseRadius: 7,
  noseCenterY: 7.4,
  gripStartY: 1.4,
  rearHalfWidth: 7,
  rearExtent: 7.65, // measured 7B relief reaches Y=-7.6461134
  labelEdgeDatum: 7.65,
} as const;

/** Flat C Nano cradle. The thick body and thinner USB-C shell share a centre
 * plane. Upright calibrated USB-C sockets and body-pocket outlines are unchanged. */
export const CN_FLAT_SUPPORT = {
  bodyThickness: 7,
  connectorThickness: 2.4,
  connectorFloorDepth: 4.3, // 7 - 0.4 protrusion - (7 - 2.4) / 2
  ledgeStartY: -1, // clear of the body shoulder at -1.583 mm
  gripStartY: 1.4, // retain 2.4 mm of ledge beneath the connector root
  gripFloorDepth: CN_FLAT_PRY.bodyFloorDepth,
  gripHalfWidth: CN_FLAT_PRY.noseRadius,
} as const;

export const cNanoSupportScad = `
${pryProfile}
module cn_flat_support(top) {
  translate([0,-pocket_l("CN")/2,0]) intersection() {
    linear_extrude(top-${CN_FLAT_SUPPORT.connectorFloorDepth}) polygon(body_pts("CN"));
    translate([-5,pocket_l("CN")/2+${CN_FLAT_SUPPORT.ledgeStartY},top-pocket_d("CN")-eps])
      cube([10,pocket_l("CN"),${(7 - 2.4) / 2}+eps]);
  }
}
// Frozen union of the 0..20 degree swept body, opened upward for extraction.
// Its small 0.20 mm allowance is the approved 7B sample, with no rear bowl.
module cn_flat_pry_relief(top) {
  translate([0,0,top-${CN_FLAT_PRY.baselineTop}]) cn_pry_7b_profile();
}
// The USB-C-side scoop is exactly the one accepted in the 7B coupon. Its cut
// starts beyond the supported connector root and reaches the body floor.
module cn_connector_grip(top) {
  intersection() {
    translate([0,${CN_FLAT_PRY.noseCenterY},top-${CN_FLAT_PRY.bodyFloorDepth}])
      cylinder(r=${CN_FLAT_PRY.noseRadius},h=${CN_FLAT_PRY.bodyFloorDepth}+.15,$fn=96);
    translate([-20,${CN_FLAT_PRY.gripStartY},top-${CN_FLAT_PRY.bodyFloorDepth}])
      cube([40,30,${CN_FLAT_PRY.bodyFloorDepth}+.15]);
  }
}
`;
