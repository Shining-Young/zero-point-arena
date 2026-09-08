export type Point = { x: number; z: number };
export type Point3 = Point & { y: number };
export type Obstacle = Point & { w: number; d: number; h: number; kind?: string };
export const ARENA = 23;
export const OBSTACLES: Obstacle[] = [
  {x:-9,z:-8,w:5,d:12,h:3.8,kind:'container'},
  {x:10,z:7,w:5,d:12,h:3.8,kind:'container'},
  {x:-3,z:7,w:3.4,d:3.4,h:2.8,kind:'crate'},
  {x:4,z:-5,w:3.4,d:3.4,h:2.8,kind:'crate'},
  {x:13,z:-13,w:5,d:4,h:3.5,kind:'crate'},
  {x:-14,z:13,w:4,d:4,h:3.5,kind:'crate'},
  {x:0,z:-16,w:7,d:2,h:2.3,kind:'barrier'},
  {x:0,z:0,w:4,d:3,h:1.4,kind:'barrier'},
  {x:-17,z:-3,w:2.8,d:2.8,h:3,kind:'tank'},
  {x:17,z:15,w:2.8,d:2.8,h:3,kind:'tank'},
];
export const SPAWNS: Point[] = [{x:-19,z:19},{x:19,z:-19},{x:-19,z:-19},{x:19,z:19},{x:0,z:20},{x:0,z:-21}];
export function canStand(x:number,z:number,obstacles:Obstacle[]=OBSTACLES,r=.42){
  return Math.abs(x)<=ARENA-r && Math.abs(z)<=ARENA-r && !obstacles.some(o=>{
    const dx=Math.max(Math.abs(x-o.x)-o.w/2,0), dz=Math.max(Math.abs(z-o.z)-o.d/2,0);
    return dx*dx+dz*dz<r*r;
  });
}
export function moveActor(p:Point,dx:number,dz:number,obstacles:Obstacle[]=OBSTACLES,r=.42):Point{
  let {x,z}=p;
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.2));
  for(let i=0;i<steps;i++){
    if(canStand(x+dx/steps,z,obstacles,r))x+=dx/steps;
    if(canStand(x,z+dz/steps,obstacles,r))z+=dz/steps;
  }
  return {x,z};
}
export type MovementInput={moveX:number;moveZ:number;yaw:number;sprint:boolean;crouch:boolean;jump:boolean};
export type MovementState={y:number;velocityY:number;grounded:boolean;crouched?:boolean};
export function forwardFromYaw(yaw:number){return {x:-Math.sin(yaw),z:-Math.cos(yaw)};}
export function yawToward(from:Point,to:Point){return Math.atan2(from.x-to.x,from.z-to.z);}
export function advanceActor(position:Point,input:MovementInput,state:MovementState,dt:number){
  const length=Math.hypot(input.moveX,input.moveZ), scale=length>1?1/length:1;
  const side=input.moveX*scale, forward=input.moveZ*scale;
  const speed=input.crouch?2.2:input.sprint?6.2:4.2;
  const sin=Math.sin(input.yaw),cos=Math.cos(input.yaw);
  const dx=(side*cos-forward*sin)*speed*dt;
  const dz=(-side*sin-forward*cos)*speed*dt;
  const next=moveActor(position,dx,dz);
  let velocityY=state.velocityY,y=state.y,grounded=state.grounded;
  if(input.jump&&grounded&&!input.crouch){velocityY=5.2;grounded=false;}
  if(!grounded){velocityY-=12*dt;y+=velocityY*dt;if(y<=0){y=0;velocityY=0;grounded=true;}}
  return {position:next,movement:{y,velocityY,grounded,crouched:input.crouch}};
}
export function lineClear(a:Point3,b:Point3,obstacles:Obstacle[]=OBSTACLES){
  return !obstacles.some(o=>{
    let lo=0,hi=1;
    const bounds=[[a.x,b.x-a.x,o.x-o.w/2,o.x+o.w/2],[a.y,b.y-a.y,0,o.h],[a.z,b.z-a.z,o.z-o.d/2,o.z+o.d/2]];
    for(const [start,delta,min,max] of bounds){
      if(Math.abs(delta)<1e-8){if(start<min||start>max)return false;}
      else {const t1=(min-start)/delta,t2=(max-start)/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;}
    }
    return hi>=0&&lo<=1;
  });
}
export function findPath(start:Point,end:Point,obstacles:Obstacle[]=OBSTACLES):Point[]{
  const n=23, toCell=(v:number)=>Math.max(0,Math.min(n-1,Math.round((v+22)/2)));
  const point=(id:number)=>({x:(id%n)*2-22,z:Math.floor(id/n)*2-22});
  const reachable=(p:Point)=>{
    if(!canStand(p.x,p.z,obstacles,.55))return false;
    const steps=Math.max(1,Math.ceil(Math.hypot(p.x-start.x,p.z-start.z)/.18));
    for(let i=0;i<=steps;i++)if(!canStand(start.x+(p.x-start.x)*i/steps,start.z+(p.z-start.z)*i/steps,obstacles,.46))return false;
    return true;
  };
  const candidates=Array.from({length:n*n},(_,id)=>id).sort((a,b)=>{
    const p=point(a),q=point(b);return Math.hypot(p.x-start.x,p.z-start.z)-Math.hypot(q.x-start.x,q.z-start.z);
  });
  const s=candidates.find(id=>reachable(point(id))),goal=toCell(end.z)*n+toCell(end.x);
  if(s===undefined)return [];
  const queue=[s], prev=new Map<number,number>([[s,-1]]);
  let best=s, bestDist=Infinity;
  for(let i=0;i<queue.length;i++){
    const id=queue[i],p=point(id),distance=Math.hypot(p.x-end.x,p.z-end.z);
    if(distance<bestDist){bestDist=distance;best=id;}
    if(id===goal)break;
    const col=id%n,row=Math.floor(id/n);
    for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const c=col+dc,r=row+dr,j=r*n+c,q=point(j);
      if(c<0||r<0||c>=n||r>=n||prev.has(j)||!canStand(q.x,q.z,obstacles,.55))continue;
      if(!lineClear({...p,y:1},{...q,y:1},obstacles))continue;
      prev.set(j,id);queue.push(j);
    }
  }
  const path:Point[]=[];
  for(let id=best;id!==s&&id!==-1;id=prev.get(id)??-1)path.push(point(id));
  path.push(point(s));
  return path.reverse();
}
export function reloadAmmo(ammo:number,reserve:number,capacity:number){
  const moved=Math.min(capacity-ammo,reserve);
  return {ammo:ammo+moved,reserve:reserve-moved};
}
export function matchOutcome(kills:number,deaths:number,remaining:number):'win'|'loss'|'draw'|null{
  if(kills>=15)return 'win';
  if(deaths>=15)return 'loss';
  if(remaining<=0)return kills===deaths?'draw':kills>deaths?'win':'loss';
  return null;
}
