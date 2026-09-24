/**
 * Provisional 5Ci side-contact envelope, in millimetres. Yubico's current
 * technical datasheet gives a 13 mm overall width, while its store still gives
 * 12 mm. Neither publishes a dimensioned side-contact drawing. The width here
 * conservatively follows the datasheet; the position/length/thickness remain
 * illustrative. See docs/printing.md and physical fit-test
 * feedback before treating these as measured hardware dimensions.
 */
export const CI_SIDE_TOUCH = {
  keyLength: 40.3,
  rawCenterY: 20.35,
  innerHalfWidth: 5.8,
  outerHalfWidth: 6.5,
  length: 3.1,
  thickness: 2.4,
} as const;

/** Inventory-only relief; the original calibrated contours are unchanged. */
export const CI_INVENTORY_TOUCH_RELIEF = {
  centerY: 0,
  innerHalfWidth: 5.8,
  outerHalfWidth: 6.9,
  length: 5.4,
  depth: 3.65,
} as const;

// Kept independent of library.ts so the reference models and inventory cutter
// can share the same contact definition without changing calibrated profiles.
export const ciTouchScad = `
module ci_side_touch_reference() {
  for(side=[-1,1]) translate([side*${(CI_SIDE_TOUCH.innerHalfWidth + CI_SIDE_TOUCH.outerHalfWidth) / 2},${CI_SIDE_TOUCH.rawCenterY},0])
    cube([${CI_SIDE_TOUCH.outerHalfWidth - CI_SIDE_TOUCH.innerHalfWidth},${CI_SIDE_TOUCH.length},${CI_SIDE_TOUCH.thickness}],center=true);
}
// Union the calibrated silhouette with its reflection about the centred
// inventory pocket. Both connector ends get the larger USB-C envelope.
module ci_inventory_reversible_cut(top) {
  for(angle=[0,180]) rotate([0,0,angle]) {
    body_cut("CI",top);
    ci_inventory_touch_relief(top);
  }
}
module ci_inventory_touch_relief(top) {
  for(side=[-1,1]) translate([side*${(CI_INVENTORY_TOUCH_RELIEF.innerHalfWidth + CI_INVENTORY_TOUCH_RELIEF.outerHalfWidth) / 2},${CI_INVENTORY_TOUCH_RELIEF.centerY},top-${CI_INVENTORY_TOUCH_RELIEF.depth / 2}+0.02])
    cube([${CI_INVENTORY_TOUCH_RELIEF.outerHalfWidth - CI_INVENTORY_TOUCH_RELIEF.innerHalfWidth},${CI_INVENTORY_TOUCH_RELIEF.length},${CI_INVENTORY_TOUCH_RELIEF.depth + 0.04}],center=true);
}
`;
