import * as THREE from 'three';
import type { GameConnection } from '../network/client.ts';
import type { ServerMessage,SnapshotEntity } from '../../shared/protocol.ts';
import { traceWeaponShot } from '../../shared/combat.ts';
import { advanceActor,lineClear,type MovementInput } from './rules.ts';
import { sampleSnapshots,ServerTimeline } from '../network/time-sync.ts';
import { CommandPrediction,interpolatePose,type MovementCommand } from '../network/motion.ts';
import { GameAudio } from './audio.ts';
import { directionFromAngles,resolveAimShot,spawnShotEffect,updateShotEffects,type ShotEffect } from './shot-effects.ts';
import { WeaponPresentation } from './weapon-presentation.ts';
import { ActorFeedback,disposeActor } from './actor-feedback.ts';
import { readMovementControls } from './controls.ts';
import { readSettings,type GameSettings } from './settings.ts';
import { buildWorld,makeRifle,makeSoldier } from './world.ts';

export type MultiplayerHud={
 health:number;ammo:number;reserve:number;kills:number;deaths:number;remaining:number;latency:number;connected:boolean;
 weapon:'rifle'|'pistol';reloadLeft:number;alive:boolean;protection:number;aiming:boolean;hitMarker:number;headshot:boolean;hurt:number;result:'win'|'loss'|'draw'|null;
 menuOpen:boolean;leaderKills:number;leaderName:string;x:number;z:number;yaw:number;enemies:{x:number;z:number;visible:boolean}[];
 networkStatus?:string;snapshotAge?:number;pendingInputs?:number;frameMs?:number;serverTickMs?:number;shieldHit?:number;
 feed:{id:number;attacker:string;victim:string;headshot:boolean}[];respawnLeft:number;
};
const INITIAL_HUD:MultiplayerHud={health:100,ammo:30,reserve:120,kills:0,deaths:0,remaining:300,latency:0,connected:false,weapon:'rifle',reloadLeft:0,alive:true,protection:0,aiming:false,hitMarker:0,headshot:false,hurt:0,result:null,menuOpen:true,leaderKills:0,leaderName:'对手',x:-19,z:19,yaw:0,enemies:[],feed:[],respawnLeft:0};
const WEAPONS={rifle:{interval:105,reload:1.9,capacity:30,range:70},pistol:{interval:270,reload:1.3,capacity:12,range:50}};
const STEP=.01;

export class MultiplayerGame{
 private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(76,1,.05,120);
 private renderer=new THREE.WebGLRenderer({antialias:true});private actors=new Map<string,ReturnType<typeof makeSoldier>>();
 private feedback=new Map<string,ActorFeedback>();
 private keys=new Set<string>();private audio=new GameAudio();private gunRig=new THREE.Group();private guns:THREE.Object3D[]=[];
 private solid:THREE.Object3D[]=[];private shotEffects:ShotEffect[]=[];private hud={...INITIAL_HUD};
 private yaw=0;private pitch=0;private predictor=new CommandPrediction();private accumulator=0;private life=0;
 private sequence=0;private unsent:MovementCommand[]=[];private weapon:'rifle'|'pistol'='rifle';private presentation=new WeaponPresentation();
 private settings:GameSettings=readSettings();private disposed=false;private shooting=false;private lastFire=-Infinity;
 private initialized=false;private lastFrame=performance.now();private timeline=new ServerTimeline();private publishElapsed=0;
 private snapshotBuffer:Extract<ServerMessage,{type:'snapshot'}>[]=[];private latest:SnapshotEntity[]=[];
 private localReloadLeft=0;private reloadRequested=0;private reloadConfirmed=false;private feedId=0;
 private predictedShots:number[]=[];private inputTimer:ReturnType<typeof setInterval>;private unsubscribe:()=>void;
 private lastInputSequence=-1;private headshots=new Set<string>();private feedExpires=new Map<number,number>();

