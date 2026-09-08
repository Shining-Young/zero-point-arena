import * as THREE from 'three';
import type { GameConnection } from '../network/client.ts';
import type { ServerMessage } from '../../shared/protocol.ts';
import { type MovementInput, type MovementState } from './rules.ts';
import { sampleSnapshots, ServerTimeline } from '../network/time-sync.ts';
import { advanceLocalPrediction, applyVerticalAuthority, interpolatePose, reconcilePrediction, type PendingPrediction } from '../network/motion.ts';
import { GameAudio } from './audio.ts';
import { buildWorld, makeRifle, makeSoldier } from './world.ts';

export type MultiplayerHud={
  health:number;ammo:number;reserve:number;kills:number;deaths:number;remaining:number;
  latency:number;connected:boolean;weapon:'rifle'|'pistol';reloadLeft:number;alive:boolean;
  protection:number;aiming:boolean;hitMarker:number;headshot:boolean;hurt:number;result:'win'|'loss'|'draw'|null;
};

const INITIAL_HUD:MultiplayerHud={health:100,ammo:30,reserve:120,kills:0,deaths:0,remaining:300,latency:0,connected:false,weapon:'rifle',reloadLeft:0,alive:true,protection:0,aiming:false,hitMarker:0,headshot:false,hurt:0,result:null};
const FIRE_INTERVAL={rifle:105,pistol:270} as const;

export class MultiplayerGame{
  private scene=new THREE.Scene();
  private camera=new THREE.PerspectiveCamera(74,1,.05,120);
  private renderer=new THREE.WebGLRenderer({antialias:true});
  private actors=new Map<string,ReturnType<typeof makeSoldier>>();
  private keys=new Set<string>();
  private audio=new GameAudio();
  private gunRig=new THREE.Group();
  private guns:THREE.Object3D[]=[];
  private hud={...INITIAL_HUD};
  private yaw=0;private pitch=0;private position={x:-19,z:19};
  private visualPosition={x:-19,z:19};
  private movement:MovementState={y:0,velocityY:0,grounded:true,crouched:false};
  private sequence=0;private weapon:'rifle'|'pistol'='rifle';private remaining=300;
  private disposed=false;private shooting=false;private aiming=false;private lastFire=-Infinity;
  private initialized=false;private lastFrame=performance.now();private timeline=new ServerTimeline();
  private pendingInputs:PendingPrediction[]=[];
  private snapshotBuffer:Extract<ServerMessage,{type:'snapshot'}>[]=[];
  private inputTimer:ReturnType<typeof setInterval>;private unsubscribe:()=>void;

  private readonly onKeyDown=(event:KeyboardEvent)=>{
    this.keys.add(event.code);
    if(event.repeat)return;
    if(event.code==='KeyR')this.connection.send({type:'reload'});
    if(event.code==='Digit1'||event.code==='Digit2'){
      this.setWeapon(event.code==='Digit1'?'rifle':'pistol');
      this.connection.send({type:'switch_weapon',weapon:this.weapon});
    }
  };
  private readonly onKeyUp=(event:KeyboardEvent)=>this.keys.delete(event.code);
  private readonly onMouseMove=(event:MouseEvent)=>{
    if(document.pointerLockElement!==this.renderer.domElement&&event.target!==this.renderer.domElement)return;
    this.yaw-=event.movementX*.0022;
    this.pitch=Math.max(-1.45,Math.min(1.45,this.pitch-event.movementY*.0022));
  };
  private readonly onMouseDown=(event:MouseEvent)=>{
    if(event.button!==0&&event.button!==2)return;
    event.preventDefault();this.audio.init();
    if(document.pointerLockElement!==this.renderer.domElement)void this.renderer.domElement.requestPointerLock().catch(()=>{});
    if(event.button===0){this.shooting=true;this.tryFire(performance.now());}
    if(event.button===2){this.aiming=true;this.emit({aiming:true});}
  };
  private readonly onMouseUp=(event:MouseEvent)=>{
    if(event.button===0)this.shooting=false;
    if(event.button===2){this.aiming=false;this.emit({aiming:false});}
  };
  private readonly onContextMenu=(event:Event)=>event.preventDefault();
  private readonly onBlur=()=>{this.keys.clear();this.shooting=false;this.aiming=false;this.emit({aiming:false});};

