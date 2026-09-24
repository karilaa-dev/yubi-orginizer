import profiles from './profiles/profiles.scad?raw';
import usbCSource from './profiles/calibrated_usb_c.scad?raw';
import type { KeyType } from '../types';
import { ciTouchScad } from './ci-touch';
import { TRAY_SNAP, traySnapScad } from './tray-snap';
import { TRAY_STACK } from './tray-stack';
export { TRAY_STACK } from './tray-stack';

// Values are measured at straight, full-thickness body sections of the accepted
// polygons. Nano tabs stay on their thick heads, away from connector blades.
export const TRAY_RETENTION: Record<KeyType, { rawY: number; cavityHalfWidth: number; pocketHalfWidth: number; bodyHalfWidth: number; width: number; pocketLength: number }> = {
  A: { rawY: 22, cavityHalfWidth: 9.3, pocketHalfWidth: 9.3, bodyHalfWidth: 9, width: 2, pocketLength: 45.6 },
  C: { rawY: 22, cavityHalfWidth: 9.3, pocketHalfWidth: 9.3, bodyHalfWidth: 9, width: 2, pocketLength: 45.6 },
  AN: { rawY: 3.3, cavityHalfWidth: 6.35, pocketHalfWidth: 6.35, bodyHalfWidth: 6, width: 1.3, pocketLength: 13.7 },
  CN: { rawY: 2.8, cavityHalfWidth: 6.35001, pocketHalfWidth: 6.35001, bodyHalfWidth: 6, width: 1.3, pocketLength: 10.8 },
  CK: { rawY: 20.5, cavityHalfWidth: 6.30539, pocketHalfWidth: 6.8, bodyHalfWidth: 5.7554, width: 2, pocketLength: 30.6 },
  // The CI outline reaches its extreme at an isolated bridge point. Keep the
  // through slot 0.075mm beyond it to avoid two voids meeting along a zero-width
  // vertical edge. The accepted body cutter remains completely unchanged.
  CI: { rawY: 13.1, cavityHalfWidth: 6.36825, pocketHalfWidth: 6.55699, bodyHalfWidth: 5.51825, width: 2, pocketLength: 41.6 },
};
export const TRAY_FLEX = { length: 12, rootThickness: 1, tipThickness: 0.8, rootFillet: 0.5, sideRelief: 0.5, endRelief: 0.6, outerExtent: 2, capture: 0.2 } as const;

export const TRAY_STACK_PILLAR = { diameter: 3, clearance: 0.6, minSeparation: 90, spanPerSupport: 180, maxCount: 6 } as const;
export const TRAY_LID = { thickness: 2.4, engravingDepth: 0.35, notchDepth: 0.8, notchHeight: 1.2, notchRadius: 4, textInset: 6, textVerticalBudget: 1.7 } as const;
export const KEY_LABEL_LAYOUT = { baseSize: 2.7, baseHalfHeight: 2.2, baseEdgeOffset: 3 } as const;

/** Includes both mirrored arms, their through relief, and their rounded roots.
 * Coordinates share the centred pocket datum used by body_cut(). */
export function trayRetentionBounds(type: KeyType) {
  const spec = TRAY_RETENTION[type];
  const start = spec.rawY - spec.width / 2 - spec.pocketLength / 2;
  const extent = spec.pocketHalfWidth + TRAY_FLEX.outerExtent;
  return { minX: -extent, maxX: extent, minY: start - TRAY_FLEX.endRelief, maxY: start + TRAY_FLEX.length };
}
const retentionData = (['A', 'C', 'AN', 'CN', 'CK', 'CI'] as const).map((type) => {
  const s = TRAY_RETENTION[type];
  return [s.rawY, s.pocketHalfWidth, s.bodyHalfWidth, s.width];
});

// Keep the calibrated contours and socket modules unchanged.
// Demo placements are excluded if appended to the socket source.
export const calibratedLibrary = `${profiles}\n${usbCSource.split('// Examples, separated for preview:')[0]}`;