 private get active(){return !this.hud.menuOpen&&this.hud.alive&&!this.hud.result&&this.connection.phase==='playing'&&!this.connection.recovering;}
 private readonly onKeyDown=(event:KeyboardEvent)=>{
  if(event.code==='Escape'){event.preventDefault();this.openSettings();return;}
  if(!this.active)return;this.keys.add(event.code);if(event.repeat)return;
  if(['Space','ControlLeft','Tab'].includes(event.code))event.preventDefault();
  if(event.code==='KeyR')this.reload();
  if(event.code==='Digit1'||event.code==='Digit2'){
   this.localReloadLeft=0;this.reloadRequested=0;this.presentation.reset();
   this.connection.send({type:'switch_weapon',weapon:event.code==='Digit1'?'rifle':'pistol'});
  }
 };
 private readonly onKeyUp=(event:KeyboardEvent)=>{this.keys.delete(event.code);};
 private readonly onMouseMove=(event:MouseEvent)=>{
  if(!this.active||document.pointerLockElement!==this.renderer.domElement)return;
  const sensitivity=.002*this.settings.sensitivity*(this.presentation.aim?.65:1);
  this.yaw-=event.movementX*sensitivity;this.pitch=Math.max(-1.4,Math.min(1.4,this.pitch-event.movementY*sensitivity));
 };
 private readonly onMouseDown=(event:MouseEvent)=>{
  if(!this.active||document.pointerLockElement!==this.renderer.domElement)return;
  if(event.button!==0&&event.button!==2)return;event.preventDefault();this.audio.init();
  if(event.button===0)this.shooting=true;
  if(event.button===2)this.presentation.toggleAim();
 };
 private readonly onMouseUp=(event:MouseEvent)=>{if(event.button===0)this.shooting=false;};
 private readonly onContextMenu=(event:Event)=>event.preventDefault();
 private readonly onBlur=()=>this.openSettings();
 private readonly onPointerLock=()=>{if(document.pointerLockElement!==this.renderer.domElement)this.openSettings();};

