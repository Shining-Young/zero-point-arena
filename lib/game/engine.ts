import * as THREE from 'three';
import { buildWorld, makeRifle, makeSoldier, box } from './world';
import { ActorFeedback } from './actor-feedback';
import { readMovementControls } from './controls';
import { GameAudio } from './audio';
import { WeaponPresentation } from './weapon-presentation';
import { OBSTACLES, SPAWNS, moveActor, lineClear, findPath, reloadAmmo, matchOutcome, type Point } from './rules';

export type Difficulty='easy'|'normal'|'hard';
export type Phase='menu'|'playing'|'paused'|'respawn'|'finished';
export type Options={difficulty:Difficulty;sensitivity:number;sound:boolean};
export type Feed={id:number;attacker:string;victim:string;headshot:boolean};
export type Snapshot={phase:Phase;health:number;kills:number;deaths:number;time:number;ammo:number;reserve:number;weapon:number;reloading:number;respawn:number;hit:number;hurt:number;aim:boolean;shots:number;hits:number;headshots:number;result:string|null;feed:Feed[];x:number;z:number;yaw:number;bots:{x:number;z:number;visible:boolean}[];protection:number;fallback:boolean;fps:number};
export const INITIAL:Snapshot={phase:'menu',health:100,kills:0,deaths:0,time:300,ammo:30,reserve:120,weapon:0,reloading:0,respawn:0,hit:0,hurt:0,aim:false,shots:0,hits:0,headshots:0,result:null,feed:[],x:-19,z:19,yaw:0,bots:[],protection:0,fallback:false,fps:60};
const WEAPONS=[{name:'AR-4',capacity:30,reserve:120,damage:29,rate:.105,reload:1.9,spread:.012},{name:'P-12',capacity:12,reserve:60,damage:39,rate:.27,reload:1.3,spread:.007}];
const DIFFICULTY={easy:{speed:2.4,reaction:1.25,rate:.9,accuracy:.28},normal:{speed:3.1,reaction:.85,rate:.65,accuracy:.42},hard:{speed:3.8,reaction:.5,rate:.42,accuracy:.58}};
type Bot=ReturnType<typeof makeSoldier>&{id:number;health:number;dead:number;cooldown:number;noticed:number;path:Point[];repath:number;walk:number;spawnShield:number;lastSeen:Point|null};
type Effect={mesh:THREE.Object3D;life:number;max:number};