export const library = `${calibratedLibrary}
${ciTouchScad}
${traySnapScad}
eps=0.025;
function key_l(k)=k=="A"||k=="C"?45:k=="AN"?13:k=="CN"?10.1:k=="CK"?29.5:40.3;
function key_t(k)=k=="A"?3.7:k=="C"?3.75:k=="AN"?3.1:k=="CN"?7:5;
function pocket_l(k)=k=="A"||k=="C"?45.6:k=="AN"?13.7:k=="CN"?10.8:k=="CK"?30.6:41.6;
function pocket_d(k)=key_t(k)-0.4;
function socket_d(k)=k=="A"?8.5:k=="AN"?5:k=="CN"?4.2:6.6;
function key_label_edge_offset(label_scale=1)=${KEY_LABEL_LAYOUT.baseEdgeOffset}+${KEY_LABEL_LAYOUT.baseHalfHeight}*(label_scale-1);
function upright_label_distance(k,label_scale=1)=max(2,key_t(k)/2)+key_label_edge_offset(label_scale);
function flat_label_distance(k,label_scale=1)=pocket_l(k)/2+key_label_edge_offset(label_scale);
retention_data=${JSON.stringify(retentionData)};
function retention_spec(k)=retention_data[k=="A"?0:k=="C"?1:k=="AN"?2:k=="CN"?3:k=="CK"?4:5];
function tray_stack_gap(retention=true)=retention?${TRAY_STACK.gap}:${TRAY_STACK.compactGap};
function tray_stack_pitch(h,retention=true)=h+tray_stack_gap(retention);
module rr(w,l,r) { offset(r=r) square([w-2*r,l-2*r],center=true); }
module slab(w,l,h,r=4) { linear_extrude(h) rr(w,l,min(r,min(w,l)/4)); }
module a_socket(k,d) {
  profile=k=="A"?plug_A:plug_AN;
  union() {
    linear_extrude(d-0.20) polygon(profile);
    translate([0,0,d-0.20]) hull() {
      linear_extrude(0.01) polygon(profile);
      translate([0,0,0.19]) linear_extrude(0.01) offset(delta=0.05) polygon(profile);
    }
  }
}
module socket_cut(k,top) {
  translate([0,0,top-socket_d(k)]) {
    if(k=="A"||k=="AN") a_socket(k,socket_d(k));
    else if(k=="CN") yubikey_c_nano_cutter();
    else yubikey_standard_usb_c_cutter();
    // Continue above the opening only; never alter the calibrated fit section.
    translate([0,0,socket_d(k)-eps]) linear_extrude(0.15) {
      if(k=="A"||k=="AN") offset(delta=0.05) polygon(k=="A"?plug_A:plug_AN);
      else rr(k=="CN"?8.59:8.60,k=="CN"?2.80:2.86,0.50);
    }
  }
}
// Deliberate calibration samples only. Production organizers always use
// socket_cut(). An exact zero bypasses reconstruction of the accepted cutter.
module offset_socket_cut(k,top,fit_offset=0) {
  if(abs(fit_offset)<0.000000001) socket_cut(k,top);
  else translate([0,0,top-socket_d(k)]) {
    if(k=="A"||k=="AN") {
      profile=k=="A"?plug_A:plug_AN;
      linear_extrude(socket_d(k)-0.20) offset(delta=fit_offset) polygon(profile);
      translate([0,0,socket_d(k)-0.20]) hull() {
        linear_extrude(0.01) offset(delta=fit_offset) polygon(profile);
        translate([0,0,0.19]) linear_extrude(0.01) offset(delta=fit_offset+0.05) polygon(profile);
      }
    } else usb_c_socket_cutter(
      w=(k=="CN"?8.290:8.300)+2*fit_offset,
      t=(k=="CN"?2.500:2.560)+2*fit_offset,
      depth=socket_d(k),r=0.35+fit_offset
    );
    translate([0,0,socket_d(k)-eps]) linear_extrude(0.15) {
      if(k=="A"||k=="AN") offset(delta=fit_offset+0.05) polygon(k=="A"?plug_A:plug_AN);
      else rr((k=="CN"?8.59:8.60)+2*fit_offset,(k=="CN"?2.80:2.86)+2*fit_offset,0.50+fit_offset);
    }
  }
}
module body_cut(k,top) {
  translate([0,-pocket_l(k)/2,top-pocket_d(k)])
    linear_extrude(pocket_d(k)+0.15) polygon(body_pts(k));
}
module scoop(k,top,r=5) {
  translate([0,pocket_l(k)/2,top-2.5]) cylinder(r=r,h=2.65);
}
// Conservative width budgets measured with the bundled Liberation Sans Bold
// renderer across all accepted code points. Broad ASCII glyphs and extended
// Latin/Cyrillic ligatures need more room than the old uniform 1.15 estimate.
// Ordinary short model labels retain their requested size at default spacing.
function label_char_budget(c)=c==" "?0.5:ord(c)>127?2:
  (c=="W"||c=="w"||c=="M"||c=="m"||c=="@"||c=="%")?1.45:1.2;
function label_width_budget(s,i=0)=i>=len(s)?0:label_char_budget(s[i])+label_width_budget(s,i+1);
module label(s,x,y,z,maxw,size=2.7) {
  if(len(s)>0) translate([x,y,z-eps]) linear_extrude(0.35+eps)
    text(s,size=min(size,maxw/max(1,label_width_budget(s))),font="Liberation Sans:style=Bold",halign="center",valign="center");
}
module front_title_cut(s,w,d,h) {
  if(len(s)>0) translate([0,-d/2+0.35,h/2]) rotate([90,0,0]) linear_extrude(0.5)
    text(s,size=min(3.1,(w-10)/(max(1,len(s))*1.15)),font="Liberation Sans:style=Bold",halign="center",valign="center");
}
module dock(ks,ls,xy,w,d,h,title="",label_scale=1) {
  union() {
    difference() {
      slab(w,d,h,5);
      for(i=[0:len(ks)-1]) translate([xy[i][0],xy[i][1],0]) socket_cut(ks[i],h);
      front_title_cut(title,w,d,h);
    }
    for(i=[0:len(ks)-1]) label(ls[i],xy[i][0],xy[i][1]-upright_label_distance(ks[i],label_scale),h,20,2.55*label_scale);
  }
}
module tray(ks,ls,xy,w,d,h=8.6,scoop_r=5,label_width=23,label_scale=1) {
  union() {
    difference() {
      slab(w,d,h,4);
      for(i=[0:len(ks)-1]) translate([xy[i][0],xy[i][1],0]) {
        body_cut(ks[i],h);
        scoop(ks[i],h,scoop_r);
      }
    }
    for(i=[0:len(ks)-1]) label(ls[i],xy[i][0],xy[i][1]-flat_label_distance(ks[i],label_scale),h,label_width,2.7*label_scale);
  }
}
// Long cantilevers bend in the XY layer plane. Both sides are relieved through
// the slab OUTSIDE the entire calibrated pocket, so the cavity floor cannot
// accidentally shorten the free beam. Rounded ends give 0.5mm root fillets.
module tray_retainer_side(side) { if(side<0) mirror([1,0,0]) children(); else children(); }
module tray_retention_relief_2d() {
  L=${TRAY_FLEX.length}; r=${TRAY_FLEX.rootFillet};
  union() {
    translate([0,-${TRAY_FLEX.endRelief}]) square([${TRAY_FLEX.outerExtent},${TRAY_FLEX.endRelief}]);
    translate([0,-${TRAY_FLEX.endRelief}]) square([${TRAY_FLEX.sideRelief},L-r+${TRAY_FLEX.endRelief}]);
    translate([0,L-r]) intersection() { circle(r=r,$fn=32); square([r,r]); }
    polygon([[1.3,0],[1.5,L-r],[2,L-r],[2,0]]);
    translate([2,L-r]) intersection() { circle(r=r,$fn=32); translate([-r,0]) square([r,r]); }
  }
}
module tray_retention_relief(k,h) {
  s=retention_spec(k); start=s[0]-s[3]/2-pocket_l(k)/2;
  for(side=[-1,1]) tray_retainer_side(side) translate([s[1],start,-eps])
    linear_extrude(h+2*eps) tray_retention_relief_2d();
}
module tray_retention_lips(k,h) {
  s=retention_spec(k); y=s[0]-pocket_l(k)/2; edge=s[1]; body=s[2]; width=s[3];
  // The free end stays unstressed when seated. Sloped lead-in/withdrawal faces
  // capture the body only during lifting. A common low tip keeps stacking
  // compact. The ramp stays above the deck so it cannot bond the free arm
  // back to the pocket wall; its longest unsupported reach is under 1.75mm.
  for(side=[-1,1]) tray_retainer_side(side) translate([0,y+width/2,h]) rotate([90,0,0]) linear_extrude(width)
    polygon([[edge+1.3,-eps],[edge+0.5,-eps],[edge+0.5,0.05],
      [body-0.2,0.75],[body-0.2,1.25],[edge+1.3,0.55]]);
}
module tray_ring_2d(w,d,outer_inset,inner_inset) {
  difference() {
    rr(w-2*outer_inset,d-2*outer_inset,4-outer_inset);
    rr(w-2*inner_inset,d-2*inner_inset,4-inner_inset);
  }
}
module tray_rim_transition(w,d,outer0,inner0,outer1,inner1,z,height) {
  translate([0,0,z]) difference() {
    hull() {
      linear_extrude(eps) rr(w-2*outer0,d-2*outer0,4-outer0);
      translate([0,0,height-eps]) linear_extrude(eps) rr(w-2*outer1,d-2*outer1,4-outer1);
    }
    hull() {
      translate([0,0,-eps]) linear_extrude(eps) rr(w-2*inner0,d-2*inner0,4-inner0);
      translate([0,0,height]) linear_extrude(eps) rr(w-2*inner1,d-2*inner1,4-inner1);
    }
  }
}
module tray_stack_supports(w,d,h,tongue=true,gap=${TRAY_STACK.gap}) {
  // The perimeter conceals internal headroom. Independent bearing lands carry
  // the stack; the thin tongue only locates it and has 0.3mm lateral clearance.
  translate([0,0,h-eps]) linear_extrude(gap-${TRAY_STACK.seam}+eps)
    tray_ring_2d(w,d,0,${TRAY_STACK.rimWidth});
  tray_rim_transition(w,d,0,${TRAY_STACK.rimWidth},${TRAY_STACK.seam},${TRAY_STACK.rimWidth},h+gap-${TRAY_STACK.seam}-eps,${TRAY_STACK.seam}+eps);
  if(tongue) translate([0,0,h+gap-eps]) linear_extrude(${TRAY_STACK.tongueHeight}-0.2+eps)
    tray_ring_2d(w,d,${TRAY_STACK.tongueOuterInset},${TRAY_STACK.tongueInnerInset});
  if(tongue) tray_rim_transition(w,d,${TRAY_STACK.tongueOuterInset},${TRAY_STACK.tongueInnerInset},${TRAY_STACK.tongueOuterInset}+0.2,${TRAY_STACK.tongueInnerInset}-0.2,h+gap+${TRAY_STACK.tongueHeight}-0.2-eps,0.2+eps);
}
module tray_stack_sockets(w,d) {
  // Only a narrow annular groove is removed. Its 45-degree roof ends in a
  // 0.4mm bridge; the broad underside and every calibrated pocket floor stay flat.
  translate([0,0,-eps]) linear_extrude(${TRAY_STACK.grooveStraightDepth}+eps)
    tray_ring_2d(w,d,${TRAY_STACK.grooveOuterInset},${TRAY_STACK.grooveInnerInset});
  tray_rim_transition(w,d,${TRAY_STACK.grooveOuterInset},${TRAY_STACK.grooveInnerInset},${TRAY_STACK.grooveOuterInset}+0.5,${TRAY_STACK.grooveInnerInset}-0.5,${TRAY_STACK.grooveStraightDepth}-eps,${TRAY_STACK.grooveDepth - TRAY_STACK.grooveStraightDepth}+eps);
}
module tray_stack_pillars(points,h,gap=${TRAY_STACK.gap}) {
  // Layout supplies only sparse, collision-free positions. These small posts
  // share the rim's bearing plane; they never enter the next tray's underside.
  for(p=points) translate([p[0],p[1],h-eps])
    cylinder(d=${TRAY_STACK_PILLAR.diameter},h=gap+eps,$fn=48);
}
module inventory_tray(ks,ls,xy,w,d,h=8.6,scoop_r=6,label_width=23,retention=true,stackable=false,side_text="",support_xy=[],label_scale=1,has_lid=false) {
  gap=tray_stack_gap(retention);
  union() {
    difference() {
      tray(ks,ls,xy,w,d,h,scoop_r,label_width,label_scale);
      for(i=[0:len(ks)-1]) if(ks[i]=="CI") translate([xy[i][0],xy[i][1],0]) ci_inventory_reversible_cut(h);
      if(retention) for(i=[0:len(ks)-1]) translate([xy[i][0],xy[i][1],0]) tray_retention_relief(ks[i],h);
      if(stackable) tray_stack_sockets(w,d);
      front_title_cut(side_text,w,d,h);
    }
    if(retention) for(i=[0:len(ks)-1]) translate([xy[i][0],xy[i][1],0]) tray_retention_lips(ks[i],h);
    if(stackable||has_lid) {
      tray_stack_supports(w,d,h,true,gap);
      tray_stack_pillars(support_xy,h,gap);
    }
  }
}
// This actuator belongs to the lower tray. Its well opens upward, while
// the next tray or lid has only narrow, sloped passive receivers underneath.
module inventory_tray_snap(ks,ls,xy,w,d,h=${TRAY_SNAP.minimumHeight},scoop_r=6,label_width=23,retention=true,stackable=true,side_text="",support_xy=[],label_scale=1,has_lid=false) {
  gap=tray_stack_gap(retention);
  union() {
    difference() {
      inventory_tray(ks,ls,xy,w,d,h,scoop_r,label_width,retention,false,side_text,[],label_scale,false);
      tray_snap_sockets(w,d);
      tray_snap_body_relief(w,d,h,gap);
      tray_snap_pry_notches(w,d);
    }
    tray_snap_lower(w,d,h,gap);
    tray_stack_pillars(support_xy,h,gap);
  }
}
// Exterior-down printing leaves the locating groove open upward. Assembly
// flips this part onto the same bearing plane used by the next stacked tray.
// textmetrics is enabled by the bundled runtime. Exported SCAD has a safe
// fallback for older desktop OpenSCAD; enable Text Metrics for exact fitting.
module lid_text(s,w,d,requested,text_percent=undef,text_rotation=undef) {
  m=textmetrics(s,size=1,font="Liberation Sans:style=Bold");
  area=[w-${TRAY_LID.textInset * 2},d-${TRAY_LID.textInset * 2}];
  fallback=[max(1,label_width_budget(s)),${TRAY_LID.textVerticalBudget}];
  size=is_undef(m)?fallback:m.size;
  fit=min(area[0]/max(.001,size[0]),area[1]/max(.001,size[1]));
  turned_fit=min(area[0]/max(.001,size[1]),area[1]/max(.001,size[0]));
  angle=is_undef(text_rotation)?(requested>=100 && turned_fit>fit?90:0):text_rotation;
  available=angle%180==90?turned_fit:fit;
  scale_factor=is_undef(text_percent)?(requested>=100?available:min(requested,available)):available*text_percent/100;
  if(is_undef(text_percent)) echo("KEYFORM_LID_TEXT",[100*scale_factor/available,angle]);
  rotate(angle) {
    if(!is_undef(m)) scale([scale_factor,scale_factor])
      translate([-m.position[0]-size[0]/2,-m.position[1]-size[1]/2])
        text(s,size=1,font="Liberation Sans:style=Bold");
    else text(s,size=scale_factor,font="Liberation Sans:style=Bold",halign="center",valign="center");
  }
}
module inventory_tray_lid(w,d,s="",text_size=6,groove=true,thickness=${TRAY_LID.thickness},text_percent=undef,text_rotation=undef) {
  difference() {
    slab(w,d,thickness,4);
    if(groove) translate([0,0,thickness]) rotate([180,0,0]) tray_stack_sockets(w,d);
    // Four symmetric shallow recesses stay outside the locating groove. Each
    // cylinder points inward from its edge in the exterior-down print frame.
    for(side=[-1,1]) {
      translate([0,side*(d/2+eps),thickness+${TRAY_LID.notchRadius - TRAY_LID.notchHeight}])
        rotate([side*90,0,0]) cylinder(r=${TRAY_LID.notchRadius},h=${TRAY_LID.notchDepth}+eps,$fn=64);
      translate([side*(w/2+eps),0,thickness+${TRAY_LID.notchRadius - TRAY_LID.notchHeight}])
        rotate([0,-side*90,0]) cylinder(r=${TRAY_LID.notchRadius},h=${TRAY_LID.notchDepth}+eps,$fn=64);
    }
    if(len(s)>0) translate([0,0,${TRAY_LID.engravingDepth}]) rotate([180,0,0]) linear_extrude(${TRAY_LID.engravingDepth}+eps)
      lid_text(s,w,d,text_size,text_percent,text_rotation);
  }
}
module inventory_tray_lid_percent(w,d,s="",percent=100,angle=0) {
  inventory_tray_lid(w,d,s,text_percent=percent,text_rotation=angle);
}
module rail_base(n,mounting=true,end_margin=5) {
  w=n*26+2*end_margin;
  difference() {
    union() {
      slab(w,36,3,3);
      for(y=[-16,16]) translate([0,y,2.95]) slab(w-2,3,5.65,1);
      // The foot is 28.4 wide in a 29mm channel; lips clear its top by 0.4.
      for(y=[-13.9,13.9]) translate([0,y,7.4]) cube([w-5,3,2],center=true);
      translate([-w/2+3,0,4.5]) cube([3,29,3],center=true);
    }
    if(mounting) for(x=[-w/2+7,w/2-7]) translate([x,0,-eps]) cylinder(d=3.3,h=3+2*eps);
  }
}
module cartridge(k,s="",label_scale=1) {
  union() {
    difference() {
      union() {
        slab(25.6,28.4,3,1.4);
        translate([0,0,2.9]) slab(23,23,10.7,1.5);
      }
      socket_cut(k,13.6);
    }
    label(s,0,-upright_label_distance(k,label_scale),13.6,20,2.0*label_scale);
  }
}
// Gridfinity base mating dimensions: 42mm pitch, 0.5mm total gap.
// 0.8mm chamfer + 1.8mm straight + 2.15mm chamfer; no stacking rim.
function grid_rect_ring(w,l,r,z,x=0,y=0) = [for(c=[0:3],j=[0:12])
  let(a=c*90+j*90/12, cx=x+(c==0||c==3?1:-1)*(w/2-r), cy=y+(c<2?1:-1)*(l/2-r))
  [cx+r*cos(a),cy+r*sin(a),z]];
function grid_ring(w,r,z,x=0,y=0) = grid_rect_ring(w,w,r,z,x,y);
module grid_foot(cols,rows) {
  ring_size=52;
  faces=concat(
    [[for(i=[ring_size-1:-1:0]) i]],
    [[for(i=[0:ring_size-1]) 4*ring_size+i]],
    [for(level=[0:3],i=[0:ring_size-1]) let(j=(i+1)%ring_size)
      [level*ring_size+i,level*ring_size+j,(level+1)*ring_size+j,(level+1)*ring_size+i]]
  );
  for(i=[0:cols-1],j=[0:rows-1]) {
    x=(i-(cols-1)/2)*42; y=(j-(rows-1)/2)*42;
    // Global-coordinate rings and the bridge use identical corner samples.
    // Extend only ABOVE the calibrated shoulder to join the bridge robustly.
    pts=concat(grid_ring(35.6,0.8,0,x,y),grid_ring(37.2,1.6,0.8,x,y),grid_ring(37.2,1.6,2.6,x,y),grid_ring(41.5,3.75,4.75,x,y),grid_ring(41.5,3.75,4.85,x,y));
    // OpenSCAD expects clockwise faces viewed from outside; reverse the rings.
    polyhedron(pts,[for(face=faces) [for(v=[len(face)-1:-1:0]) face[v]]],convexity=4);
  }
}
module grid_bridge(cols,rows,top) {
  ring_size=52;
  pts=concat(grid_rect_ring(cols*42-0.5,rows*42-0.5,3.75,4.75),grid_rect_ring(cols*42-0.5,rows*42-0.5,3.75,top));
  faces=concat(
    [[for(i=[ring_size-1:-1:0]) i]],
    [[for(i=[0:ring_size-1]) ring_size+i]],
    [for(i=[0:ring_size-1]) let(j=(i+1)%ring_size) [i,j,ring_size+j,ring_size+i]]
  );
  polyhedron(pts,[for(face=faces) [for(v=[len(face)-1:-1:0]) face[v]]],convexity=4);
}
module grid_tile(ks,ls,xy,cols,rows,flat=false,extra_height=0,label_scale=1) {
  h=(flat?13:15)+extra_height;
  union() {
    difference() {
      union() {
        grid_foot(cols,rows);
        grid_bridge(cols,rows,h);
      }
      for(i=[0:len(ks)-1]) translate([xy[i][0],xy[i][1],0]) {
        if(flat) { body_cut(ks[i],h); scoop(ks[i],h); }
        else socket_cut(ks[i],h);
      }
    }
    for(i=[0:len(ks)-1]) label(ls[i],xy[i][0],xy[i][1]-(flat?flat_label_distance(ks[i],label_scale):upright_label_distance(ks[i],label_scale)),h,32,2.7*label_scale);
  }
}
module case_base(w,d,h) {
  difference() {
    slab(w+8,d+8,h,5);
    translate([0,0,2.4]) slab(w+0.5,d+0.5,h,3.25);
    translate([0,-(d+8)/2-0.1,h-0.5]) rotate([-90,0,0]) cylinder(r=5,h=5);
  }
}
// Printable exterior down. In the closed assembly flip around X and place at
// rim height + 2.4; the 2.5mm engagement ring remains above the insert.
module case_lid(w,d,s="") {
  difference() {
    union() {
      slab(w+8,d+8,2.4,5);
      translate([0,0,2.4-eps]) difference() {
        slab(w-0.3,d-0.3,2.5+eps,3);
        translate([0,0,-eps]) slab(w-3.5,d-3.5,2.5+3*eps,2.1);
      }
    }
    if(len(s)>0) translate([0,0,0.35]) rotate([180,0,0]) linear_extrude(0.5)
      text(s,size=min(6,(w-6)/(max(1,len(s))*1.15)),font="Liberation Sans:style=Bold",halign="center",valign="center");
  }
}
module grid_fit_test() {
  union() { grid_foot(1,1); grid_bridge(1,1,7); }
}
module lid_fit_base() {
  intersection() { case_base(40,40,15); translate([-25,-25,-eps]) cube([25,25,16]); }
}
module lid_fit_lid() {
  intersection() { case_lid(40,40); translate([-25,0,-eps]) cube([25,25,6]); }
}
module key_fit_tester(k,offsets,offset_labels,heading) {
  n=len(offsets); w=(n-1)*22+24; h=socket_d(k)+3;
  union() {
    difference() {
      slab(w,28,h,3);
      for(i=[0:n-1]) translate([(i-(n-1)/2)*22,3,0]) offset_socket_cut(k,h,offsets[i]);
    }
    for(i=[0:n-1]) label(offset_labels[i],(i-(n-1)/2)*22,-3,h,19,2.4);
    label(heading,0,-10,h,w-8,2.3);
  }
}
`;

export function scadCall(module: string, args: unknown[]): string {
  return `${library}\n${module}(${args.map((arg) => JSON.stringify(arg)).join(',')});\n`;
}