 constructor(private readonly container:HTMLElement,private readonly connection:GameConnection,private readonly playerId:string,private readonly callback:(hud:MultiplayerHud)=>void){
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;container.appendChild(this.renderer.domElement);
  this.solid=buildWorld(this.scene).solid;this.scene.add(this.camera);this.camera.add(this.gunRig);
  this.guns=[makeRifle(),makeRifle(true)];for(const gun of this.guns){gun.scale.setScalar(.7);this.gunRig.add(gun);}this.setWeapon('rifle');
  this.configure(this.settings);this.resize();addEventListener('resize',this.resize);addEventListener('keydown',this.onKeyDown);addEventListener('keyup',this.onKeyUp);addEventListener('mousemove',this.onMouseMove);addEventListener('mouseup',this.onMouseUp);addEventListener('blur',this.onBlur);document.addEventListener('pointerlockchange',this.onPointerLock);
  this.renderer.domElement.addEventListener('mousedown',this.onMouseDown);this.renderer.domElement.addEventListener('contextmenu',this.onContextMenu);
  this.unsubscribe=connection.subscribe(message=>{
   if(message.type==='welcome'){this.initialized=false;this.unsent=[];this.predictor.pending=[];this.snapshotBuffer=[];this.accumulator=0;this.predictedShots=[];this.openSettings();}
   if(message.type==='input_resynced'){this.predictor.reset(message.entity);this.life=message.entity.life;this.unsent=[];this.accumulator=0;this.predictedShots=[];this.initialized=true;this.keys.clear();this.shooting=false;this.presentation.reset();this.lastInputSequence=message.lastProcessedInput;this.sequence=Math.max(this.sequence,message.lastProcessedInput,message.entity.lastShot??-1);}
   if(message.type==='snapshot'&&!this.connection.recovering)this.applySnapshot(message);
   if(message.type==='combat_event')this.applyCombatEvent(message);
   if(message.type==='match_finished'){this.openSettings();this.emit({menuOpen:false,result:message.winnerId===this.playerId?'win':message.winnerId?'loss':'draw'});}
  });
  this.inputTimer=setInterval(()=>this.sendInput(),50);this.renderer.setAnimationLoop(()=>this.frame());this.emit({});
 }
 configure(settings:GameSettings){this.settings=settings;this.audio.enabled=settings.sound;}
 openSettings(){this.keys.clear();this.shooting=false;this.presentation.reset();this.sendInput();this.emit({menuOpen:true,aiming:false});if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();}
 resume(){if(this.hud.result)return;this.keys.clear();this.shooting=false;this.audio.init();void this.renderer.domElement.requestPointerLock().then(()=>{if(!this.disposed)this.emit({menuOpen:false});}).catch(()=>this.emit({menuOpen:true}));}
 private emit(patch:Partial<MultiplayerHud>){this.hud={...this.hud,...patch};this.callback(this.hud);}
 private resize=()=>{const w=this.container.clientWidth,h=this.container.clientHeight;this.camera.aspect=w/Math.max(h,1);this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);};
 private setWeapon(weapon:'rifle'|'pistol'){if(this.weapon!==weapon){this.presentation.reset();this.localReloadLeft=0;this.lastFire=performance.now();}this.weapon=weapon;this.guns.forEach((gun,index)=>gun.visible=index===(weapon==='rifle'?0:1));}
 private reload(){const w=WEAPONS[this.weapon];if(!this.active||this.localReloadLeft>0||this.hud.ammo>=w.capacity||this.hud.reserve<=0)return;this.localReloadLeft=w.reload;this.reloadRequested=performance.now();this.reloadConfirmed=false;this.connection.send({type:'reload'});this.audio.reload();}
 private tryFire(now:number){
  if(!this.active||!this.shooting||this.localReloadLeft>0||now-this.lastFire<WEAPONS[this.weapon].interval)return;
  if(this.hud.ammo<=0){this.reload();return;}if(this.movementInput().sprint)return;
  this.sendInput();this.lastFire=now;const sequence=++this.sequence;this.predictedShots.push(sequence);
  this.showLocalShot();this.presentation.shoot();this.audio.shot();this.emit({ammo:Math.max(0,this.hud.ammo-1)});
  this.connection.send({type:'fire',weapon:this.weapon,sequence,yaw:this.yaw,pitch:this.pitch,clientTime:Date.now(),inputSequence:this.lastInputSequence,life:this.life});
 }
 private showLocalShot(){
  this.scene.updateMatrixWorld(true);const eye=this.camera.getWorldPosition(new THREE.Vector3());
  const targets=this.latest.filter(e=>e.id!==this.playerId).map(e=>({...e,x:this.actors.get(e.id)?.root.position.x??e.x,z:this.actors.get(e.id)?.root.position.z??e.z}));
  const shot=traceWeaponShot(eye,this.yaw,this.pitch,this.weapon,this.presentation.aim,targets);
  this.shotEffects.push(spawnShotEffect(this.scene,new THREE.Vector3(shot.start.x,shot.start.y,shot.start.z),new THREE.Vector3(shot.end.x,shot.end.y,shot.end.z)));
 }
 private showRemoteShot(actorId:string,yaw:number,pitch:number,end?:{x:number;y:number;z:number}){
  const actor=this.actors.get(actorId),entity=this.latest.find(e=>e.id===actorId);if(!actor||!entity||!actor.root.visible)return;
  this.scene.updateMatrixWorld(true);const muzzle=actor.root.localToWorld(actor.muzzle.clone());
  const eye=new THREE.Vector3(actor.root.position.x,actor.root.position.y+(entity.crouched?1.05:1.68),actor.root.position.z);
  const shot=resolveAimShot(eye,muzzle,directionFromAngles(yaw,pitch),this.solid,WEAPONS[entity.weapon].range,end?new THREE.Vector3(end.x,end.y,end.z):undefined);
  this.shotEffects.push(spawnShotEffect(this.scene,shot.start,shot.end,true));
 }
 private movementInput():MovementInput&{pitch:number}{const controls=readMovementControls(this.keys,this.presentation.aim,this.active);if(controls.sprint){this.presentation.aimIntent=false;this.presentation.aim=false;}return {...controls,yaw:this.yaw,pitch:this.pitch};}
 private sendInput(){if(this.connection.phase!=='playing'||this.connection.recovering){this.unsent=[];return;}while(this.unsent.length){const commands=this.unsent.slice(0,16).map(command=>({type:'input' as const,...command}));if(!this.connection.send({type:'input_batch',commands}))return;this.unsent.splice(0,commands.length);}}
 private applySnapshot(message:Extract<ServerMessage,{type:'snapshot'}>){
  this.latest=message.entities;this.snapshotBuffer.push(message);if(this.snapshotBuffer.length>20)this.snapshotBuffer.shift();this.timeline.observe(message.serverTime,Date.now());
  const local=message.entities.find(e=>e.id===this.playerId);if(!local)return;
  if(!this.initialized||this.life!==local.life){this.predictor.reset(local);this.unsent=[];this.accumulator=0;this.life=local.life;this.lastInputSequence=message.lastProcessedInput??-1;this.sequence=Math.max(this.sequence,this.lastInputSequence,local.lastShot??-1);this.initialized=true;this.presentation.reset();this.predictedShots=[];}
  else this.predictor.reconcile(local,message.lastProcessedInput??-1);
  this.setWeapon(local.weapon);if(!local.alive){this.shooting=false;this.presentation.reset();this.unsent=[];this.localReloadLeft=0;}
  if(local.reloadLeft>0){if(!this.reloadConfirmed||Math.abs(local.reloadLeft-this.localReloadLeft)>.2)this.localReloadLeft=local.reloadLeft;this.reloadConfirmed=true;}
  else if(this.reloadConfirmed||performance.now()-this.reloadRequested>1000)this.localReloadLeft=0;
  this.predictedShots=this.predictedShots.filter(sequence=>sequence>(local.lastShot??-1));
  const leader=message.entities.filter(e=>e.id!==this.playerId).sort((a,b)=>b.kills-a.kills)[0];
  this.emit({health:local.health,ammo:Math.max(0,local.ammo-this.predictedShots.length),reserve:local.reserve,kills:local.kills,deaths:local.deaths,remaining:message.remainingSeconds,latency:this.connection.latency,connected:this.connection.phase==='playing',weapon:local.weapon,alive:local.alive,protection:local.spawnProtection,leaderKills:leader?.kills??0,leaderName:leader?.nickname??'对手',respawnLeft:local.respawnLeft});
 }
 private renderRemoteActors(){
  const sampled=sampleSnapshots(this.snapshotBuffer,this.timeline.renderTime(Date.now(),120));if(!sampled)return;
  const active=new Set(this.latest.filter(e=>e.id!==this.playerId).map(e=>e.id));
  for(const entity of this.latest){if(entity.id===this.playerId)continue;let actor=this.actors.get(entity.id);if(!actor){actor=makeSoldier(this.actors.size);this.actors.set(entity.id,actor);this.scene.add(actor.root);this.feedback.set(entity.id,new ActorFeedback(actor.root,this.container,entity.nickname,entity.isBot));}
   const a=sampled.before.entities.find(e=>e.id===entity.id)??entity,b=sampled.after.entities.find(e=>e.id===entity.id)??entity;
   const pose=interpolatePose(a,b,sampled.alpha,a.life!==b.life||a.alive!==b.alive);actor.root.position.set(pose.x,pose.y,pose.z);actor.root.rotation.y=pose.yaw;actor.root.visible=entity.alive;actor.root.scale.y=entity.crouched?.65:1;this.feedback.get(entity.id)?.update(this.camera,entity.alive,entity.spawnProtection,entity.crouched);
  }
  for(const [id,actor] of this.actors)if(!active.has(id)){this.feedback.get(id)?.dispose();this.feedback.delete(id);disposeActor(actor.root);this.scene.remove(actor.root);this.actors.delete(id);}
 }
 private applyCombatEvent(message:Extract<ServerMessage,{type:'combat_event'}>){
  if(message.event==='shot'){if(message.actorId!==this.playerId){this.audio.shot(true);this.showRemoteShot(message.actorId,message.yaw,message.pitch,message.end);}return;}
  if(message.targetId&&(message.event==='hit'||message.event==='headshot'||message.event==='shield'))this.feedback.get(message.targetId)?.hit(message.event==='shield');
  if(message.event==='shield'&&message.actorId===this.playerId)this.emit({shieldHit:Date.now()});
  if(message.event==='headshot')this.headshots.add(message.actorId+':'+message.targetId);
  if(message.event==='hit')this.headshots.delete(message.actorId+':'+message.targetId);
  if(message.actorId===this.playerId&&(message.event==='hit'||message.event==='headshot')){this.audio.hit();this.emit({hitMarker:Date.now(),headshot:message.event==='headshot'});}
  if(message.actorId===this.playerId&&message.event==='kill')this.audio.kill();
  if(message.targetId===this.playerId&&(message.event==='hit'||message.event==='headshot'))this.emit({hurt:Date.now()});
  if(message.event==='kill'){const name=(id?:string)=>id===this.playerId?'你':this.latest.find(e=>e.id===id)?.nickname??'对手',key=message.actorId+':'+message.targetId;this.feedExpires.set(++this.feedId,performance.now()+5000);this.emit({feed:[{id:this.feedId,attacker:name(message.actorId),victim:name(message.targetId),headshot:this.headshots.has(key)},...this.hud.feed].slice(0,5)});this.headshots.delete(key);}
 }
 private frame(){
  if(this.disposed)return;const now=performance.now(),dt=Math.min(.1,Math.max(0,(now-this.lastFrame)/1000));this.lastFrame=now;
  for(const [id,expires] of this.feedExpires)if(expires<=now)this.feedExpires.delete(id);
  this.hud.feed=this.hud.feed.filter(entry=>this.feedExpires.has(entry.id));
  this.localReloadLeft=Math.max(0,this.localReloadLeft-dt);
  const snapshotAge=Math.max(0,Date.now()-this.connection.lastSnapshotAt);
  if(this.initialized&&this.connection.phase==='playing'&&!this.hud.result&&(snapshotAge>750||this.predictor.pending.length>=90)){this.connection.resyncInputs();this.unsent=[];this.accumulator=0;this.keys.clear();this.shooting=false;this.presentation.reset();}
  const pose=this.presentation.update(dt,{reloadLeft:this.localReloadLeft,reloadTotal:WEAPONS[this.weapon].reload,alive:this.hud.alive,blocked:this.hud.menuOpen,sprint:this.movementInput().sprint});
  if(this.initialized&&this.connection.phase==='playing'&&!this.connection.recovering&&this.hud.alive&&!this.hud.result){
   this.accumulator+=dt;
   while(this.accumulator+1e-9>=STEP&&this.predictor.pending.length<100){const command={...this.movementInput(),sequence:++this.sequence,dt:STEP,clientTime:Date.now(),life:this.life};this.lastInputSequence=command.sequence;this.predictor.step(command);this.unsent.push(command);this.accumulator-=STEP;}
   if(this.predictor.pending.length>=100)this.accumulator=0;
  }
  const preview=advanceActor(this.predictor.position,this.movementInput(),this.predictor.movement,Math.max(0,this.accumulator));
  this.camera.position.set(preview.position.x,preview.movement.y+(preview.movement.crouched?1.05:1.68),preview.position.z);this.camera.rotation.order='YXZ';this.camera.rotation.set(this.pitch,this.yaw,0);this.camera.fov=pose.fov;this.camera.updateProjectionMatrix();
  this.gunRig.position.set(pose.x,pose.y,pose.z);this.gunRig.rotation.set(pose.rotationX,0,pose.rotationZ);
  this.camera.updateMatrixWorld(true);this.renderRemoteActors();this.tryFire(now);this.shotEffects=updateShotEffects(this.scene,this.shotEffects,dt);this.renderer.render(this.scene,this.camera);
  this.publishElapsed+=dt;if(this.publishElapsed>=.05){this.publishElapsed=0;const eye={x:preview.position.x,y:this.camera.position.y,z:preview.position.z};this.emit({x:eye.x,z:eye.z,yaw:this.yaw,aiming:pose.aiming,reloadLeft:this.localReloadLeft,latency:this.connection.latency,snapshotAge,pendingInputs:this.predictor.pending.length,frameMs:dt*1000,serverTickMs:this.connection.serverTickMs,networkStatus:this.connection.recovering?'连接恢复中，请松开移动键后重试':this.connection.phase==='reconnecting'?'正在重新连接服务器…':'',connected:(this.connection.phase==='playing'&&!this.connection.recovering)||this.connection.phase==='ended',enemies:this.latest.filter(e=>e.id!==this.playerId).map(e=>({x:e.x,z:e.z,visible:e.alive&&Math.hypot(e.x-eye.x,e.z-eye.z)<33&&lineClear(eye,{x:e.x,y:e.y+1.2,z:e.z})}))});}
 }
 dispose(){this.disposed=true;for(const effect of this.feedback.values())effect.dispose();this.feedback.clear();clearInterval(this.inputTimer);this.unsubscribe();this.renderer.setAnimationLoop(null);removeEventListener('resize',this.resize);removeEventListener('keydown',this.onKeyDown);removeEventListener('keyup',this.onKeyUp);removeEventListener('mousemove',this.onMouseMove);removeEventListener('mouseup',this.onMouseUp);removeEventListener('blur',this.onBlur);document.removeEventListener('pointerlockchange',this.onPointerLock);this.renderer.domElement.removeEventListener('mousedown',this.onMouseDown);this.renderer.domElement.removeEventListener('contextmenu',this.onContextMenu);if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();this.shotEffects=updateShotEffects(this.scene,this.shotEffects,Infinity);this.scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});this.audio.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
