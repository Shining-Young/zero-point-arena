import * as THREE from 'three';
import { OBSTACLES } from './rules';

const material=(color:number,metalness=0,roughness=.8)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
export function box(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,mat:THREE.Material){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function label(text:string,color='#cdd5d5',bg='#263b41',width=512,height=256){
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
  ctx.fillStyle=color;ctx.font=`bold ${Math.round(height*.52)}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height/2);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map:texture,roughness:.9});
}
function floorTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d')!;
  ctx.fillStyle='#737c7c';ctx.fillRect(0,0,512,512);
  let seed=197;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<20000;i++){const v=Math.floor(90+rnd()*80);ctx.fillStyle=`rgba(${v},${v},${v},.16)`;ctx.fillRect(rnd()*512,rnd()*512,rnd()*3+1,1);}
  ctx.strokeStyle='#606969';ctx.lineWidth=2;ctx.strokeRect(0,0,512,512);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(12,12);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export function buildWorld(scene:THREE.Scene){
  scene.background=new THREE.Color(0xa4b8bd);scene.fog=new THREE.Fog(0xa4b8bd,35,100);
  scene.add(new THREE.HemisphereLight(0xd8f3ff,0x686656,2.0));
  const sun=new THREE.DirectionalLight(0xffdfb6,3.2);sun.position.set(-20,32,15);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:1,far:100});sun.shadow.bias=-.0008;scene.add(sun);
  const concrete=material(0x87928f),dark=material(0x2a373b,.35),trim=material(0x4c5e63,.4),orange=material(0xeab15b),blue=material(0x345665,.45),wood=material(0x8a7253);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(220,220),new THREE.MeshStandardMaterial({map:floorTexture(),roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const solid:THREE.Object3D[]=[];
  // All solid geometry is represented by the same obstacle data used by combat and navigation.
  OBSTACLES.forEach((o,i)=>{
    let mat=o.kind==='container'?(i===0?blue:material(0x7d5946,.3)):o.kind==='crate'?wood:concrete;
    const body=box(scene,o.w,o.h,o.d,o.x,o.h/2,o.z,mat);solid.push(body);
    if(o.kind==='container'){
      for(let z=-o.d/2+.3;z<o.d/2;z+=.48){
        box(scene,.1,o.h-.2,.08,o.x-o.w/2-.03,o.h/2,o.z+z,trim);
        box(scene,.1,o.h-.2,.08,o.x+o.w/2+.03,o.h/2,o.z+z,trim);
      }
      for(const s of [-1,1]){
        box(scene,o.w+.1,.13,o.d+.12,o.x,o.h/2+s*(o.h/2-.06),o.z,dark);
        const door=box(scene,o.w/2-.1,o.h-.2,.08,o.x+s*o.w/4,o.h/2,o.z+o.d/2+.04,mat);
        box(door,.055,o.h-.5,.08,0,0,.07,orange);
      }
      box(scene,2.5,.8,.025,o.x,2.6,o.z+o.d/2+.1,label(i===0?'NORD 07':'SECTOR 02'));
    }else if(o.kind==='crate'){
      for(const s of [-1,1]){
        box(scene,o.w+.04,.18,o.d+.05,o.x,o.h/2+s*(o.h/2-.18),o.z,dark);
        box(scene,.15,o.h+.02,o.d+.05,o.x+s*(o.w/2-.2),o.h/2,o.z,trim);
      }
      box(scene,.8,.65,.02,o.x,o.h*.65,o.z+o.d/2+.04,label('↑↑','#232e32','#b8a480'));
    }else if(o.kind==='barrier'){
      box(scene,o.w+.03,.25,o.d+.03,o.x,o.h-.35,o.z,orange);
      for(let x=-o.w/2+.4;x<o.w/2;x+=.8)box(scene,.3,.26,.03,o.x+x,o.h-.35,o.z+o.d/2+.025,dark);
    }else{
      box(scene,o.w+.08,.15,o.d+.08,o.x,o.h*.65,o.z,trim);
      box(scene,o.w+.08,.15,o.d+.08,o.x,o.h*.25,o.z,trim);
    }
  });
  // Perimeter warehouse architecture.
  solid.push(box(scene,49,8,1,0,4,-24,concrete));
  solid.push(box(scene,1,7,49,-24,3.5,0,concrete));
  solid.push(box(scene,1,7,49,24,3.5,0,concrete));
  solid.push(box(scene,49,5,1,0,2.5,24,concrete));
  for(const x of [-20,-12,-4,4,12,20]){
    box(scene,.35,8.5,.65,x,4.25,-23.4,dark);
    box(scene,6,2,.12,x,6.1,-23.4,material(0x445f68,.35,.3));
    box(scene,.1,2,.15,x,6.1,-23.2,trim);
    box(scene,6,.1,.15,x,6.1,-23.2,trim);
  }
  box(scene,49,.5,2,0,8.2,-23.2,trim);
  box(scene,9,4.5,.2,12,2.25,-23.35,dark);
  for(let y=.2;y<4.5;y+=.28)box(scene,8.8,.045,.08,12,y,-23.2,trim);
  box(scene,5,1.4,.03,-11,3.7,-23.35,label('DEPOT 07','#e8e8df','#26383e'));
  box(scene,2,2,.02,-20,2.8,-23.3,label('A','#f0b764','#354b52'));
  for(const x of [-23.35,23.35])for(const z of [-18,-10,-2,6,14,22]){
    box(scene,.35,7.3,.35,x,3.65,z,dark);
    box(scene,.1,1.9,5,x,5.2,z,material(0x50666d,.4));
  }
  for(const z of [-19,19]){
    box(scene,36,.015,.09,0,.014,z,orange);
    for(let x=-18;x<=18;x+=4)box(scene,.08,.018,2.2,x,.014,z+(z>0?-1:1),orange);
  }
  for(const z of [-12,12]){
    box(scene,.45,11,.45,-22,5.5,z,trim);box(scene,43,.42,.45,0,10.8,z,trim);box(scene,.45,11,.45,22,5.5,z,trim);
    for(const x of [-13,0,13])box(scene,2.4,.12,.8,x,10.45,z,new THREE.MeshStandardMaterial({color:0xf0e5c4,emissive:0xf0d9ac,emissiveIntensity:1}));
  }
  // Background silhouettes give the depot a larger setting.
  for(let i=0;i<10;i++)box(scene,8+i%3,12+i%4*3,9,-42+i*10,6+i%4*1.5,-40,material(0x6e8389));
  return {solid};
}
export function makeRifle(pistol=false){
  const g=new THREE.Group(),metal=material(0x242c30,.7,.35),black=material(0x10191d,.25),edge=material(0x536069,.7,.3),orange=material(0xebaa55,.2);
  if(pistol){
    box(g,.115,.13,.4,0,0,0,metal);box(g,.12,.2,.13,0,-.14,.11,black).rotation.x=-.25;
    box(g,.105,.04,.32,0,.085,-.02,edge).name='slide';box(g,.13,.025,.05,0,.11,.12,orange);
  }else{
    box(g,.16,.2,.53,0,0,0,metal);box(g,.13,.16,.45,0,.015,-.46,black);
    box(g,.06,.065,.36,0,.02,-.83,metal);box(g,.085,.08,.1,0,.02,-1.02,edge);
    box(g,.13,.22,.22,0,-.15,.38,black);box(g,.14,.13,.28,0,-.02,.29,black);
    const magazine=box(g,.105,.3,.17,0,-.24,-.06,metal);magazine.rotation.x=-.17;magazine.name='magazine-body';
    box(g,.095,.22,.12,0,-.19,.16,black).rotation.x=-.22;
    box(g,.18,.025,.46,0,.12,-.03,edge);
    for(let i=0;i<9;i++)box(g,.18,.018,.013,0,.14,-.22+i*.05,black);
    box(g,.09,.08,.09,0,.18,-.12,black);box(g,.032,.04,.022,0,.23,-.12,orange);
    box(g,.17,.045,.09,0,.065,-.19,orange);
    for(let i=0;i<5;i++)box(g,.137,.018,.025,0,.105,-.3-i*.065,edge);
  }
  return g;
}
export function makeSoldier(index:number,weapon:'pistol'|'smg'|'shotgun'|'rifle'|'sniper'='pistol'){
  const root=new THREE.Group(),suit=material(index%2?0x656f64:0x64757a),vest=material(0x293a41),skin=material(0xa99e89),black=material(0x18272d),accent=material(0xef704e);
  const torso=box(root,.68,.68,.35,0,1.17,0,suit);torso.userData.hit='body';
  box(root,.6,.47,.13,0,1.23,-.23,vest);box(root,.52,.07,.14,0,1.41,-.26,accent);
  for(const x of [-.17,.17])box(root,.14,.17,.08,x,1.12,-.32,vest);
  const head=box(root,.38,.36,.36,0,1.72,0,skin);head.userData.hit='head';
  box(root,.43,.23,.43,0,1.85,0,vest);box(root,.34,.12,.055,0,1.75,-.2,black);
  const legs=[new THREE.Group(),new THREE.Group()];
  legs.forEach((leg,i)=>{leg.position.set(i===0?-.19:.19,.86,0);box(leg,.26,.72,.28,0,-.35,0,suit);box(leg,.29,.16,.43,0,-.77,-.065,black);root.add(leg);});
  const armL=box(root,.23,.55,.25,-.43,1.13,-.06,suit);armL.rotation.x=-.7;
  const armR=box(root,.23,.5,.25,.4,1.18,-.16,suit);armR.rotation.x=-1;
  const gun=makeWeapon(weapon);gun.name='held-weapon';gun.scale.setScalar(.7);gun.position.set(.25,1.23,-.35);root.add(gun);
  // A generous body volume keeps low-poly limbs from creating frustrating gaps.
  const hitbox=new THREE.Mesh(new THREE.BoxGeometry(.85,1.48,.5),new THREE.MeshBasicMaterial({visible:false}));hitbox.position.y=.79;hitbox.userData.hit='body';root.add(hitbox);
  return {root,legs,gun,targets:[head,hitbox],muzzle:new THREE.Vector3(.25,1.25,{pistol:-.5,smg:-.9,shotgun:-1.2,rifle:-1.08,sniper:-1.4}[weapon])};
}

/** Distinct silhouettes and movable action parts for the five-gun armory. */
export function makeWeapon(id:'pistol'|'smg'|'shotgun'|'rifle'|'sniper'){
 if(id==='rifle'||id==='pistol'){
  const gun=makeRifle(id==='pistol');gun.userData.weapon=id;
  const detail=material(id==='pistol'?0x9cadb5:0xd9aa65,.65,.3);
  box(gun,.018,.055,id==='pistol'?.22:.38,.086,.03,-.1,detail);
  const action=new THREE.Group();action.name='action';gun.add(action);box(action,.06,.055,.1,.095,.03,.01,detail);
  const mag=new THREE.Group();mag.name='magazine';gun.add(mag);const original=gun.getObjectByName('magazine-body');if(original){gun.remove(original);mag.add(original);}else box(mag,.095,.14,.12,0,-.29,.1,material(0x2e3c45,.5));const slide=gun.getObjectByName('slide');if(slide){gun.remove(slide);action.add(slide);}
  return gun;
 }
 const gun=new THREE.Group();gun.userData.weapon=id;
 const metal=material(0x222e37,.75,.32),polymer=material(id==='smg'?0x627367:id==='shotgun'?0x8e6845:0x686b55,.1),edge=material(0xa7b8bd,.8,.24),black=material(0x10191d,.2);
 const barrel=id==='smg'?.7:id==='shotgun'?1.2:1.48;
 box(gun,id==='shotgun'?.17:.14,.18,.52,0,0,-.02,metal);
 box(gun,.12,.15,.3,0,-.02,.37,polymer);box(gun,.14,.25,.08,0,-.08,.55,black);
 box(gun,.10,.22,.13,0,-.18,.16,polymer).rotation.x=-.2;
 box(gun,.055,.06,barrel-.18,0,.02,-barrel/2-.17,metal);box(gun,.085,.09,.12,0,.02,-barrel,black);
 const action=new THREE.Group();action.name='action';gun.add(action);
 const magazine=new THREE.Group();magazine.name='magazine';gun.add(magazine);
 if(id==='smg'){
  box(gun,.17,.14,.35,0,0,-.4,polymer);box(magazine,.085,.33,.13,0,-.24,-.08,black);
  box(gun,.09,.1,.08,0,.13,-.18,black);box(gun,.035,.022,.025,0,.19,-.18,edge);
  for(let i=0;i<5;i++)box(gun,.177,.016,.018,0,.08,-.29-i*.04,edge);
  box(action,.055,.04,.1,.1,.04,-.02,edge);
 }else if(id==='shotgun'){
  box(gun,.07,.07,.76,0,-.07,-.63,metal);box(action,.19,.18,.35,0,-.04,-.55,polymer);
  for(let i=0;i<6;i++)box(action,.196,.018,.02,0,.03,-.41-i*.05,black);
  for(let i=0;i<4;i++)box(gun,.055,.08,.08,.12,.02,.13-i*.09,material(0xbd5541,.1));
  box(gun,.035,.06,.035,0,.085,-1.05,edge);
 }else{
  box(gun,.14,.15,.52,0,-.025,-.5,polymer);box(magazine,.11,.19,.19,0,-.19,-.06,black);
  box(gun,.075,.09,.24,0,.13,-.16,metal);
  const scope=new THREE.Mesh(new THREE.CylinderGeometry(.082,.082,.43,16),black);scope.rotation.x=Math.PI/2;scope.position.set(0,.24,-.18);gun.add(scope);
  const lens=new THREE.Mesh(new THREE.CircleGeometry(.072,16),new THREE.MeshStandardMaterial({color:0x64b7c5,metalness:.8,roughness:.15}));lens.position.set(0,.24,.037);gun.add(lens);
  box(action,.16,.025,.035,.105,.07,.11,edge);box(action,.055,.075,.055,.19,.04,.11,black);
  for(const x of [-.1,.1])box(gun,.025,.32,.025,x,-.15,-.78,metal).rotation.z=x>0?-.25:.25;
 }
 return gun;
}
export function animateWeapon(gun:THREE.Object3D,reloadProgress:number,cycling:number){
 const action=gun.getObjectByName('action'),magazine=gun.getObjectByName('magazine'),id=gun.userData.weapon;
 if(action)action.position.z=Math.sin(Math.max(0,Math.min(1,cycling))*Math.PI)*(id==='shotgun'?.18:id==='sniper'?.12:.035);
 if(magazine)magazine.position.y=reloadProgress<1?-Math.sin(reloadProgress*Math.PI)*.28:0;
}

export function setSoldierWeapon(actor:ReturnType<typeof makeSoldier>,weapon:'pistol'|'smg'|'shotgun'|'rifle'|'sniper'){
 if(actor.gun.userData.weapon===weapon)return;
 actor.root.remove(actor.gun);const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();actor.gun.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
 const next=makeWeapon(weapon);next.position.copy(actor.gun.position);next.scale.copy(actor.gun.scale);actor.gun=next;actor.root.add(next);
 actor.muzzle.z={pistol:-.5,smg:-.9,shotgun:-1.2,rifle:-1.08,sniper:-1.4}[weapon];
}
