import * as THREE from 'three';

export function directionFromAngles(yaw:number,pitch:number){
  const horizontal=Math.cos(pitch);
  return new THREE.Vector3(-Math.sin(yaw)*horizontal,Math.sin(pitch),-Math.cos(yaw)*horizontal).normalize();
}

export function resolveShotEnd(origin:THREE.Vector3,direction:THREE.Vector3,objects:THREE.Object3D[],range=65){
  const ray=new THREE.Raycaster(origin,direction.clone().normalize(),0,range);
  return ray.intersectObjects(objects,false)[0]?.point.clone()??ray.ray.at(range,new THREE.Vector3());
}

export type ShotEffect={root:THREE.Group;life:number;maxLife:number;materials:THREE.Material[];light:THREE.PointLight};

export function spawnShotEffect(scene:THREE.Scene,start:THREE.Vector3,end:THREE.Vector3,enemy=false):ShotEffect{
  const root=new THREE.Group(),color=enemy?0xff7659:0xffd58a;
  const tracerMaterial=new THREE.LineBasicMaterial({color,transparent:true,opacity:.9});
  const tracer=new THREE.Line(new THREE.BufferGeometry().setFromPoints([start,end]),tracerMaterial);
  const flashMaterial=new THREE.MeshBasicMaterial({color,transparent:true,opacity:1});
  const flash=new THREE.Mesh(new THREE.SphereGeometry(.075,5,4),flashMaterial);flash.position.copy(start);
  const impactMaterial=new THREE.MeshBasicMaterial({color:0xffe2a6,transparent:true,opacity:.85});
  const impact=new THREE.Mesh(new THREE.SphereGeometry(.035,4,3),impactMaterial);impact.position.copy(end);
  const light=new THREE.PointLight(color,4,4);light.position.copy(start);
  root.add(tracer,flash,impact,light);scene.add(root);
  return {root,life:.1,maxLife:.1,materials:[tracerMaterial,flashMaterial,impactMaterial],light};
}

export function updateShotEffects(scene:THREE.Scene,effects:ShotEffect[],dt:number){
  const remaining:ShotEffect[]=[];
  for(const effect of effects){
    effect.life-=dt;
    if(effect.life<=0){effect.root.traverse(object=>{if(object instanceof THREE.Line||object instanceof THREE.Mesh)object.geometry.dispose();});effect.materials.forEach(material=>material.dispose());scene.remove(effect.root);continue;}
    const fade=effect.life/effect.maxLife;effect.materials.forEach(material=>material.opacity=fade);effect.light.intensity=4*fade;remaining.push(effect);
  }
  return remaining;
}
