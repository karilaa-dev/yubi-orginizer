/* H20 / V7 connector primitives. Units: mm. Include or concatenate this file.
   Derived by namespacing the ORIGINAL V7 OpenSCAD; geometric numbers unchanged.
   Local +X is the movement of the LOWER features in the UPPER socket frame.
   Upper layer starts at world +X=6 mm, then slides toward -X to flush at zero.
   Male local Z=0 is its solid landing/support plane; pocket local Z=0 is the
   upper layer's assembled underside. These planes COINCIDE when seated.
   No scale, global tolerance offset, springs, detents, or loose components.
   Exact fillets are in the STEP reference; these OpenSCAD roots use 64 chords.
   Face winding corrected for the app Manifold backend; vertex coordinates unchanged.
   Required total per connected inventory tray: 2 pins + 2 guide blocks,
   2 underside pin pockets + 2 underside guide pockets. Guides are NOT pins.
*/
yo_v7_travel=6;
yo_v7_pin_h=4.2;
yo_v7_root_r=.8;
yo_v7_stem_w=3.6;
yo_v7_interference=.20;
yo_v7_eps=.02;
yo_v7_pin_profile=[[-1.5,-.15],[1.5,-.15],[1.5,0],[1.3,.2],[1.3,1],
 [2.9,2.6],[2.9,3],[.3,5.6],[-.3,5.6],[-2.9,3],[-2.9,2.6],
 [-1.3,1],[-1.3,.2],[-1.5,0]];
yo_v7_entry_profile=[[-3.4,-yo_v7_eps],[3.4,-yo_v7_eps],[3.4,0],[3.15,.25],[3.15,3.25],
 [.2,6.2],[-.2,6.2],[-3.15,3.25],[-3.15,.25],[-3.4,0]];
function yo_v7_slot_profile(g)=let(a=2.1+g,b=2.9+g)[
 [-1.9,-yo_v7_eps],[1.9,-yo_v7_eps],[1.9,0],[1.55,.35],[1.55,1.05],[a,1.8],
 [b,2.6],[b,3],[3.15,3.25],[.2,6.2],[-.2,6.2],[-3.15,3.25],
 [-b,3],[-b,2.6],[-a,1.8],[-1.55,1.05],[-1.55,.35],[-1.9,0]];
module yo_v7_prism_x(p,x0,x1){
 translate([x0,0,0])multmatrix([[0,0,1,0],[1,0,0,0],[0,1,0,0],[0,0,0,1]])
 linear_extrude(height=x1-x0,convexity=12)polygon(p);
}
module yo_v7_loft_x(p0,p1,x0,x1){
 k=len(p0);
 pts=concat([for(p=p0)[x0,p[0],p[1]]],[for(p=p1)[x1,p[0],p[1]]]);
 sides=[for(j=[0:k-1])each [[j,(j+1)%k,k+(j+1)%k],[j,k+(j+1)%k,k+j]]];
 faces=concat([[for(j=[k-1:-1:0])j]],sides,[[for(j=[0:k-1])k+j]]);
 polyhedron(points=pts,faces=[for(f=faces) [for(i=[len(f)-1:-1:0])f[i]]],convexity=20);
}
// Each section is [z,xmin,xmax,ymin,ymax], vertices counterclockwise from above.
module yo_v7_rect_loft(sections){
 n=len(sections);
 pts=[for(s=sections)each [[s[1],s[3],s[0]],[s[2],s[3],s[0]],
                         [s[2],s[4],s[0]],[s[1],s[4],s[0]]]];
 faces=concat([[3,2,1,0]],
  [for(i=[0:n-2],j=[0:3])each [[i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4],
                             [i*4+j,(i+1)*4+(j+1)%4,(i+1)*4+j]]],
  [[for(j=[0:3])(n-1)*4+j]]);
 polyhedron(points=pts,faces=[for(f=faces) [for(i=[len(f)-1:-1:0])f[i]]],convexity=20);
}
module yo_v7_root_fillet(){
 sections=[for(i=[0:64])let(t=i*90/64,z=yo_v7_root_r*(1-cos(t)),g=yo_v7_root_r*(1-sin(t)))
  [z,-2-g,2+g,-yo_v7_stem_w/2-g,yo_v7_stem_w/2+g]];
 yo_v7_rect_loft(sections);
}
module yo_v7_fixed_pin(){
 union(){
  intersection(){yo_v7_prism_x(yo_v7_pin_profile,-2,2);translate([-7,-7,-.15])cube([14,14,yo_v7_pin_h+.15]);}
  translate([-2,-yo_v7_stem_w/2,-.15])cube([4,yo_v7_stem_w,1.65]);
  yo_v7_root_fillet();
 }
}
module yo_v7_root_clearance(){
 yo_v7_rect_loft([[-yo_v7_eps,-9.05,3.05,-2.85,2.85],[0,-9.05,3.05,-2.85,2.85],
  [.8,-8.25,2.25,-2.05,2.05],[1,-8.25,2.25,-2.05,2.05],
  [1.55,-8.25,2.25,-1.85,1.85]]);
}
module yo_v7_v6_socket_cut(){
 union(){
  yo_v7_prism_x(yo_v7_slot_profile(.25),-8.25,-3.75);
  yo_v7_loft_x(yo_v7_slot_profile(.25),yo_v7_slot_profile(-yo_v7_interference/2),-3.75,-2);
  yo_v7_prism_x(yo_v7_slot_profile(-yo_v7_interference/2),-2,2);
  yo_v7_prism_x(yo_v7_entry_profile,-8.25,-3.75);
  yo_v7_root_clearance();
 }
}



