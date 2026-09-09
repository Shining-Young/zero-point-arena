import { OBSTACLES,type Point3 } from '../lib/game/rules.ts';
type Target=Point3&{id:string;alive:boolean;crouched?:boolean};
export function traceWeaponShot(origin:Point3,yaw:number,pitch:number,weapon:'rifle'|'pistol',aiming:boolean,targets:Target[]){
 const hit=traceShot(origin,yaw,pitch,weapon==='rifle'?70:50,targets);
 const x=aiming?.02:.28,y=-.29,z=weapon==='rifle'?-1.27:-.682;
 const ry=y*Math.cos(pitch)-z*Math.sin(pitch),rz=y*Math.sin(pitch)+z*Math.cos(pitch);
 const muzzle={x:origin.x+x*Math.cos(yaw)+rz*Math.sin(yaw),y:origin.y+ry,z:origin.z-x*Math.sin(yaw)+rz*Math.cos(yaw)};
 const segment=(a:Point3,b:Point3)=>{const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;return traceShot(a,Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)),Math.hypot(dx,dy,dz),[]).end;};
 const separation=(a:Point3,b:Point3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
 const start=segment(origin,muzzle);
 if(separation(start,muzzle)>.001)return {start,end:start,targetId:undefined,headshot:false};
 const end=segment(start,hit.end);
 return separation(end,hit.end)>.001?{start,end,targetId:undefined,headshot:false}:{...hit,start};
}
export function traceShot(origin:Point3,yaw:number,pitch:number,range:number,targets:Target[]){
 const direction={x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)};
 let distance=range,targetId:string|undefined,headshot=false;
 const boxes=[...OBSTACLES,{x:0,z:-24,w:49,d:1,h:8},{x:-24,z:0,w:1,d:49,h:7},{x:24,z:0,w:1,d:49,h:7},{x:0,z:24,w:49,d:1,h:5}];
 for(const box of boxes){let near=0,far=range;
  for(const [start,delta,min,max] of [[origin.x,direction.x,box.x-box.w/2,box.x+box.w/2],[origin.y,direction.y,0,box.h],[origin.z,direction.z,box.z-box.d/2,box.z+box.d/2]]){
   if(Math.abs(delta)<1e-9){if(start<min||start>max){far=-1;break;}}
   else{const a=(min-start)/delta,b=(max-start)/delta;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}
  }
  if(far>=near)distance=Math.min(distance,near);
 }
 if(direction.y<0)distance=Math.min(distance,Math.max(0,-origin.y/direction.y));
 for(const target of targets){if(!target.alive)continue;
  const dx=target.x-origin.x,dz=target.z-origin.z,horizontal=dx*-Math.sin(yaw)+dz*-Math.cos(yaw);
  const along=horizontal/Math.max(Math.cos(pitch),1e-9),perpendicular=Math.abs(dx*-Math.cos(yaw)-dz*-Math.sin(yaw));
  const hitY=origin.y+direction.y*along,scale=target.crouched?.65:1;
  if(along>0&&along<distance&&perpendicular<=.55&&hitY>=target.y+.2&&hitY<=target.y+1.98*scale){distance=along;targetId=target.id;headshot=hitY>=target.y+1.72*scale;}
 }
 return {end:{x:origin.x+direction.x*distance,y:origin.y+direction.y*distance,z:origin.z+direction.z*distance},targetId,headshot};
}
