import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { defaultConfig } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import type { HolderConfig, ProjectGeometry } from '../src/types';
await mkdir('artifacts', { recursive: true });

const v=await createServer({configFile:false,logLevel:'silent',server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
const {buildProject,buildKeyScad}=await v.ssrLoadModule('/src/geometry/index.ts') as {buildProject(c:HolderConfig):ProjectGeometry;buildKeyScad(k:string):string};
const {library}=await v.ssrLoadModule('/src/geometry/library.ts');await v.close();
const reference=(await renderScadInNode(buildKeyScad('CI'))).stl!;
const checks:object[]=[];
function volume(b:ArrayBuffer|null){if(!b)return 0;const d=new DataView(b);let s=0;for(let t=0;t<d.getUint32(80,true);t++){const [a,b,c]=[0,1,2].map(v=>[0,1,2].map(i=>d.getFloat32(96+t*50+v*12+i*4,true)));s+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return Math.abs(s);}
for(const retention of [false,true])for(const connection of ['none','snap_fit'] as const){
 const c=defaultConfig();c.template='inventory_tray';c.labels=false;c.slots=[{id:'ci',type:'CI',label:'5Ci',occupied:true}];Object.assign(c.options.tray,{connection,retention,lid:true,scoop:'default',columns:3,spacing:24,rowGap:2});
 const p=buildProject(c),key=p.keys[0],tray=(await renderScadInNode(p.parts[0].scad)).stl!;inspectPrintableMesh(tray);
 const files={'/key.stl':new Uint8Array(reference),'/tray.stl':new Uint8Array(tray)};
 for(const angle of [0,180]){
  // Reference origin is at the connector tip, not the centred pocket datum.
  const source=`intersection(){import("/tray.stl");translate([${key.position[0]},${key.position[1]+40.3/2},${key.position[2]}])rotate([0,0,${angle}])translate([0,-20.15,0])import("/key.stl");}`;
  const result=await renderScadInNode(source,{files,allowEmpty:true});
  assert.ok(volume(result.stl)<.00001,`${connection}, retention ${retention}, orientation ${angle}: key collision`);
  checks.push({connection,retention,angle,clear:true,intersectionMm3:volume(result.stl)});
 }
 // A direct lower slab probes the whole symmetric silhouette at 2 mm below
 // its floor, rather than only sampling the original connector end.
 const floor=`${library}\ndifference(){translate([${key.position[0]},${key.position[1]+20.15},2.001])linear_extrude(1.998)union(){for(a=[0,180])rotate([0,0,a])translate([0,-20.8])offset(delta=-.001)polygon(body_pts("CI"));}import("/tray.stl");}`;
 const result=await renderScadInNode(floor,{files,allowEmpty:true});assert.equal(result.stl,null,'Less than 2 mm floor under the reversible pocket');
}
await writeFile('artifacts/reversible-ci-validation.json',JSON.stringify({status:'passed',librarySha256:createHash('sha256').update(library).digest('hex'),checks,reference:'Complete illustrative 5Ci body, both connectors and side contacts; physical fit still requires a print.'},null,2));
console.log('PASS reversible 5Ci:',checks.length,'full-reference orientation checks and 4 complete floor checks');
