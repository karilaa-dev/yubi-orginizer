/** Both covers have a flat key-facing surface at the common seating plane. */
export const TRAY_LID_STYLES = {
  regular: { panel: 2.4 },
  minimal: { panel: 1.2 },
} as const;
export const LID_RIBS = { width: 1.2, height: 1.2, pitch: 40, rim: 3.7 } as const;

export const trayLidScad = `
function tray_lid_panel(style)=style=="minimal"?${TRAY_LID_STYLES.minimal.panel}:${TRAY_LID_STYLES.regular.panel};
module tray_lid_plate(w,d,style="regular") {
  p=tray_lid_panel(style);
  slab(w,d,p,4);
  if(style=="minimal") {
    translate([0,0,p-eps]) linear_extrude(${LID_RIBS.height}+eps) {
      tray_ring_2d(w,d,0,${LID_RIBS.rim});
      intersection() {
        rr(w,d,4);
        union() {
          nx=max(1,ceil(w/${LID_RIBS.pitch}));
          ny=max(1,ceil(d/${LID_RIBS.pitch}));
          if(nx>1) for(i=[1:nx-1]) translate([-w/2+i*w/nx,0]) square([${LID_RIBS.width},d],center=true);
          if(ny>1) for(i=[1:ny-1]) translate([0,-d/2+i*d/ny]) square([w,${LID_RIBS.width}],center=true);
        }
      }
    }
  }
}
// The flat inside face prints on the bed. Grooves retain the tray's sloped
// roofs. Ribs stay on the exterior and never add headroom above the keys.
module inventory_tray_lid_minimal(w,d,s="",requested=6,percent=undef,angle=undef) {
  difference() {
    tray_lid_plate(w,d,"minimal");
    tray_stack_sockets(w,d);
    if(len(s)>0) translate([0,0,${TRAY_LID_STYLES.minimal.panel}-.35]) linear_extrude(2)
      lid_text(s,w,d,requested,percent,angle);
  }
}
module inventory_tray_lid_minimal_percent(w,d,s="",percent=100,angle=0) {
  inventory_tray_lid_minimal(w,d,s,percent=percent,angle=angle);
}
`;