module yo_v7_guide_block(len){
 h=len/2;w=3;r=.6;
 union(){
  yo_v7_rect_loft([[-.15,-h,h,-w,w],[2.65,-h,h,-w,w],[3,-h+.35,h-.35,-w+.35,w-.35]]);
  yo_v7_rect_loft([for(i=[0:64])let(t=i*90/64,z=r*(1-cos(t)),g=r*(1-sin(t)))
    [z,-h-g,h+g,-w-g,w+g]]);
 }
}
module yo_v7_guide_socket(len){
 h=len/2;a=3.15;rise=a-.2;
 yo_v7_rect_loft([[-yo_v7_eps,-yo_v7_travel-h-.25-.8,h+.8,-a-.8,a+.8],
 [0,-yo_v7_travel-h-.25-.8,h+.8,-a-.8,a+.8],
 [.8,-yo_v7_travel-h-.25,h,-a,a],
 [3.2,-yo_v7_travel-h-.25,h,-a,a],
 [3.2+rise,-yo_v7_travel-h-.25+rise,h-rise,-.2,.2]]);
}
module yo_v7_pin_socket(){
 union(){
  yo_v7_v6_socket_cut();
  yo_v7_prism_x(yo_v7_slot_profile(-yo_v7_interference/2),1.98,2.4);
  translate([.4,0,0])yo_v7_root_clearance();
 }
}

// Production-facing wrappers. Coordinate layout belongs to the application.
// These helpers intentionally reject the old four-pin demonstration layout.
module yo_v7_top(pin_xy, guide_xyl, seating_z) {
 assert(len(pin_xy)==2, "H20/V7 requires exactly TWO retaining pins per tray");
 assert(len(guide_xyl)==2, "H20/V7 requires exactly TWO anti-rotation guides");
 for(p=pin_xy) translate([p[0],p[1],seating_z]) yo_v7_fixed_pin();
 for(g=guide_xyl) {
  assert(g[2]==8, "This handoff defaults to the original 8 mm coupon guide");
  translate([g[0],g[1],seating_z]) yo_v7_guide_block(g[2]);
 }
}
module yo_v7_bottom_cuts(pin_xy, guide_xyl, underside_z=0) {
 assert(len(pin_xy)==2, "H20/V7 requires exactly TWO retaining-pin pockets");
 assert(len(guide_xyl)==2, "H20/V7 requires exactly TWO anti-rotation pockets");
 for(p=pin_xy) translate([p[0],p[1],underside_z]) yo_v7_pin_socket();
 for(g=guide_xyl) {
  assert(g[2]==8, "This handoff defaults to the original 8 mm coupon guide");
  translate([g[0],g[1],underside_z]) yo_v7_guide_socket(g[2]);
 }
}
// children() MUST already contain solid material up to seating_z at every root.
// This does NOT generate pedestals, solve collisions, or infer body stack gap.
module yo_v7_apply(pin_xy, guide_xyl, seating_z, top=true, bottom=true) {
 union() {
  difference() {
   children();
   if(bottom) yo_v7_bottom_cuts(pin_xy,guide_xyl);
  }
  if(top) yo_v7_top(pin_xy,guide_xyl,seating_z);
 }
}
