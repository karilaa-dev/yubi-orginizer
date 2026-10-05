/** Standalone review viewer, using the exported coupon meshes without modifying them. */
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const out = process.argv[2] ?? 'artifacts/c-nano-pry-samples';
const refined = out.includes('refinements');
const manifest = JSON.parse(await readFile(`${out}/manifest.json`, 'utf8'));
const rows = manifest.variants ?? manifest.samples;
const variants = await Promise.all(rows.map(async (v) => ({
  ...v,
  description: refined ? `${v.clearanceMm.toFixed(2)} mm of clearance around the key’s 20° pry movement. The USB-C finger opening and the key’s resting height stay the same.` : v.description,
  mesh: (await readFile(`${out}/${v.stlFile ?? v.stl ?? `${v.id}.stl`}`)).toString('base64'),
})));
const keys = await Promise.all(['body', 'connector', 'touch'].map(async (part) => ({
  part, mesh: (await readFile(`public/keys/CN-${part}.stl`)).toString('base64'),
})));
const comparison = refined ? {
  name: 'Original 07 · large rear bowl',
  mesh: (await readFile('artifacts/c-nano-pry-samples/c-nano-pry-07.stl')).toString('base64'),
} : null;
const eyebrow = refined ? 'Option 7 refined · five clearances' : 'Physical fit experiment · 01—10';
const title = refined ? 'C Nano · five compact pry samples' : 'C Nano · ten pry samples';
const note = refined
  ? 'All five follow the key’s 0–20° pry path, with a small allowance for fit. The USB-C finger opening is unchanged. These are geometry checks; actual feel requires a printed sample.'
  : 'Exact exported meshes and reference key. Sample 07 clears a 20° initial pivot; others allow a small 2° pry followed by upward lift. These are sampled geometry checks. Finger comfort and grip force require physical testing.';
