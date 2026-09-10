import * as THREE from 'three';
import {lineClear,type Obstacle} from './rules.ts';
type Point3={x:number;y:number;z:number};
export function canShowActorLabel(eye:Point3,position:Point3,alive:boolean,obstacles?:Obstacle[]){
 return alive&&Math.hypot(position.x-eye.x,position.y-eye.y,position.z-eye.z)<25&&lineClear(eye,{x:position.x,y:position.y+1,z:position.z},obstacles);
}
/** One reusable nameplate and shield per actor, no through-wall overlay. */
export class ActorFeedback{
 private label:HTMLDivElement;private shield:THREE.Mesh<THREE.CapsuleGeometry,THREE.MeshBasicMaterial>;
 private band:THREE.Mesh;private materials:THREE.MeshStandardMaterial[]=[];
 private hitUntil=0;private shieldUntil=0;private projected=new THREE.Vector3();private eye=new THREE.Vector3();
 constructor(private root:THREE.Group,private container:HTMLElement,private nickname:string,private isBot:boolean){
  root.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof THREE.MeshStandardMaterial&&!this.materials.includes(material))this.materials.push(material);});
  this.shield=new THREE.Mesh(new THREE.CapsuleGeometry(.62,1.1,4,12),new THREE.MeshBasicMaterial({color:0x87dfff,transparent:true,opacity:.12,depthWrite:false}));this.shield.position.y=1;this.shield.visible=false;root.add(this.shield);
  this.band=new THREE.Mesh(new THREE.BoxGeometry(.245,.12,.27),new THREE.MeshStandardMaterial({color:isBot?0xffa15b:0x77d7e8,emissive:isBot?0x442000:0x103b44}));this.band.position.set(-.43,1.25,-.06);root.add(this.band);
  this.label=document.createElement('div');Object.assign(this.label.style,{position:'absolute',top:'0',left:'0',pointerEvents:'none',whiteSpace:'nowrap',maxWidth:'210px',overflow:'hidden',textOverflow:'ellipsis',padding:'4px 8px',borderRadius:'4px',background:'rgba(10,20,26,.78)',color:isBot?'#ffc08c':'#9beafa',font:'600 12px sans-serif',border:'1px solid currentColor',display:'none'});container.appendChild(this.label);
 }
 hit(shield=false){if(shield)this.shieldUntil=performance.now()+180;else this.hitUntil=performance.now()+150;}
 update(camera:THREE.Camera,alive:boolean,protection:number,crouched=false){
  const now=performance.now(),hit=now<this.hitUntil;
  for(const material of this.materials){material.emissive.setHex(hit?0xe84016:0);material.emissiveIntensity=hit?.8:0;}
  this.shield.visible=alive&&protection>0;this.shield.material.opacity=now<this.shieldUntil?.45:.12;
  camera.getWorldPosition(this.eye);const pos=this.root.position;
  const text=`${protection>0?'◇ 保护 · ':''}${this.nickname} · ${this.isBot?'NPC':'玩家'}`;if(this.label.textContent!==text)this.label.textContent=text;
  this.projected.set(pos.x,pos.y+(crouched?1.65:2.35),pos.z).project(camera);
  const visible=canShowActorLabel(this.eye,pos,alive)&&this.projected.z>=-1&&this.projected.z<=1&&Math.abs(this.projected.x)<=1&&Math.abs(this.projected.y)<=1;
  this.label.style.display=visible?'block':'none';
  if(visible){const scale=THREE.MathUtils.clamp(1-this.eye.distanceTo(pos)/70,.7,1);this.label.style.transform=`translate(${(this.projected.x+1)*this.container.clientWidth/2}px,${(1-this.projected.y)*this.container.clientHeight/2}px) translate(-50%,-100%) scale(${scale})`;}
 }
 dispose(){this.label.remove();this.root.remove(this.shield,this.band);this.shield.geometry.dispose();this.shield.material.dispose();this.band.geometry.dispose();(this.band.material as THREE.Material).dispose();}
}
export function disposeActor(root:THREE.Object3D){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
}