export class ArenaGame{
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(76,1,.06,160);renderer:THREE.WebGLRenderer;
  state:Snapshot={...INITIAL,feed:[],bots:[]};options:Options={difficulty:'normal',sensitivity:1,sound:true};
  feedback=new Map<number,ActorFeedback>();
  presentation=new WeaponPresentation();
  audio=new GameAudio();bots:Bot[]=[];solid:THREE.Object3D[]=[];effects:Effect[]=[];
  keys=new Set<string>();guns=[makeRifle(),makeRifle(true)];gunRig=new THREE.Group();
  ammo=[{ammo:30,reserve:120},{ammo:12,reserve:60}];
  yaw=.72;pitch=0;jump=0;velocityY=0;recoil=0;cooldown=0;reloadLeft=0;reloadTotal=0;stepTimer=0;
  shooting=false;aiming=false;dragging=false;frame=0;last=0;notifyElapsed=0;idle=0;disposed=false;moving=false;
  flash:THREE.Mesh;flashLight:THREE.PointLight;flashTime=0;clock=0;feedTimes:number[]=[];
  resizeObserver:ResizeObserver;abort=new AbortController();callback:(s:Snapshot)=>void;
  constructor(public container:HTMLElement,callback:(s:Snapshot)=>void){
    this.callback=callback;
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.7));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    this.renderer.domElement.setAttribute('aria-label','零点行动三维游戏场景');container.appendChild(this.renderer.domElement);
    this.solid=buildWorld(this.scene).solid;this.scene.add(this.camera);this.camera.rotation.order='YXZ';
    this.guns.forEach(g=>this.gunRig.add(g));this.guns[1].visible=false;this.gunRig.position.set(.28,-.29,-.5);this.camera.add(this.gunRig);
    const glove=new THREE.MeshStandardMaterial({color:0x28383f,roughness:.85});
    box(this.gunRig,.15,.15,.27,.07,-.2,.16,glove).rotation.x=-.4;
    box(this.gunRig,.15,.14,.34,-.06,-.16,-.45,glove).rotation.x=.4;
    const flashGeo=new THREE.ConeGeometry(.09,.32,6);flashGeo.rotateX(-Math.PI/2);
    this.flash=new THREE.Mesh(flashGeo,new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.9}));this.flash.position.set(0,.02,-1.16);this.gunRig.add(this.flash);this.flash.visible=false;
    this.flashLight=new THREE.PointLight(0xffb657,0,4);this.flashLight.position.set(.1,0,-1);this.gunRig.add(this.flashLight);
    for(let i=0;i<4;i++){
      const b:Bot={...makeSoldier(i),id:i,health:100,dead:0,cooldown:1,noticed:0,path:[],repath:0,walk:0,spawnShield:0,lastSeen:null};
      b.targets.forEach(t=>t.userData.bot=i);const s=SPAWNS[i+1];b.root.position.set(s.x,0,s.z);this.bots.push(b);this.scene.add(b.root);this.feedback.set(i,new ActorFeedback(b.root,container,`BOT ${String(i+1).padStart(2,'0')}`,true));
    }
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.bind();
    this.frame=requestAnimationFrame(this.loop);
  }
  resize(){const {clientWidth:w,clientHeight:h}=this.container;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  emit(){this.callback({...this.state,feed:[...this.state.feed],bots:this.bots.filter(b=>b.health>0).map(b=>({x:b.root.position.x,z:b.root.position.z,visible:this.state.phase==='menu'||(Math.hypot(b.root.position.x-this.state.x,b.root.position.z-this.state.z)<20&&lineClear({...b.root.position,y:1.6},{x:this.state.x,y:1.6,z:this.state.z}))}))});}
  configure(options:Options){this.options=options;this.audio.enabled=options.sound;}
  start(options:Options){
    this.configure(options);this.state={...INITIAL,phase:'paused',feed:[],bots:[]};this.clock=0;this.feedTimes=[];this.state.protection=2.5;
    this.effects.forEach(e=>this.removeEffect(e));this.effects=[];this.guns.forEach((g,i)=>g.visible=i===0);this.spawnPlayer(false);
    this.bots.forEach((b,i)=>{b.root.position.set(SPAWNS[i+1].x,0,SPAWNS[i+1].z);b.health=100;b.dead=0;b.root.visible=true;b.path=[];b.noticed=0;b.repath=0;b.cooldown=1;b.spawnShield=1;b.lastSeen=null;});
    this.resume();
  }
  resume(){
    this.audio.init();this.keys.clear();this.shooting=false;this.aiming=false;this.presentation.reset();
    this.state.phase=this.state.health<=0?'respawn':'playing';this.state.fallback=false;
    void this.requestMouseLock();
    this.emit();
  }
  async requestMouseLock(){
    if(this.disposed||this.state.phase!=='playing')return;
    try{
      this.renderer.domElement.focus();
      await this.renderer.domElement.requestPointerLock();
    }catch{
      if(this.disposed)return;
      this.state.fallback=true;this.emit();
    }
  }
  pause(){if(!['playing','respawn'].includes(this.state.phase))return;this.state.phase='paused';this.keys.clear();this.shooting=false;this.aiming=false;this.presentation.reset();this.dragging=false;if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();this.emit();}
  menu(){this.pause();this.state.phase='menu';this.state.hit=0;this.state.hurt=0;this.emit();}
  bind(){
    const signal=this.abort.signal;
    document.addEventListener('keydown',(e)=>{
      if(e.code==='Escape'){this.pause();return;}
      if(!['playing','respawn'].includes(this.state.phase))return;
      if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();
      this.keys.add(e.code);if(e.repeat)return;
      if(e.code==='KeyR')this.reload();
      if(e.code==='Digit1')this.switchWeapon(0);if(e.code==='Digit2')this.switchWeapon(1);
      if(e.code==='Space'&&this.jump===0&&this.state.health>0)this.velocityY=5.5;
    },{signal});
    document.addEventListener('keyup',(e)=>this.keys.delete(e.code),{signal});
    document.addEventListener('mousemove',(e)=>{
      if(this.state.phase!=='playing')return;
      const locked=document.pointerLockElement===this.renderer.domElement;
      if(!locked&&!(this.state.fallback&&(e.target===this.renderer.domElement||this.dragging)))return;
      const s=.002*this.options.sensitivity*(this.aiming?.65:1);this.yaw-=e.movementX*s;this.pitch=Math.max(-1.4,Math.min(1.4,this.pitch-e.movementY*s));
    },{signal});
    this.renderer.domElement.addEventListener('mousedown',(e)=>{if(this.state.phase!=='playing')return;e.preventDefault();if(this.state.fallback&&document.pointerLockElement!==this.renderer.domElement)void this.requestMouseLock();if(e.button===0)this.shooting=true;if(e.button===2){this.presentation.toggleAim();this.aiming=this.presentation.aimIntent&&this.reloadLeft<=0;this.dragging=true;}},{signal});
    document.addEventListener('mouseup',(e)=>{if(e.button===0)this.shooting=false;if(e.button===2){this.dragging=false;}},{signal});
    this.renderer.domElement.addEventListener('contextmenu',(e)=>e.preventDefault(),{signal});
    document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===this.renderer.domElement){this.state.fallback=false;this.emit();}else if(!this.state.fallback)this.pause();},{signal});
    document.addEventListener('pointerlockerror',()=>{this.state.fallback=true;this.emit();},{signal});
    window.addEventListener('blur',()=>this.pause(),{signal});document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pause();},{signal});
  }
  switchWeapon(index:number){if(this.state.phase!=='playing'||this.state.weapon===index)return;this.presentation.reset();this.aiming=false;this.reloadLeft=0;this.state.reloading=0;this.state.weapon=index;this.cooldown=.25;this.guns.forEach((g,i)=>g.visible=i===index);this.syncAmmo();this.audio.reload();}
  syncAmmo(){Object.assign(this.state,this.ammo[this.state.weapon]);}
  reload(){const w=WEAPONS[this.state.weapon],a=this.ammo[this.state.weapon];if(this.state.phase!=='playing'||this.reloadLeft>0||a.ammo===w.capacity||a.reserve===0)return;this.reloadTotal=w.reload;this.reloadLeft=w.reload;this.aiming=false;this.audio.reload();}
  spawnPlayer(safe=true){
    let p=SPAWNS[0];
    if(safe)p=[...SPAWNS].sort((a,b)=>this.safety(b)-this.safety(a))[0];
    this.state.x=p.x;this.state.z=p.z;this.state.health=100;this.state.protection=2.5;
    this.yaw=Math.atan2(p.x,p.z);this.pitch=0;this.jump=0;this.velocityY=0;this.recoil=0;
    this.ammo=WEAPONS.map(w=>({ammo:w.capacity,reserve:w.reserve}));this.reloadLeft=0;this.state.reloading=0;this.cooldown=.3;this.syncAmmo();this.keys.clear();this.shooting=false;this.aiming=false;this.presentation.reset();
  }
  safety(p:Point){return Math.min(...this.bots.filter(b=>b.health>0).map(b=>Math.hypot(p.x-b.root.position.x,p.z-b.root.position.z)),100);}
  respawnBot(b:Bot){
    const options=[...SPAWNS].sort((a,c)=>{
      const score=(p:Point)=>Math.hypot(p.x-this.state.x,p.z-this.state.z)+(lineClear({...p,y:1.6},{x:this.state.x,y:1.6,z:this.state.z})?0:15);
      return score(c)-score(a);
    });
    const p=options.find(p=>this.bots.every(other=>other===b||other.health<=0||Math.hypot(other.root.position.x-p.x,other.root.position.z-p.z)>2))??options[0];
    b.root.position.set(p.x,0,p.z);b.root.visible=true;b.health=100;b.noticed=0;b.cooldown=1;b.path=[];b.repath=0;b.spawnShield=1;b.lastSeen=null;
  }
  addFeed(attacker:string,victim:string,headshot=false){this.state.feed.unshift({id:Date.now()+Math.random(),attacker,victim,headshot});this.feedTimes.unshift(this.clock);this.state.feed=this.state.feed.slice(0,4);this.feedTimes=this.feedTimes.slice(0,4);}
  tracer(start:THREE.Vector3,end:THREE.Vector3,enemy=false){
    const geometry=new THREE.BufferGeometry().setFromPoints([start,end]);const mesh=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:enemy?0xff8762:0xffdb95,transparent:true,opacity:.75}));
    this.scene.add(mesh);this.effects.push({mesh,life:.08,max:.08});
  }
  spark(point:THREE.Vector3,hit=false){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(hit?.09:.045,4,4),new THREE.MeshBasicMaterial({color:hit?0xffad71:0xffdda1}));mesh.position.copy(point);this.scene.add(mesh);this.effects.push({mesh,life:.16,max:.16});
  }
  shoot(){
    const index=this.state.weapon,w=WEAPONS[index],a=this.ammo[index];
    if(this.cooldown>0||this.reloadLeft>0||this.state.health<=0)return;
    if(a.ammo<=0){this.reload();return;}
    a.ammo--;this.syncAmmo();this.state.shots++;this.cooldown=w.rate;this.audio.shot();this.flashTime=.045;this.recoil=Math.min(this.recoil+.045,.12);this.presentation.shoot();
    const spread=w.spread*(this.aiming?.28:1)*(this.moving?2.4:1)*(this.jump>0?3:1)*(this.keys.has('ControlLeft')?.65:1);
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((Math.random()-.5)*spread,(Math.random()-.5)*spread),this.camera);
    this.scene.updateMatrixWorld(true);
    const targets=this.bots.filter(b=>b.health>0).flatMap(b=>b.targets);
    const hits=ray.intersectObjects([...this.solid,...targets],false);const hit=hits[0];
    const end=hit?.point??ray.ray.at(65,new THREE.Vector3());
    this.tracer(this.gunRig.localToWorld(new THREE.Vector3(0,0,index===0?-1.1:-.26)),end);if(hit)this.spark(end,hit.object.userData.bot!==undefined);
    if(hit&&hit.object.userData.bot!==undefined){
      const b=this.bots[hit.object.userData.bot];if(b.spawnShield>0){this.feedback.get(b.id)?.hit(true);return;}this.feedback.get(b.id)?.hit();
      const headshot=hit.object.userData.hit==='head';b.health-=w.damage*(headshot?3.7:1);b.lastSeen={x:this.state.x,z:this.state.z};b.repath=0;
      this.state.hits++;this.state.hit=headshot?2:1;this.audio.hit();
      if(b.health<=0){b.root.visible=false;b.dead=3;this.state.kills++;if(headshot)this.state.headshots++;this.addFeed('你',`BOT ${String(b.id+1).padStart(2,'0')}`,headshot);this.audio.kill();
        // Eliminations replenish reserves so a long match cannot become unwinnable.
        this.ammo.forEach((ammo,i)=>ammo.reserve=Math.min(ammo.reserve+WEAPONS[i].capacity,WEAPONS[i].reserve));this.syncAmmo();
      }
    }
    this.pitch=Math.min(1.4,this.pitch+(this.aiming?.003:.006));
  }
  updateBots(dt:number){
    const cfg=DIFFICULTY[this.options.difficulty],player={x:this.state.x,y:this.camera.position.y,z:this.state.z};
    for(const b of this.bots){
      if(b.health<=0){b.dead-=dt;if(b.dead<=0)this.respawnBot(b);continue;}
      b.spawnShield=Math.max(0,b.spawnShield-dt);b.cooldown-=dt;b.repath-=dt;
      const pos=b.root.position,dx=player.x-pos.x,dz=player.z-pos.z,distance=Math.hypot(dx,dz);
      const see=this.state.health>0&&distance<33&&lineClear({x:pos.x,y:1.55,z:pos.z},player);
      if(see){b.noticed+=dt;b.lastSeen={x:player.x,z:player.z};}else b.noticed=Math.max(0,b.noticed-dt*2);
      let mx=0,mz=0;
      if(see){
        b.root.rotation.y=Math.atan2(-dx,-dz);
        if(distance<6){mx=-dx/distance;mz=-dz/distance;}
        else if(distance<18){const sign=Math.sin(this.clock*.8+b.id*2)>0?1:-1;mx=-dz/distance*sign*.55;mz=dx/distance*sign*.55;}
        else{mx=dx/distance;mz=dz/distance;}
        if(b.noticed>cfg.reaction&&b.cooldown<=0&&this.state.protection<=0){
          b.cooldown=cfg.rate*(.85+Math.random()*.5);this.audio.shot(true);
          const accuracy=cfg.accuracy*(1-distance/70)*(this.moving?.75:1)*(this.keys.has('ControlLeft')?.8:1);
          const succeeds=Math.random()<accuracy;
          const end=new THREE.Vector3(player.x,player.y-.12,player.z);if(!succeeds)end.add(new THREE.Vector3((Math.random()-.5)*4,1+Math.random()*2,(Math.random()-.5)*4));
          const from=b.root.localToWorld(b.muzzle.clone());this.tracer(from,end,true);
          if(succeeds){this.state.health=Math.max(0,this.state.health-WEAPONS[0].damage);this.state.hurt=1;
            if(this.state.health<=0){this.state.deaths++;this.state.phase='respawn';this.state.respawn=3;this.shooting=false;this.aiming=false;this.presentation.reset();this.reloadLeft=0;this.state.reloading=0;this.addFeed(`BOT ${String(b.id+1).padStart(2,'0')}`,'你');}
          }
        }
      }else{
        if(b.repath<=0){
          const patrol=SPAWNS[(b.id+Math.floor(this.clock/12))%SPAWNS.length];
          // After visual contact pursue the last seen location, then resume patrol.
          const target=b.lastSeen??patrol;
          if(b.lastSeen&&Math.hypot(target.x-pos.x,target.z-pos.z)<1.6)b.lastSeen=null;
          b.path=findPath(pos,target);b.repath=.8+Math.random()*.3;
        }
        while(b.path.length&&Math.hypot(b.path[0].x-pos.x,b.path[0].z-pos.z)<.5)b.path.shift();
        if(b.path.length){const target=b.path[0],dist=Math.hypot(target.x-pos.x,target.z-pos.z);mx=(target.x-pos.x)/dist;mz=(target.z-pos.z)/dist;b.root.rotation.y=Math.atan2(-mx,-mz);}
      }
      const next=moveActor(pos,mx*cfg.speed*dt,mz*cfg.speed*dt,OBSTACLES,.46);
      const crowded=this.bots.some(other=>other!==b&&other.health>0&&Math.hypot(other.root.position.x-next.x,other.root.position.z-next.z)<.8);
      if(!crowded&&!(this.state.health>0&&Math.hypot(next.x-player.x,next.z-player.z)<1)){pos.x=next.x;pos.z=next.z;}
      b.walk+=dt*Math.hypot(mx,mz)*8;b.legs.forEach((leg,i)=>leg.rotation.x=Math.sin(b.walk+i*Math.PI)*.38);pos.y=Math.abs(Math.sin(b.walk))*.025;
    }
  }
  updatePlayer(dt:number){
    this.aiming=this.presentation.aimIntent&&this.reloadLeft<=0;
    const crouch=this.keys.has('ControlLeft')||this.keys.has('ControlRight')||this.keys.has('KeyC');
    let forward=Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS')),right=Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA'));
    const length=Math.hypot(forward,right);if(length>0){forward/=length;right/=length;}this.moving=length>0;
    const sprint=readMovementControls(this.keys,this.aiming).sprint;
    if(sprint){this.presentation.aimIntent=false;this.presentation.aim=false;this.aiming=false;}
    const speed=crouch?2.1:sprint?7.2:this.aiming?3:4.6;
    if(this.keys.has('ArrowLeft'))this.yaw+=dt*1.8;if(this.keys.has('ArrowRight'))this.yaw-=dt*1.8;
    if(this.keys.has('ArrowUp'))this.pitch=Math.min(1.4,this.pitch+dt);if(this.keys.has('ArrowDown'))this.pitch=Math.max(-1.4,this.pitch-dt);
    const dx=(-Math.sin(this.yaw)*forward+Math.cos(this.yaw)*right)*speed*dt,dz=(-Math.cos(this.yaw)*forward-Math.sin(this.yaw)*right)*speed*dt;
    const p=moveActor({x:this.state.x,z:this.state.z},dx,dz);this.state.x=p.x;this.state.z=p.z;
    this.velocityY-=15*dt;this.jump=Math.max(0,this.jump+this.velocityY*dt);if(this.jump===0)this.velocityY=0;
    const bob=this.moving&&this.jump===0?Math.sin(this.clock*(sprint?14:10))*.035:0;
    this.camera.position.set(p.x,(crouch?1.05:1.68)+this.jump+bob,p.z);this.camera.rotation.set(this.pitch+this.recoil*.2,this.yaw,0);
    this.camera.updateMatrixWorld(true);this.state.yaw=this.yaw;this.state.aim=this.aiming;

    if(this.moving&&this.jump===0){this.stepTimer-=dt;if(this.stepTimer<=0){this.audio.step();this.stepTimer=sprint?.28:.42;}}
    if(this.shooting&&!sprint)this.shoot();
    const pose=this.presentation.update(dt,{reloadLeft:this.reloadLeft,reloadTotal:this.reloadTotal,alive:this.state.health>0,sprint,bob});
    this.camera.fov=pose.fov;this.camera.updateProjectionMatrix();
    this.gunRig.position.set(pose.x,pose.y,pose.z);
    this.gunRig.rotation.set(pose.rotationX,0,pose.rotationZ);
  }
  removeEffect(e:Effect){this.scene.remove(e.mesh);const m=e.mesh as THREE.Mesh;m.geometry?.dispose();if(m.material){const materials=Array.isArray(m.material)?m.material:[m.material];materials.forEach(mat=>mat.dispose());}}
  loop=(now:number)=>{
    if(this.disposed)return;const dt=Math.min((now-(this.last||now))/1000,.05);this.last=now;this.idle+=dt;
    const active=this.state.phase==='playing'||this.state.phase==='respawn';
    if(active){
      this.clock+=dt;this.state.time=Math.max(0,this.state.time-dt);this.cooldown-=dt;this.recoil=Math.max(0,this.recoil-dt*.3);
      this.state.hit=Math.max(0,this.state.hit-dt*4);this.state.hurt=Math.max(0,this.state.hurt-dt*1.8);this.state.protection=Math.max(0,this.state.protection-dt);
      if(this.reloadLeft>0){this.reloadLeft-=dt;this.state.reloading=Math.max(0,this.reloadLeft/this.reloadTotal);if(this.reloadLeft<=0){const index=this.state.weapon;this.ammo[index]=reloadAmmo(this.ammo[index].ammo,this.ammo[index].reserve,WEAPONS[index].capacity);this.syncAmmo();this.audio.reload();}}
      if(this.state.phase==='playing')this.updatePlayer(dt);
      else{this.state.respawn-=dt;this.camera.rotation.z=THREE.MathUtils.damp(this.camera.rotation.z,-.17,2,dt);if(this.state.respawn<=0){this.spawnPlayer();this.state.phase='playing';}}
      this.updateBots(dt);
      const result=matchOutcome(this.state.kills,this.state.deaths,this.state.time);
      if(result){this.state.result=result;this.state.phase='finished';this.presentation.reset();this.aiming=false;this.shooting=false;this.keys.clear();if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();this.audio.tone(result==='win'?700:220,.7,.09);this.emit();}
      while(this.feedTimes.length&&this.clock-this.feedTimes[this.feedTimes.length-1]>6){this.feedTimes.pop();this.state.feed.pop();}
      for(let i=this.effects.length-1;i>=0;i--){const e=this.effects[i];e.life-=dt;if(e.life<=0){this.removeEffect(e);this.effects.splice(i,1);}}
    }
    if(this.state.phase==='menu'){
      this.camera.position.set(18+Math.sin(this.idle*.075)*2,12,21);this.camera.lookAt(-1,1,-3);this.camera.fov=64;this.camera.updateProjectionMatrix();this.gunRig.visible=false;
    }else this.gunRig.visible=this.state.health>0;
    this.flashTime-=dt;this.flash.visible=this.flashTime>0;this.flash.position.z=this.state.weapon===0?-1.16:-.27;this.flashLight.intensity=this.flashTime>0?4:0;
    this.camera.updateMatrixWorld(true);for(const b of this.bots)this.feedback.get(b.id)?.update(this.camera,b.health>0,b.spawnShield);
    this.renderer.render(this.scene,this.camera);
    this.notifyElapsed+=dt;if(this.notifyElapsed>.075){this.state.fps=Math.round(1/Math.max(dt,.001));this.notifyElapsed=0;this.emit();}
    this.frame=requestAnimationFrame(this.loop);
  };
  dispose(){
    this.disposed=true;for(const effect of this.feedback.values())effect.dispose();this.feedback.clear();cancelAnimationFrame(this.frame);this.abort.abort();this.resizeObserver.disconnect();if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();this.audio.dispose();
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
    this.scene.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>materials.add(m));});
    materials.forEach(m=>{for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose();});textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());this.renderer.dispose();this.renderer.domElement.remove();
  }
}
