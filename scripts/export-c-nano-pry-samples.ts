/** Standalone ergonomic experiment. Never changes the production tray geometry. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { build3mf } from '../src/three-mf';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { renderScadInNode } from '../src/runtime/node-render';
import type { PartSpec, ProjectGeometry, Vec3 } from '../src/types';

const output = 'artifacts/c-nano-pry-samples';
const height = 8.6;
type Variant = {
  id: string; name: string; description: string; raiseMm: number;
  noseRadius: number; noseY: number; accessFloor: number;
  side: 'none' | 'right' | 'both'; rear: 'none' | 'scoop' | 'channel';
  openNose?: boolean; fingerDiameter: number;
};
const variants: Variant[] = [
  { id:'01', name:'Compact deep nose', description:'14 mm nose opening; 2.3 mm clearance below the metal tip.', raiseMm:0, noseRadius:7, noseY:7.4, accessFloor:2, side:'none', rear:'none', fingerDiameter:9 },
  { id:'02', name:'Wide nose', description:'18 mm nose opening gives a wider finger approach without changing seating depth.', raiseMm:0, noseRadius:9, noseY:8.4, accessFloor:2, side:'none', rear:'none', fingerDiameter:12 },
  { id:'03', name:'Extra wide and deep nose', description:'20 mm nose opening with a 1.6 mm floor and 1 mm front rim; 2.7 mm under-tip clearance.', raiseMm:0, noseRadius:10, noseY:9, accessFloor:1.6, side:'none', rear:'none', fingerDiameter:14 },
  { id:'04', name:'Open nose channel', description:'16 mm channel reaches the coupon edge so a finger can approach horizontally as well as from above.', raiseMm:0, noseRadius:8, noseY:8, accessFloor:2, side:'none', rear:'none', openNose:true, fingerDiameter:14 },
  { id:'05', name:'Right body access', description:'Deep nose plus a right-hand 13 mm scoop exposing the thick body side.', raiseMm:0, noseRadius:7, noseY:7.4, accessFloor:2, side:'right', rear:'none', fingerDiameter:9 },
  { id:'06', name:'Two-sided body pinch', description:'Deep nose plus opposing 13 mm scoops so thumb and finger can pinch the body.', raiseMm:0, noseRadius:7, noseY:7.4, accessFloor:2, side:'both', rear:'none', fingerDiameter:9 },
  { id:'07', name:'Rear pivot bowl', description:'Deep nose plus a 17 mm rear bowl frees the back corners for an upward pivot while retaining the whole body floor.', raiseMm:0, noseRadius:7, noseY:7.4, accessFloor:2, side:'none', rear:'scoop', fingerDiameter:9 },
  { id:'08', name:'Rear nail channel', description:'Deep nose plus an open 10 mm rear channel gives 0.4 mm clearance beneath the back body; shoulder and side support remain.', raiseMm:0, noseRadius:7, noseY:7.4, accessFloor:2, side:'none', rear:'channel', fingerDiameter:9 },
  { id:'09', name:'Raised nose cradle', description:'Cradle raised 1.2 mm gives 1.6 mm body protrusion and 3.5 mm clearance below the tip in a 16 mm scoop.', raiseMm:1.2, noseRadius:8, noseY:8.2, accessFloor:2, side:'none', rear:'none', fingerDiameter:10 },
  { id:'10', name:'Raised body pinch', description:'Cradle raised 2 mm gives 2.4 mm body protrusion, side pinch scoops and 4.3 mm under-tip clearance.', raiseMm:2, noseRadius:7, noseY:7.4, accessFloor:2, side:'both', rear:'none', fingerDiameter:9 },
];

const vite = await createServer({ configFile:false, logLevel:'silent', optimizeDeps:{noDiscovery:true,include:[]}, server:{middlewareMode:true,hmr:false,ws:false}, appType:'custom' });
const { library } = await vite.ssrLoadModule('/src/geometry/library.ts') as { library:string };
const { buildKeyScad } = await vite.ssrLoadModule('/src/geometry/keys.ts') as { buildKeyScad(type:'CN', component?:'all'|'body'|'connector'|'touch'):string };
await vite.close();
await mkdir(output,{recursive:true});

function source(v:Variant):string {
  return `${library}\n$fn=96;
// The calibrated body seat and cn_flat_support are reused unchanged. Only access
// cuts and, for 09/10, the explicitly stated seating height differ.
module access() {
  intersection() {
    ${v.openNose
      ? `translate([-8,1.4,${v.accessFloor}])cube([16,21,10]);`
      : `translate([0,${v.noseY},${v.accessFloor}])cylinder(r=${v.noseRadius},h=12);`}
    translate([-20,1.4,${v.accessFloor}])cube([40,30,12]);
  }
  ${v.side === 'none' ? '' : `for(x=${v.side==='both'?'[-10.4,10.4]':'[10.4]'})translate([x,-3.3,2])cylinder(r=6.5,h=12);`}
  ${v.rear === 'scoop' ? 'translate([0,-10.1,2])cylinder(r=8.5,h=12);' : ''}
  ${v.rear === 'channel' ? 'translate([-5,-21,1.6])cube([10,17.8,12]);' : ''}
}
union() {
  difference() {
    slab(40,40,${height},3);
    body_cut("CN",${height+v.raiseMm},false);
    access();
  }
  // Labels are attached to the deck and avoid every access opening.
  translate([-14,14,8.57])linear_extrude(.63)
    text("${v.id}",size=4.2,font="Liberation Sans:style=Bold",halign="center",valign="center");
}
`;
}
function signedVolume(b:ArrayBuffer|null):number {
  if (!b) return 0;
  const d=new DataView(b); let s=0;
  for(let t=0;t<d.getUint32(80,true);t++){
    const [a,b,c]=[0,1,2].map(v=>[0,1,2].map(i=>d.getFloat32(96+t*50+v*12+i*4,true)));
    s+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }
  return Math.abs(s);
}
const records = variants.map(v=>({
  ...v, stl:`c-nano-pry-${v.id}.stl`, scad:`c-nano-pry-${v.id}.scad`,
  keyPosition:[0,-5.05,5.5+v.raiseMm] as Vec3, dimensions:[40,40,9.2] as Vec3,
  bodyRecessMm:6.6-v.raiseMm, bodyFloorMm:2+v.raiseMm,
  bodyProtrusionMm:.4+v.raiseMm, connectorRootFloorMm:4.3+v.raiseMm,
  underTipGapMm:4.3+v.raiseMm-v.accessFloor,
  minimumFloorMm:Math.min(v.accessFloor,v.rear==='channel'?1.6:2),
  retention:false,
}));
const manifest:Record<string,unknown>={
  title:'C Nano finger-pry experiment — ten separate coupons', generatedAt:new Date().toISOString(),
  status:'rendering', units:'mm', variants:records,
  originalPocket:'Calibrated body_cut CN seat without production pry relief, with body_CN XY polygon and cn_flat_support; only 09/10 intentionally raise its Z position.',
  flatCradleNote:'This experiment concerns the flat inventory tray, not the separately calibrated upright USB-C plug socket.',
  sourceSha256:createHash('sha256').update(library).digest('hex'),
  simulationLimits:[
    'The C Nano reference is illustrative. No physical finger, nail, friction, compliance, tolerance, wear, force or actual key measurement is simulated.',
    'Finger-pad spheres and a thin nail rectangle are geometric access gauges, not a human-hand simulation or a guarantee of comfort.',
    'Straight upward extraction is tested at sampled heights; the printed coupons are required to determine comfortable removal.',
    'Use a small initial pry followed by upward lift for 01-06 and 08-10. These can bind at larger angles without lift. Rear-bowl variant 07 is additionally tested for a 20 degree pivot without lift.',
    'Raised variants 09 and 10 need respectively 1.2 mm and 2 mm extra headroom if later integrated under a lid or another tray.',
    'These coupons intentionally omit retention tabs. A selected design will need rechecking if tabs are later added.',
  ],
};
async function save(){ await writeFile(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n'); }
await save();
const project:ProjectGeometry={parts:[],keys:[],dimensions:[140,190,9.2]};
const meshes=new Map<string,ArrayBuffer>();
const checks:Record<string,unknown>[]=[];
const referenceScad=buildKeyScad('CN');
const reference=(await renderScadInNode(referenceScad)).stl!;
await writeFile(`${output}/c-nano-reference.stl`,new Uint8Array(reference));
await writeFile(`${output}/c-nano-reference.scad`,referenceScad);
for(const v of records){
  const scad=source(v), id=`c-nano-pry-${v.id}`;
  const part:PartSpec={id,name:`${v.id} C Nano - ${v.name}`,scad,position:[0,0,0],rotation:[0,0,0],explode:[0,0,0],color:'#187bd1'};
  const {stl}=await renderScadInNode(scad);assert.ok(stl);
  const mesh=inspectPrintableMesh(stl);
  assert.deepEqual(mesh.min,[-20,-20,0]);
  assert.ok(Math.abs(mesh.max[2]-9.2)<.001);
  meshes.set(id,stl);project.parts.push(part);
  project.keys.push({slotId:v.id,type:'CN',position:v.keyPosition,rotation:[0,0,0],partId:id});
  await writeFile(`${output}/${v.stl}`,new Uint8Array(stl));
  await writeFile(`${output}/${v.scad}`,scad);
  checks.push({id:v.id,mesh});
  console.log(`Rendered ${v.id}: ${v.name} (${mesh.triangles} triangles)`);
}
await writeFile(`${output}/c-nano-pry-10.3mf`,build3mf(project,meshes,{title:'C Nano finger-pry — all 10 samples'}));
manifest.status='meshes exported; simulation running';manifest.meshChecks=checks;
await save();
console.log('3MF READY: '+output+'/c-nano-pry-10.3mf');

for(const v of records){
  const files={'/coupon.stl':new Uint8Array(meshes.get(`c-nano-pry-${v.id}`)!),'/key.stl':new Uint8Array(reference)};
  const results:Record<string,unknown>[]=[];
  async function empty(name:string,scad:string){
    const r=await renderScadInNode(scad,{files,allowEmpty:true});
    const volume=signedVolume(r.stl); assert.ok(volume<.00001,`${v.id} ${name}: ${volume} mm3 collision/missing material`);
    results.push({name,passed:true,intersectionOrMissingMm3:volume});
  }
  // Exact imported STL versus complete reference at seated and lifted heights.
  for(const lift of [0,.2,.8,2,4,7])await empty(`reference collision at lift ${lift} mm`,
    `intersection(){import("/coupon.stl");translate([0,-5.05,${v.keyPosition[2]+lift}])import("/key.stl");}`);
  // Full continuous bottom sheet, not a few point checks.
  await empty('continuous minimum floor',`${library}\ndifference(){translate([0,0,.001])linear_extrude(${v.minimumFloorMm-.002})offset(delta=-.001)rr(40,40,3);import("/coupon.stl");}`);
  // Separated contact pads under the thick body and connector-root land.
  // Rear channel ends at -3.2, so the shoulder contact at -2.5 survives.
  await empty('body and connector root support pads',`difference(){union(){for(x=[-3,3])translate([x,-2.5,${v.bodyFloorMm-.1}])cylinder(r=.55,h=.099,$fn=24);translate([0,0,${v.connectorRootFloorMm-.1}])cube([3,1.2,.099],center=false);}import("/coupon.stl");}`);
  // Nail route from the open nose to below the metal, with a 0.2 mm margin.
  await empty('6 mm wide x 0.8 mm thick nail access',`intersection(){import("/coupon.stl");translate([-3,3.2,${v.connectorRootFloorMm-1}])cube([6,8.8,.8]);}`);
  // A round finger-pad gauge is deliberately distinguished from the thin nail.
  const r=v.fingerDiameter/2, cy=(v.id==='03'?5:5.1)+r, cz=v.accessFloor+r+.1;
  await empty(`${v.fingerDiameter} mm finger-pad gauge from above`,
    `intersection(){union(){import("/coupon.stl");translate(${JSON.stringify(v.keyPosition)})import("/key.stl");}translate([0,${cy},${cz}])sphere(r=${r},$fn=64);}`);
  if(v.side!=='none')await empty('10 mm side finger-pad gauges',
    `intersection(){union(){import("/coupon.stl");translate(${JSON.stringify(v.keyPosition)})import("/key.stl");}for(x=${v.side==='both'?'[-11.2,11.2]':'[11.2]'})translate([x,-3.3,7.1])sphere(r=5,$fn=64);}`);
  if(v.rear==='scoop')await empty('10 mm rear finger-pad gauge',
    `intersection(){union(){import("/coupon.stl");translate(${JSON.stringify(v.keyPosition)})import("/key.stl");}translate([0,-10.3,7.1])sphere(r=5,$fn=64);}`);
  if(v.rear==='channel')await empty('rear 6 mm x 0.25 mm nail access',
    'intersection(){import("/coupon.stl");translate([-3,-21,1.675])cube([6,16.9,.25]);}');
  // Sample an initial pry around the rear-bottom body edge, followed by lift.
  // Large no-lift rotations are intentionally measured, not called passes:
  // they expose the limits of the unchanged body pocket rather than hiding them.
  const tiltSamples:Record<string,unknown>[]=[];
  const motions=[[1,0],[2,0],[5,0],[10,0],[2,1],[5,3],[15,7],...(v.id==='07'?[[15,0],[20,0]]:[])];
  for(const [angle,lift] of motions){
    const scad=`intersection(){import("/coupon.stl");translate([0,-5.05,${v.bodyFloorMm+lift}])rotate([${angle},0,0])translate([0,0,3.5])import("/key.stl");}`;
    const r=await renderScadInNode(scad,{files,allowEmpty:true});
    const overlap=signedVolume(r.stl), clear=overlap<.00001;
    if(angle<=2||lift>0||v.id==='07')assert.ok(clear,`${v.id}: initial pry/lift ${angle} degrees / ${lift} mm intersects by ${overlap} mm3`);
    tiltSamples.push({angleDeg:angle,liftMm:lift,intersectionMm3:overlap,clear});
  }
  Object.assign(checks.find(c=>c.id===v.id)!,{simulation:results,tiltPivot:[0,-5.05,v.bodyFloorMm],tiltSamples});
  manifest.meshChecks=checks;await save();
  console.log(`PASS ${v.id}: ${results.length} actual-mesh checks`);
}
const sourceBytes=await readFile(new URL(import.meta.url));
manifest.scriptSha256=createHash('sha256').update(sourceBytes).digest('hex');
manifest.status='passed';
manifest.print3mf='c-nano-pry-10.3mf';
manifest.printNotes={orientation:'Flat base on bed, all openings upward; do not auto-orient.',objects:10,arrangement:'3 columns / 4 rows, ten separate objects, 10 mm gaps; model extents 140 x 190 mm.',supports:'No generated overhangs or floating islands; native slicer support-free check remains required.',filament:'Select the verified blue filament on the X2D in the native slicer.'};
await save();
await writeFile(`${output}/tilt-simulation.json`,JSON.stringify({
  note:'Additional rigid-body sampled pivot-and-lift simulation against final exported meshes; no physical friction, forces or hand comfort modeled. Rear bowl 07 permits a sampled 20 degree no-lift pivot. For the other variants, large no-lift tilts bind against pocket walls, so lift upward after a small initial pry.',
  results:checks.map(c=>({id:c.id,pivot:c.tiltPivot,samples:c.tiltSamples})),
},null,2)+'\n');
console.log(`PASS all 10 C Nano pry coupons. ${output}/manifest.json`);
