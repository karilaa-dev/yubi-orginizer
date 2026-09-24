import type { KeyType } from '../types';
import { calibratedLibrary } from './library';
import { ciTouchScad } from './ci-touch';

export type KeyComponent = 'body' | 'connector' | 'touch' | 'all';
export const NFC_TOUCH_CENTER_Y = 24.5;
export const NFC_TOUCH_RADIUS = 4.65;
export const NFC_TOUCH_RECESS = 0.15;
export const NFC_TOUCH_THICKNESS = 0.1;

/** Display-only geometry in the original silhouette coordinate system. X is
 * centred, Y runs 0..length, and Z is centred through the key thickness. The
 * high-Y end is the insertion end on AN/CN/CK/CI. These models are never pocket
 * cutters. Small face/connector details are illustrative, guided by Yubico's
 * product photographs: https://developers.yubico.com/Developer_Program/Guides/YubiKey_Hardware.html */
export function buildKeyScad(type: KeyType, component: KeyComponent = 'all'): string {
  return `${calibratedLibrary}
${ciTouchScad}
$fn=96;
k=${JSON.stringify(type)};
component=${JSON.stringify(component)};
touch_y=${NFC_TOUCH_CENTER_Y};
touch_r=${NFC_TOUCH_RADIUS};
touch_recess=${NFC_TOUCH_RECESS};
touch_thickness=${NFC_TOUCH_THICKNESS};
L=k=="A"||k=="C"?45:k=="AN"?13:k=="CN"?10.1:k=="CK"?29.5:40.3;
T=k=="A"?3.7:k=="C"?3.75:k=="AN"?3.1:k=="CN"?7:5;
body_start=k=="A"?11.7:k=="C"?6.65792:k=="CI"?6.20359:0;
body_end=k=="AN"?3.8:k=="CN"?3.46716:k=="CK"?22.73659:k=="CI"?33.62998:L;
hole_y=k=="A"||k=="C"?40:k=="CK"?5.5:15.7;
hole_outer=k=="A"||k=="C"?2.55:2.7;
hole_inner=k=="A"||k=="C"?2.2:2.3;
module rounded_rect(w,h,r) { offset(r=r) square([w-2*r,h-2*r],center=true); }
module region(a,b,t) {
  translate([0,0,-t/2]) linear_extrude(t) intersection() {
    polygon(nominal_pts(k));
    translate([-12,a]) square([24,b-a]);
  }
}
module body() {
  difference() {
    region(body_start,body_end,T);
    if(k=="A"||k=="C"||k=="CK"||k=="CI") translate([0,hole_y,-T]) cylinder(r=hole_outer,h=2*T);
    if(k=="AN") translate([0,1.25,-T]) linear_extrude(2*T) rounded_rect(2.2,0.7,0.25);
    if(k=="A"||k=="C") translate([0,touch_y,T/2-touch_recess-touch_thickness])
      cylinder(r=touch_r,h=touch_recess+touch_thickness+0.02);
  }
}
module c_shell(start,end,tip_high=true) {
  difference() {
    translate([0,start,0]) rotate([-90,0,0]) linear_extrude(end-start)
      rounded_rect(8.25,2.4,1.19);
    // A shallow hollow mouth reads as a USB-C shell, rather than a solid block.
    translate([0,tip_high?end-2.3:start-0.02,0]) rotate([-90,0,0]) linear_extrude(2.34)
      rounded_rect(7.25,1.4,0.69);
  }
}
module connector() {
  if(k=="A") region(0,body_start,2.59);
  else if(k=="AN") region(body_end,L,2.86);
  else if(k=="C") c_shell(0,body_start,false);
  else {
    c_shell(body_end,L);
    if(k=="CI") region(0,body_start,1.5);
  }
}
module hole_liner() {
  translate([0,hole_y,-T/2+0.025]) difference() {
    cylinder(r=hole_outer,h=T-0.05);
    translate([0,0,-0.01]) cylinder(r=hole_inner,h=T);
  }
  for(z=[-T/2,T/2-0.025]) translate([0,hole_y,z]) linear_extrude(0.05)
    difference() { circle(r=hole_outer+0.16); circle(r=hole_inner); }
}
module touch() {
  if(k=="A"||k=="C") translate([0,touch_y,T/2-touch_recess-touch_thickness])
    cylinder(r=touch_r,h=touch_thickness);
  if(k=="A"||k=="C"||k=="CK"||k=="CI") hole_liner();
  if(k=="AN") translate([0,0,T/2-0.025]) linear_extrude(0.075) difference() {
    intersection() { polygon(nominal_pts(k)); translate([-6,0]) square([12,1.9]); }
    translate([0,1.25]) rounded_rect(2.2,0.7,0.25);
  }
  if(k=="CN") translate([0,1.7,T/2-0.025]) linear_extrude(0.075) rounded_rect(3.6,0.6,0.2);
  if(k=="CK") for(x=[-6.19,6.19]) translate([x,11.35,0]) cube([0.12,3.1,1.7],center=true);
  if(k=="CI") ci_side_touch_reference();
  if(k=="A") for(x=[-4.15,-1.4,1.4,4.15])
    translate([x-1.02,0.85,2.59/2-0.025]) cube([2.04,abs(x)>3?7.0:6.25,0.075]);
  if(k=="AN") for(x=[-4.15,-1.4,1.4,4.15])
    translate([x-1.02,4.3,2.86/2-0.025]) cube([2.04,abs(x)>3?8.0:7.3,0.075]);
  if(k=="CI") for(x=[-2.45,-1.75,-1.05,-0.35,0.35,1.05,1.75,2.45],z=[-0.79,0.73])
    translate([x-0.19,0.65,z]) cube([0.38,3.5,0.06]);
}
if(component=="body"||component=="all") body();
if(component=="connector"||component=="all") connector();
if(component=="touch"||component=="all") touch();
`;
}