  constructor(private readonly container:HTMLElement,private readonly connection:GameConnection,private readonly playerId:string,private readonly callback:(hud:MultiplayerHud)=>void){
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;container.appendChild(this.renderer.domElement);
    buildWorld(this.scene);this.scene.add(this.camera);this.camera.add(this.gunRig);
    const rifle=makeRifle(),pistol=makeRifle(true);this.guns=[rifle,pistol];
    for(const gun of this.guns){gun.position.set(.28,-.28,-.55);gun.scale.setScalar(.7);this.gunRig.add(gun);}this.setWeapon('rifle');
    this.resize();addEventListener('resize',this.resize);addEventListener('keydown',this.onKeyDown);addEventListener('keyup',this.onKeyUp);addEventListener('mousemove',this.onMouseMove);addEventListener('mouseup',this.onMouseUp);addEventListener('blur',this.onBlur);
    this.renderer.domElement.addEventListener('mousedown',this.onMouseDown);this.renderer.domElement.addEventListener('contextmenu',this.onContextMenu);
    this.unsubscribe=connection.subscribe(message=>{
      if(message.type==='snapshot'){this.remaining=message.remainingSeconds;this.applySnapshot(message);}
      if(message.type==='combat_event')this.applyCombatEvent(message);
      if(message.type==='match_finished'){this.shooting=false;this.emit({result:message.winnerId===this.playerId?'win':message.winnerId?'loss':'draw'});}
    });
    this.inputTimer=setInterval(()=>this.sendInput(),50);this.renderer.setAnimationLoop(()=>this.frame());
  }

