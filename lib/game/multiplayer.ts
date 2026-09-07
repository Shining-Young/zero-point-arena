import * as THREE from 'three';
import type { GameConnection } from '../network/client.ts';
import type { SnapshotEntity } from '../../shared/protocol.ts';
import { advanceActor, type MovementState } from './rules.ts';
import { buildWorld, makeRifle, makeSoldier } from './world.ts';

export type MultiplayerHud={health:number;ammo:number;reserve:number;kills:number;deaths:number;remaining:number;latency:number;connected:boolean};

export class MultiplayerGame{
  private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(74,1,.05,120);private renderer=new THREE.WebGLRenderer({antialias:true});private actors=new Map<string,ReturnType<typeof makeSoldier>>();private keys=new Set<string>();
  private yaw=0;private pitch=0;private position={x:-19,z:19};private movement:MovementState={y:0,velocityY:0,grounded:true,crouched:false};private sequence=0;private weapon:'rifle'|'pistol'='rifle';private remaining=300;private disposed=false;private inputTimer:ReturnType<typeof setInterval>;private unsubscribe:()=>void;
  private readonly onKeyDown=(event:KeyboardEvent)=>{this.keys.add(event.code);if(event.code==='KeyR')this.connection.send({type:'reload'});if(event.code==='Digit1'||event.code==='Digit2'){this.weapon=event.code==='Digit1'?'rifle':'pistol';this.connection.send({type:'switch_weapon',weapon:this.weapon});}};
  private readonly onKeyUp=(event:KeyboardEvent)=>this.keys.delete(event.code);
  private readonly onMouseMove=(event:MouseEvent)=>{if(document.pointerLockElement!==this.renderer.domElement&&event.target!==this.renderer.domElement)return;this.yaw-=event.movementX*.0022;this.pitch=Math.max(-1.45,Math.min(1.45,this.pitch-event.movementY*.0022));};
  private readonly onMouseDown=(event:MouseEvent)=>{if(event.button===0)this.connection.send({type:'fire',weapon:this.weapon,sequence:++this.sequence,yaw:this.yaw,pitch:this.pitch,clientTime:Date.now()});};
  constructor(private readonly container:HTMLElement,private readonly connection:GameConnection,private readonly playerId:string,private readonly callback:(hud:MultiplayerHud)=>void){
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;container.appendChild(this.renderer.domElement);buildWorld(this.scene);this.scene.add(this.camera);const gun=makeRifle();gun.position.set(.28,-.28,-.55);gun.scale.setScalar(.7);this.camera.add(gun);
    this.resize();addEventListener('resize',this.resize);addEventListener('keydown',this.onKeyDown);addEventListener('keyup',this.onKeyUp);addEventListener('mousemove',this.onMouseMove);this.renderer.domElement.addEventListener('mousedown',this.onMouseDown);this.renderer.domElement.addEventListener('click',()=>this.renderer.domElement.requestPointerLock().catch(()=>{}));
    this.unsubscribe=connection.subscribe(message=>{if(message.type==='snapshot'){this.remaining=message.remainingSeconds;this.applySnapshot(message.entities);}});
    this.inputTimer=setInterval(()=>this.sendInput(),50);this.renderer.setAnimationLoop(()=>this.frame());
  }
  private resize=()=>{const w=this.container.clientWidth,h=this.container.clientHeight;this.camera.aspect=w/Math.max(h,1);this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);};
  private sendInput(){const moveX=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0),moveZ=(this.keys.has('KeyW')?1:0)-(this.keys.has('KeyS')?1:0);const input={type:'input' as const,sequence:++this.sequence,moveX,moveZ,yaw:this.yaw,pitch:this.pitch,jump:this.keys.has('Space'),crouch:this.keys.has('KeyC')||this.keys.has('ControlLeft'),sprint:this.keys.has('ShiftLeft'),clientTime:Date.now()};this.connection.send(input);const next=advanceActor(this.position,input,this.movement,.05);this.position=next.position;this.movement=next.movement;}
  private applySnapshot(entities:SnapshotEntity[]){const local=entities.find(entity=>entity.id===this.playerId);if(local){const error=Math.hypot(local.x-this.position.x,local.z-this.position.z);if(error>.35)this.position={x:local.x,z:local.z};else{this.position.x+=(local.x-this.position.x)*.2;this.position.z+=(local.z-this.position.z)*.2;}this.callback({health:local.health,ammo:local.ammo,reserve:local.reserve,kills:local.kills,deaths:local.deaths,remaining:this.remaining,latency:this.connection.latency,connected:this.connection.phase==='playing'});}
    const active=new Set<string>();for(const entity of entities){if(entity.id===this.playerId)continue;active.add(entity.id);let actor=this.actors.get(entity.id);if(!actor){actor=makeSoldier(this.actors.size);this.actors.set(entity.id,actor);this.scene.add(actor.root);}actor.root.visible=entity.alive;actor.root.position.set(entity.x,entity.y,entity.z);actor.root.rotation.y=entity.yaw;}
    for(const [id,actor] of this.actors)if(!active.has(id)){this.scene.remove(actor.root);this.actors.delete(id);}
  }
  private frame(){if(this.disposed)return;this.camera.position.set(this.position.x,this.movement.y+(this.movement.crouched?1.15:1.65),this.position.z);this.camera.rotation.order='YXZ';this.camera.rotation.set(this.pitch,this.yaw,0);this.renderer.render(this.scene,this.camera);}
  dispose(){this.disposed=true;clearInterval(this.inputTimer);this.unsubscribe();this.renderer.setAnimationLoop(null);removeEventListener('resize',this.resize);removeEventListener('keydown',this.onKeyDown);removeEventListener('keyup',this.onKeyUp);removeEventListener('mousemove',this.onMouseMove);this.renderer.domElement.removeEventListener('mousedown',this.onMouseDown);if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();this.renderer.dispose();this.renderer.domElement.remove();}
}