const { outputFiles } = await build({
  stdin: {
    contents: `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
const data=JSON.parse(document.getElementById('data').textContent);
const main=document.querySelector('main'), select=document.querySelector('select');
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setClearColor(0xeaf0f4);
main.append(renderer.domElement);
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(34,1,.1,1000);
camera.up.set(0,0,1); camera.position.set(45,58,65);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,4);
let aspectFit=1;
function fitAspect(){const next=Math.max(1,1.4/camera.aspect);camera.position.sub(controls.target).multiplyScalar(next/aspectFit).add(controls.target);aspectFit=next;controls.update();}
function setView(position,target){camera.position.set(...position);controls.target.set(...target);aspectFit=1;fitAspect();}
scene.add(new THREE.HemisphereLight(0xffffff,0x4b5c70,2.5));
const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-30,35,80);scene.add(light);
const fill=new THREE.DirectionalLight(0xffffff,1);fill.position.set(50,-30,35);scene.add(fill);
const loader=new STLLoader(), group=new THREE.Group(), key=new THREE.Group();scene.add(group,key);
function geometry(b64){const bytes=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));return loader.parse(bytes.buffer);}
const parts=data.variants.map(v=>new THREE.Mesh(geometry(v.mesh),new THREE.MeshStandardMaterial({color:0x246bd4,roughness:.65,metalness:.03})));
const original=data.comparison?new THREE.Mesh(geometry(data.comparison.mesh),new THREE.MeshStandardMaterial({color:0x8198ac,roughness:.65})):null;
const colors={body:0x242a31,connector:0xb4bec9,touch:0xc9a14f};
for(const k of data.keys)key.add(new THREE.Mesh(geometry(k.mesh),new THREE.MeshStandardMaterial({color:colors[k.part],roughness:k.part==='body'?.7:.3,metalness:k.part==='body'?0:.7})));
for(let i=0;i<data.variants.length;i++){const v=data.variants[i],o=document.createElement('option');o.value=i;o.textContent=v.id+' · '+(v.clearanceMm===undefined?v.name:v.clearanceMm.toFixed(2)+' mm clearance');select.append(o);}
let current;const lift=document.querySelector('#lift'), pry=document.querySelector('#pry'), toggle=document.querySelector('#show-key'), compare=document.querySelector('#compare-original');
function pose(){const p=current.keyPosition??[0,-5.05,5.5+(current.raiseMm??0)];const a=Number(pry.value)*Math.PI/180;key.rotation.x=a;key.position.set(p[0],p[1]-3.5*Math.sin(a),p[2]-3.5+3.5*Math.cos(a)+Number(lift.value));key.visible=toggle.checked;document.querySelector('#lift-value').textContent=Number(lift.value).toFixed(1)+' mm';document.querySelector('#pry-value').textContent=Number(pry.value).toFixed(0)+'°';}
function showPart(){group.clear();group.add(compare?.checked&&original?original:parts[Number(select.value)]);document.querySelector('#description').textContent=compare?.checked?'Original 07: the large rear bowl, before trimming to the key’s motion.':current.description??current.intent??'';}
function choose(){const i=Number(select.value);current=data.variants[i];if(compare)compare.checked=false;showPart();pry.max=String(current.maxPryAngle??(current.id==='07'?20:2));pry.value=String(data.initialPryAngle??0);lift.value='0';pose();}
select.addEventListener('change',choose);lift.addEventListener('input',pose);pry.addEventListener('input',pose);toggle.addEventListener('change',pose);
compare?.addEventListener('change',showPart);
document.querySelector('#top').onclick=()=>setView([0,.01,94],[0,0,0]);
document.querySelector('#iso').onclick=()=>setView([45,58,65],[0,0,4]);
document.querySelector('#rear').onclick=()=>setView([32,-55,45],[0,-1,4]);
new ResizeObserver(()=>{const w=main.clientWidth,h=main.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();fitAspect();}).observe(main);
choose();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
document.body.dataset.ready='true';`,
    resolveDir: process.cwd(), sourcefile: 'c-nano-pry-viewer.js', loader: 'js',
  },
  bundle: true, minify: true, write: false, format: 'iife', platform: 'browser',
});
const data = JSON.stringify({ variants, keys, comparison, initialPryAngle: refined ? 20 : 0 }).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>*{box-sizing:border-box}body{margin:0;display:grid;grid-template-columns:320px 1fr;height:100vh;background:#eaf0f4;color:#eaf0f4;font:15px/1.55 system-ui,sans-serif}aside{padding:30px 26px;background:#162638;overflow:auto}small{color:#90abc6;text-transform:uppercase;letter-spacing:.12em;font-size:11px}h1{font-size:30px;line-height:1.15;margin:12px 0 25px;font-weight:620}p{color:#b8c9d8}select,button{font:inherit;border:1px solid #52677d;background:#243b53;color:white;border-radius:7px;padding:10px;max-width:100%}select{width:100%;margin:10px 0}label{display:block;margin:22px 0 9px}input[type=range]{width:100%;accent-color:#79b4ff}button{cursor:pointer}button:hover{background:#365978}output{float:right;font-variant-numeric:tabular-nums;color:#93c2ff}.buttons{display:flex;gap:8px;margin-top:25px}.note{font-size:12px;margin-top:32px}main{min-width:0;min-height:0;position:relative}main canvas{display:block}.hint{position:absolute;bottom:18px;left:20px;color:#4c657a;font-size:12px;pointer-events:none}@media(max-width:700px){body{grid-template-columns:1fr;grid-template-rows:auto 1fr}aside{padding:18px}h1{font-size:23px;margin:5px 0 12px}label{margin:9px 0}.note,.hint{display:none}.buttons{margin:10px 0}}</style>
<style>@media(min-width:701px) and (max-height:800px){aside{padding:18px 22px}h1{font-size:26px;margin:8px 0 16px}label{margin:14px 0 6px}.buttons{margin-top:16px}.note{margin-top:18px;font-size:11px}p{margin:10px 0}}</style>
<style>.buttons{flex-wrap:wrap;gap:6px}.buttons button{font-size:13px;padding:8px}.compare{font-size:13px;color:#c0d3e5}@media(min-width:701px) and (max-height:800px){label{margin-top:11px}.note{margin-top:14px}}</style>
<aside><small>${eyebrow}</small><h1>C Nano<br>Finger access</h1><select aria-label="Pry variant"></select><p id="description"></p>${refined?'<label class="compare"><input id="compare-original" type="checkbox"> Compare original 07</label>':''}<label><input id="show-key" type="checkbox" checked> Show reference key</label><label for="pry">Initial pry <output id="pry-value">0°</output></label><input id="pry" type="range" min="0" max="20" step="1" value="0"><label for="lift">Then lift <output id="lift-value">0.0 mm</output></label><input id="lift" type="range" min="0" max="14" step="0.1" value="0"><div class="buttons"><button id="iso">Angled view</button><button id="rear">Rear view</button><button id="top">Top view</button></div><p class="note">${note}</p></aside><main><span class="hint">Drag to orbit · Scroll to zoom · Blue parts are printed; the key is a reference</span></main>
<script id="data" type="application/json">${data}</script><script>${outputFiles[0].text}</script></html>`;
await writeFile(`${out}/review.html`, html);
console.log(`${out}/review.html`);