  private emit(patch:Partial<MultiplayerHud>){this.hud={...this.hud,...patch};this.callback(this.hud);}
  private resize=()=>{const w=this.container.clientWidth,h=this.container.clientHeight;this.camera.aspect=w/Math.max(h,1);this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);};
  private setWeapon(weapon:'rifle'|'pistol'){this.weapon=weapon;this.guns.forEach((gun,index)=>gun.visible=index===(weapon==='rifle'?0:1));}
  private tryFire(now:number){
    if(!this.shooting||!this.hud.connected||!this.hud.alive||this.hud.ammo<=0||this.hud.reloadLeft>0||this.hud.result||now-this.lastFire<FIRE_INTERVAL[this.weapon])return;
    this.lastFire=now;
    this.connection.send({type:'fire',weapon:this.weapon,sequence:++this.sequence,yaw:this.yaw,pitch:this.pitch,clientTime:Date.now()});
  }
  private movementInput():MovementInput&{pitch:number}{return {moveX:(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0),moveZ:(this.keys.has('KeyW')?1:0)-(this.keys.has('KeyS')?1:0),yaw:this.yaw,pitch:this.pitch,jump:this.keys.has('Space'),crouch:this.keys.has('KeyC')||this.keys.has('ControlLeft'),sprint:this.keys.has('ShiftLeft')};}
  private sendInput(){
    const canSend=this.connection.phase==='playing',connected=canSend||this.connection.phase==='ended';if(this.hud.connected!==connected)this.emit({connected});if(!canSend)return;
    const input={type:'input' as const,sequence:++this.sequence,...this.movementInput(),clientTime:Date.now()};
    this.connection.send(input);this.pendingInputs.push({sequence:input.sequence,position:{...this.position}});if(this.pendingInputs.length>128)this.pendingInputs.shift();
  }
  private applySnapshot(message:Extract<ServerMessage,{type:'snapshot'}>){
    const entities=message.entities;this.snapshotBuffer.push(message);if(this.snapshotBuffer.length>20)this.snapshotBuffer.shift();this.timeline.observe(message.serverTime,Date.now());
    const local=entities.find(entity=>entity.id===this.playerId);
    if(local){
      if(!this.initialized){this.position={x:local.x,z:local.z};this.visualPosition={...this.position};this.movement={...this.movement,y:local.y};this.pendingInputs=[];this.initialized=true;}
      else{const reconciled=reconcilePrediction(this.position,this.visualPosition,this.pendingInputs,{x:local.x,z:local.z},message.lastProcessedInput);this.position=reconciled.position;this.visualPosition=reconciled.visualPosition;this.pendingInputs=reconciled.pending;this.movement=applyVerticalAuthority(this.movement,local.y,reconciled.snapped||(!this.hud.alive&&local.alive));}
      if(local.weapon!==this.weapon)this.setWeapon(local.weapon);
      if(!local.alive)this.shooting=false;
      this.emit({health:local.health,ammo:local.ammo,reserve:local.reserve,kills:local.kills,deaths:local.deaths,remaining:this.remaining,latency:this.connection.latency,connected:this.connection.phase==='playing',weapon:local.weapon,reloadLeft:local.reloadLeft,alive:local.alive,protection:local.spawnProtection,aiming:this.aiming});
    }
    const active=new Set<string>();
    for(const entity of entities){if(entity.id===this.playerId)continue;active.add(entity.id);let actor=this.actors.get(entity.id);if(!actor){actor=makeSoldier(this.actors.size);this.actors.set(entity.id,actor);this.scene.add(actor.root);}actor.root.visible=entity.alive;}
    for(const [id,actor] of this.actors)if(!active.has(id)){this.scene.remove(actor.root);this.actors.delete(id);}
  }
  private renderRemoteActors(){
    const latest=this.snapshotBuffer[this.snapshotBuffer.length-1];if(!latest)return;
    const sampled=sampleSnapshots(this.snapshotBuffer,this.timeline.renderTime(Date.now(),120));if(!sampled)return;
    const before=new Map(sampled.before.entities.map(entity=>[entity.id,entity])),after=new Map(sampled.after.entities.map(entity=>[entity.id,entity]));
    for(const [id,actor] of this.actors){const a=before.get(id)??after.get(id),b=after.get(id)??before.get(id);if(!a||!b)continue;const pose=interpolatePose(a,b,sampled.alpha,a.alive!==b.alive);actor.root.position.set(pose.x,pose.y,pose.z);actor.root.rotation.y=pose.yaw;actor.root.visible=sampled.alpha<.5?a.alive:b.alive;}
  }
  private applyCombatEvent(message:Extract<ServerMessage,{type:'combat_event'}>){
    if(message.actorId===this.playerId&&message.event==='shot')this.audio.shot();
    if(message.actorId===this.playerId&&(message.event==='hit'||message.event==='headshot')){this.audio.hit();this.emit({hitMarker:Date.now(),headshot:message.event==='headshot'});}
    if(message.actorId===this.playerId&&message.event==='kill')this.audio.kill();
    if(message.actorId===this.playerId&&message.event==='reload')this.audio.reload();
    if(message.targetId===this.playerId&&(message.event==='hit'||message.event==='headshot'))this.emit({hurt:Date.now()});
  }
  private frame(){
    if(this.disposed)return;const now=performance.now(),dt=Math.min(.05,Math.max(0,(now-this.lastFrame)/1000));this.lastFrame=now;this.tryFire(now);
    if(this.initialized&&this.connection.phase==='playing'&&this.hud.alive&&!this.hud.result){const next=advanceLocalPrediction({position:this.position,visualPosition:this.visualPosition,movement:this.movement},this.movementInput(),dt);this.position=next.position;this.visualPosition=next.visualPosition;this.movement=next.movement;}
    const correction=1-Math.exp(-16*dt);this.visualPosition.x+=(this.position.x-this.visualPosition.x)*correction;this.visualPosition.z+=(this.position.z-this.visualPosition.z)*correction;this.renderRemoteActors();
    const targetFov=this.aiming?55:74;if(Math.abs(this.camera.fov-targetFov)>.05){this.camera.fov+=(targetFov-this.camera.fov)*.2;this.camera.updateProjectionMatrix();}
    this.gunRig.position.z=this.aiming?-.12:0;
    this.camera.position.set(this.visualPosition.x,this.movement.y+(this.movement.crouched?1.15:1.65),this.visualPosition.z);this.camera.rotation.order='YXZ';this.camera.rotation.set(this.pitch,this.yaw,0);this.renderer.render(this.scene,this.camera);
  }
  dispose(){
    this.disposed=true;clearInterval(this.inputTimer);this.unsubscribe();this.renderer.setAnimationLoop(null);
    removeEventListener('resize',this.resize);removeEventListener('keydown',this.onKeyDown);removeEventListener('keyup',this.onKeyUp);removeEventListener('mousemove',this.onMouseMove);removeEventListener('mouseup',this.onMouseUp);removeEventListener('blur',this.onBlur);
    this.renderer.domElement.removeEventListener('mousedown',this.onMouseDown);this.renderer.domElement.removeEventListener('contextmenu',this.onContextMenu);
    if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();this.audio.dispose();this.renderer.dispose();this.renderer.domElement.remove();
  }
}
