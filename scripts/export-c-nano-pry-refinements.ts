/** Five compact 20-degree C Nano pry refinements. Does not edit production geometry. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { build3mf } from '../src/three-mf';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { renderScadInNode as rawRenderScadInNode, type NodeRenderOptions } from '../src/runtime/node-render';
import type { PartSpec, ProjectGeometry, Vec3 } from '../src/types';

const output='artifacts/c-nano-pry-refinements';
const originals='artifacts/c-nano-pry-samples';
const pivot:Vec3=[0,-5.05,2];
const keyPosition:Vec3=[0,-5.05,5.5];
const rearBounds={min:[-7,-8.2,2],max:[7,-1.58284,8.75]};
const clearances=[.1,.2,.3,.4,.5];
const rendererReceipts:Record<string,unknown>[]=[];
async function renderScadInNode(scad:string,options:NodeRenderOptions={}){
  const result=await rawRenderScadInNode(scad,options);
  const bad=result.logs.filter(line=>/\bERROR\b|CGAL error|assertion violation|failed with error|not valid|Unable to|Can't open import|can't open file/i.test(line));
  rendererReceipts.push({index:rendererReceipts.length+1,scadSha256:createHash('sha256').update(scad).digest('hex'),
    allowEmpty:options.allowEmpty??false,empty:result.stl===null,bytes:result.stl?.byteLength??0,passed:bad.length===0,logs:result.logs});
  if(bad.length){
    await writeFile(`${output}/renderer-receipts.json`,JSON.stringify(rendererReceipts,null,2)+'\n');
    throw new Error(`Renderer error, including an otherwise empty Boolean: ${bad.join('\n')}`);
  }
  return result;
}
const vite=await createServer({configFile:false,logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
const {library}=await vite.ssrLoadModule('/src/geometry/library.ts') as {library:string};
const {buildKeyScad}=await vite.ssrLoadModule('/src/geometry/keys.ts') as {buildKeyScad(type:'CN',component?:'all'|'body'):string};
await vite.close();
await mkdir(output,{recursive:true});
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const body=(await renderScadInNode(buildKeyScad('CN','body'))).stl!;
const key=(await renderScadInNode(buildKeyScad('CN'))).stl!;
await writeFile(`${output}/c-nano-body-reference.stl`,new Uint8Array(body));
await writeFile(`${output}/c-nano-reference.stl`,new Uint8Array(key));
const baseline=await readFile(`${originals}/c-nano-pry-01.stl`);
const original07=await readFile(`${originals}/c-nano-pry-07.stl`);
const referenceFiles={'/c-nano-body-reference.stl':new Uint8Array(body)};

const bodyPoints:Vec3[]=[];
const bodyPointNames=new Set<string>(),bodyView=new DataView(body);
for(let t=0;t<bodyView.getUint32(80,true);t++)for(let v=0;v<3;v++){
  const p=[0,1,2].map(a=>bodyView.getFloat32(96+t*50+v*12+a*4,true)) as Vec3;
  if(!bodyPointNames.has(p.join(','))){bodyPointNames.add(p.join(','));bodyPoints.push(p);}
}
function sweptPolyhedra(clearance:number):string{
  // Minkowski distributes over union. For each convex adjacent-pose cell,
  // the hull of pairwise vertex sums is exactly its polygonal Minkowski sum.
  // Compute it directly to avoid a CGAL failure decomposing the nonconvex union.
  const radius=(clearance+.001)/Math.cos(Math.PI/32),cells:string[]=[];
  for(let start=0;start<20;start++){
    const cloud:Vector3[]=[];
    for(const angle of [start,start+1]){
      const theta=angle*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
      for(const [x,y,z] of bodyPoints)for(let i=0;i<32;i++)for(const up of [-.001,12.001]){
        const phi=i*2*Math.PI/32;
        cloud.push(new Vector3(x+radius*Math.cos(phi),y*c-(z+3.5)*s-5.05+radius*Math.sin(phi),2+y*s+(z+3.5)*c+up));
      }
    }
    const hull=new ConvexGeometry(cloud),attribute=hull.getAttribute('position');
    const points:number[][]=[],indices=new Map<string,number>(),faces:number[][]=[];
    for(let t=0;t<attribute.count;t+=3){
      const face:number[]=[];
      for(let v=0;v<3;v++){
        const p=[attribute.getX(t+v),attribute.getY(t+v),attribute.getZ(t+v)],name=p.join(',');
        let index=indices.get(name);if(index===undefined){index=points.length;indices.set(name,index);points.push(p);}face.push(index);
      }
      // OpenSCAD polyhedron uses inward/right-to-left face ordering.
      faces.push(face.reverse());
    }
    hull.dispose();cells.push(`polyhedron(points=${JSON.stringify(points)},faces=${JSON.stringify(faces)},convexity=10);`);
  }
  return cells.join('\n');
}

function source(id:string,clearance:number):string{return `${library}\n$fn=96;
// Adjacent 1-degree poses form a conservative local approximation after the
// offset. Chord sag is less than 0.0004 mm; the explicit 0.001 mm guard covers it.
// Sweeping each occupied point upward eliminates closed roofs and allows the
// 20-degree key to lift out without enlarging the whole rear cavity to its base.
module rear_relief() {
  intersection() {
    union(){${sweptPolyhedra(clearance)}}
    translate([-7,-8.2,2])cube([14,6.61716,6.75]);
  }
}
module unchanged_nose() {
  intersection() {
    translate([0,7.4,2])cylinder(r=7,h=12);
    translate([-20,1.4,2])cube([40,30,12]);
  }
}
union() {
  difference() {
    slab(40,40,8.6,3);
    body_cut("CN",8.6,false);
    unchanged_nose();
    rear_relief();
  }
  translate([-14,14,8.57])linear_extrude(.63)
    text("${id}",size=4.2,font="Liberation Sans:style=Bold",halign="center",valign="center");
}
`;}
function volume(buffer:ArrayBuffer|null):number{
  if(!buffer)return 0;const d=new DataView(buffer);let sum=0;
  for(let t=0;t<d.getUint32(80,true);t++){
    const [a,b,c]=[0,1,2].map(v=>[0,1,2].map(i=>d.getFloat32(96+t*50+v*12+i*4,true)));
    sum+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }return Math.abs(sum);
}
function bounds(buffer:ArrayBuffer|null){
  if(!buffer)return null;const d=new DataView(buffer),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let t=0;t<d.getUint32(80,true);t++)for(let v=0;v<3;v++)for(let a=0;a<3;a++){
    const p=d.getFloat32(96+t*50+v*12+a*4,true);min[a]=Math.min(min[a],p);max[a]=Math.max(max[a],p);
  }return {min,max,dimensions:max.map((p,a)=>p-min[a])};
}
const variants=clearances.map((clearanceMm,index)=>({
  id:`7${String.fromCharCode(65+index)}`,name:`Compact 20° pry, ${clearanceMm.toFixed(2)} mm clearance`,
  clearanceMm,description:`Original 07 nose and seating, with rear space limited to the upward-open 0–20° body motion envelope plus ${clearanceMm.toFixed(2)} mm working clearance.`,
  label:`7${String.fromCharCode(65+index)}`,stl:`c-nano-pry-7${String.fromCharCode(65+index)}.stl`,
  scad:`c-nano-pry-7${String.fromCharCode(65+index)}.scad`,dimensions:[40,40,9.2],
  keyPosition,pivot,maxPryAngle:20,bodyFloorMm:2,connectorRootFloorMm:4.3,
  nose:{radiusMm:7,centerY:7.4,floorMm:2,clipMinimumY:1.4,unchanged:true},
}));
const manifest:Record<string,unknown>={
  title:'Five compact 20-degree C Nano pry refinements',generatedAt:new Date().toISOString(),status:'rendering',
  units:'mm',variants,sourceLibrarySha256:hash(library),bodyReferenceSha256:hash(new Uint8Array(body)),
  original01Sha256:hash(baseline),original07Sha256:hash(original07),
  rendererReceipts:'renderer-receipts.json',
  method:{reference:'Actual repository CN body mesh generated from nominal_CN; complete CN mesh used for motion tests.',
    constructionStepDegrees:1,validationStepDegrees:.5,sagBoundMm:.0004,extraNumericalGuardMm:.001,
    clearance:'XY disk offset using a circumscribed 32-gon; a 0.001 mm numerical guard covers the angular chord sag. Explicit convex vertex-sum hulls avoid CGAL nonconvex Minkowski decomposition.',
    rearBounds,upwardOpening:'Every swept body point extends upward. The relief therefore has no closed roof and accepts upward removal while tilted.',
    preservation:'Only the allowed rear region is changed below the deck; original pocket, seat, connector-root support and nose are preserved elsewhere.'},
  limitations:[
    'Rigid geometric clearances do not simulate finger comfort, friction, print tolerances or removal force. Compare the actual printed samples.',
    'The reference key is illustrative; no new physical key measurements were taken.',
    'The 20-degree value is the design envelope, not a mechanical stop. Original pocket clearances may allow a little additional motion.',
    'No retention tabs are fitted. Retention and lid compatibility require rechecking before integration into a complete tray.',
    'A small amount of extra space is required to make the motion envelope upward-open and support-free.',
  ],
};
const save=async()=>{
  await writeFile(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
  await writeFile(`${output}/renderer-receipts.json`,JSON.stringify(rendererReceipts,null,2)+'\n');
};
await save();
const meshes=new Map<string,ArrayBuffer>();
const project:ProjectGeometry={parts:[],keys:[],dimensions:[90,140,9.2]};
const checks:Record<string,unknown>[]=[];
for(const v of variants){
  const scad=source(v.id,v.clearanceMm),id=`c-nano-pry-${v.id}`;
  const {stl,logs}=await renderScadInNode(scad,{files:referenceFiles,timeoutMs:240000});assert.ok(stl);
  assert.ok(!logs.some(line=>/CGAL error|assertion violation|ERROR:|failed with error/i.test(line)),logs.join('\n'));
  const mesh=inspectPrintableMesh(stl);assert.deepEqual(mesh.min,[-20,-20,0]);
  const gateFiles={'/coupon.stl':new Uint8Array(stl),'/key.stl':new Uint8Array(key),'/baseline.stl':new Uint8Array(baseline)};
  const gateMotion=await renderScadInNode('intersection(){import("/coupon.stl");translate([0,-5.05,2])rotate([20,0,0])translate([0,0,3.5])import("/key.stl");}',{files:gateFiles,allowEmpty:true});
  assert.ok(volume(gateMotion.stl)<.00001,`${v.id}: gate20-degree pose blocked`);
  const gateRemoval=await renderScadInNode('intersection(){translate([-20,-20,.001])cube([40,40,8.598]);difference(){import("/baseline.stl");import("/coupon.stl");}}',{files:gateFiles,allowEmpty:true});
  assert.ok(volume(gateRemoval.stl)>10,`${v.id}: intended rear relief is absent or too small`);
  const part:PartSpec={id,name:`${v.id} - ${v.name}`,scad,position:[0,0,0],rotation:[0,0,0],explode:[0,0,0],color:'#187bd1'};
  meshes.set(id,stl);project.parts.push(part);project.keys.push({slotId:v.id,type:'CN',position:keyPosition,rotation:[0,0,0],partId:id});
  await writeFile(`${output}/${v.stl}`,new Uint8Array(stl));await writeFile(`${output}/${v.scad}`,scad);
  checks.push({id:v.id,mesh,stlSha256:hash(new Uint8Array(stl))});
  console.log(`Rendered ${v.id}: ${mesh.triangles} triangles`);
}
const threeMf=build3mf(project,meshes,{title:'Five compact C Nano 20-degree pry refinements'});
await writeFile(`${output}/c-nano-pry-five.3mf`,threeMf);
manifest.status='meshes exported; motion validation running';manifest.meshChecks=checks;manifest.threeMfSha256=hash(threeMf);await save();
console.log(`3MF READY ${output}/c-nano-pry-five.3mf sha256 ${hash(threeMf)}`);
const deckClip='translate([-20,-20,.001])cube([40,40,8.598]);';
const oldRemoved=await renderScadInNode(`intersection(){${deckClip}difference(){import("/baseline.stl");import("/old07.stl");}}`,{files:{'/baseline.stl':new Uint8Array(baseline),'/old07.stl':new Uint8Array(original07)},allowEmpty:true});
const originalRearVoidMm3=volume(oldRemoved.stl);
manifest.original07ExtraRearVoidMm3=originalRearVoidMm3;

for(const v of variants){
  const files={...referenceFiles,'/coupon.stl':new Uint8Array(meshes.get(`c-nano-pry-${v.id}`)!),'/key.stl':new Uint8Array(key),'/baseline.stl':new Uint8Array(baseline),'/old07.stl':new Uint8Array(original07)};
  const assertions:Record<string,unknown>[]=[];
  async function empty(name:string,scad:string){
    const r=await renderScadInNode(scad,{files,allowEmpty:true});const mm3=volume(r.stl);
    assert.ok(mm3<.00001,`${v.id} ${name}: ${mm3} mm3`);assertions.push({name,passed:true,intersectionOrMissingMm3:mm3});
  }
  const motion:Record<string,unknown>[]=[];
  async function motionPose(angle:number,lift:number){
    const scad=`intersection(){import("/coupon.stl");translate([0,-5.05,${2+lift}])rotate([${angle},0,0])translate([0,0,3.5])import("/key.stl");}`;
    const r=await renderScadInNode(scad,{files,allowEmpty:true});const overlap=volume(r.stl);
    assert.ok(overlap<.00001,`${v.id}: ${angle} degrees / lift ${lift} intersects by ${overlap} mm3`);
    motion.push({angleDeg:angle,liftMm:lift,intersectionMm3:overlap,clear:true});
  }
  for(let a=0;a<=20;a+=.5)await motionPose(a,0);
  for(const lift of [.25,.5,1,2,4,7,10])await motionPose(20,lift);
  await empty('continuous 2 mm floor',`${library}\ndifference(){translate([0,0,.001])linear_extrude(1.998)offset(delta=-.001)rr(40,40,3);import("/coupon.stl");}`);
  await empty('original body and connector support pads','difference(){union(){for(x=[-3,3])translate([x,-2.5,1.9])cylinder(r=.55,h=.099,$fn=24);translate([0,0,4.2])cube([3,1.2,.099]);}import("/coupon.stl");}');
  await empty('exact original07 nose below deck','intersection(){translate([-20,1.4,.001])cube([40,18.6,8.598]);union(){difference(){import("/coupon.stl");import("/old07.stl");}difference(){import("/old07.stl");import("/coupon.stl");}}}');
  await empty('no outside-rear changes below deck',`difference(){intersection(){${deckClip}union(){difference(){import("/coupon.stl");import("/baseline.stl");}difference(){import("/baseline.stl");import("/coupon.stl");}}}translate([-7,-8.2,1.999])cube([14,6.61716,6.752]);}`);
  await empty('unchanged nose 6 mm nail route','intersection(){import("/coupon.stl");translate([-3,3.2,3.3])cube([6,8.8,.8]);}');
  await empty('unchanged nose 9 mm finger-pad gauge',`intersection(){union(){import("/coupon.stl");translate(${JSON.stringify(keyPosition)})import("/key.stl");}translate([0,9.6,6.6])sphere(r=4.5,$fn=64);}`);
  const removed=await renderScadInNode(`intersection(){${deckClip}difference(){import("/baseline.stl");import("/coupon.stl");}}`,{files,allowEmpty:true});
  const extraRearVoidMm3=volume(removed.stl);
  assert.ok(extraRearVoidMm3>0&&extraRearVoidMm3<originalRearVoidMm3*.15,'Compact relief should remove far less material than the original07 bowl');
  Object.assign(checks.find(c=>c.id===v.id)!,{assertions,motion,extraRearVoidMm3,rearVoidReductionPercent:100*(1-extraRearVoidMm3/originalRearVoidMm3),actualRearReliefBounds:bounds(removed.stl)});
  manifest.meshChecks=checks;await save();
  console.log(`PASS ${v.id}: ${motion.length} motion poses, ${assertions.length} preservation/access checks; rear void ${extraRearVoidMm3.toFixed(3)} mm3 (${(100*(1-extraRearVoidMm3/originalRearVoidMm3)).toFixed(1)}% less than07)`);
}
manifest.status='passed';manifest.scriptSha256=hash(await readFile(new URL(import.meta.url)));
manifest.print3mf='c-nano-pry-five.3mf';
manifest.printNotes={objects:5,orientation:'Opening upward, base at Z=0; no automatic reorientation.',sourcePrintSettings:'Portable source export retains current repository settings. Native print derivation should use verified printer/material and 15% infill without a brim.',supports:'Rear relief is open from above; native slicer audit still required.'};
await save();
console.log('PASS all five compact C Nano pry refinements.');
