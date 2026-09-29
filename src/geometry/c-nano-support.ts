/** Flat C Nano cradle. The thick body and thinner USB-C shell share a centre
 * plane. Upright calibrated USB-C sockets and XY pocket outlines are unchanged. */
export const CN_FLAT_SUPPORT = {
  bodyThickness: 7,
  connectorThickness: 2.4,
  connectorFloorDepth: 4.3, // 7 - 0.4 protrusion - (7 - 2.4) / 2
  ledgeStartY: -1, // clear of the body shoulder at -1.583 mm
  gripStartY: 1.4, // retain 2.4 mm of ledge beneath the connector root
  gripFloorDepth: 5.3, // 1 mm of nail/finger clearance below the connector tip
  gripHalfWidth: 6, // stay inside the side retainers, which start at X=6.35
} as const;

export const cNanoSupportScad = `
module cn_flat_support(top) {
  translate([0,-pocket_l("CN")/2,0]) intersection() {
    linear_extrude(top-${CN_FLAT_SUPPORT.connectorFloorDepth}) polygon(body_pts("CN"));
    translate([-5,pocket_l("CN")/2+${CN_FLAT_SUPPORT.ledgeStartY},top-pocket_d("CN")-eps])
      cube([10,pocket_l("CN"),${(7 - 2.4) / 2}+eps]);
  }
}
// The normal 2.5 mm scoop exposes only 0.6 mm of the C Nano's metal shell.
// Open the tip down to 1 mm below the shell, keeping its root supported at the
// original height. Clip the deeper cut inside the retention arms and the
// existing circular scoop so row spacing and the pocket footprint stay valid.
module cn_connector_grip(top,r) {
  intersection() {
    translate([0,pocket_l("CN")/2,top-${CN_FLAT_SUPPORT.gripFloorDepth}])
      cylinder(r=r,h=${CN_FLAT_SUPPORT.gripFloorDepth}+.15);
    translate([-${CN_FLAT_SUPPORT.gripHalfWidth},${CN_FLAT_SUPPORT.gripStartY},top-${CN_FLAT_SUPPORT.gripFloorDepth}])
      cube([${CN_FLAT_SUPPORT.gripHalfWidth * 2},pocket_l("CN")+r,${CN_FLAT_SUPPORT.gripFloorDepth}+.15]);
  }
}
`;
