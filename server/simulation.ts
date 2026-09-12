import { advanceActor, forwardFromYaw, lineClear, reloadAmmo, SPAWNS, yawToward, type MovementInput, type MovementState } from '../lib/game/rules.ts';
import { MATCH_SECONDS, SCORE_LIMIT, SERVER_TICK_RATE } from '../shared/config.ts';
import type { Difficulty, SnapshotEntity, Weapon } from '../shared/protocol.ts';
import { traceWeaponBurst,decayShotHeat } from '../shared/combat.ts';
import { PositionHistory } from './history.ts';
import { BotController } from './bots.ts';

import {WEAPONS,damageAtDistance} from '../shared/weapons.ts';
import type {Inventory,ShopAction} from '../shared/economy.ts';
export {WEAPONS};

type Participant = { id:string;nickname:string;x:number;z:number;isBot?:boolean };
type InputState = MovementInput & { sequence:number;clientTime:number;pitch:number;dt?:number;life?:number };
type FireInput={sequence:number;weapon:Weapon;yaw:number;pitch:number;clientTime:number;inputSequence?:number;life?:number};
export type SimPlayer = Participant & MovementState & {
  isBot:boolean;yaw:number;pitch:number;health:number;alive:boolean;kills:number;deaths:number;
  weapon:Weapon;ammo:number;reserve:number;lastInput:number;input:InputState;cooldown:number;
  inventory:Inventory;coins:number;primary:Weapon|null;shotHeat:number;lastCombat:number;lastFireTime:number;lastClientFire:number;requests:Map<string,{ok:boolean;reason:string}>;
  queued:InputState[];lastReceived:number;credit:number;life:number;lastShot?:number;
  reloadLeft:number;respawnLeft:number;spawnProtection:number;
};

type SimulationOptions={scoreLimit?:number;matchSeconds?:number;difficulty?:Difficulty;now?:()=>number};
type SimulationEvent=
  | {type:'shot';actorId:string;yaw:number;pitch:number;end?:{x:number;y:number;z:number};ends?:{x:number;y:number;z:number}[]}
  | {type:'hit'|'headshot'|'kill'|'reload'|'respawn'|'shield';actorId:string;targetId?:string;value?:number};

export class MatchSimulation {
  readonly players = new Map<string, SimPlayer>();
  readonly events: SimulationEvent[] = [];
  readonly history = new PositionHistory();
  tickNumber = 0;
  remainingSeconds:number;
  finished=false;
  winnerId?:string;
  private elapsed=0;
  private purchases:{id:string;afterInput:number;life:number;action:ShopAction;weapon:Weapon;requestId:string;reply:(result:{ok:boolean;reason:string})=>void;expires:number}[]=[];
  private readonly scoreLimit:number;
  private readonly difficulty:Difficulty;
  private readonly now:()=>number;
  private readonly bots:BotController;
  private actions:{id:string;afterInput:number;life:number;expires:number;execute:()=>void}[]=[];

  constructor(participants:Participant[],options:SimulationOptions={}){
    this.scoreLimit=options.scoreLimit??SCORE_LIMIT;this.remainingSeconds=options.matchSeconds??MATCH_SECONDS;
    this.difficulty=options.difficulty??'normal';this.now=options.now??Date.now;this.bots=new BotController(this.difficulty);
    participants.forEach((p,index)=>this.players.set(p.id,this.makePlayer(p,index)));
  }

  player(id:string){const player=this.players.get(id);if(!player)throw new Error('PLAYER_NOT_FOUND');return player;}

  resetInputs(id:string){
    const p=this.player(id);p.queued=[];p.credit=0;p.life+=1;p.lastReceived=p.lastInput;
    p.input={...p.input,moveX:0,moveZ:0,jump:false,sprint:false,aiming:false};
    this.actions=this.actions.filter(action=>action.id!==id);
  }

  applyInput(id:string,message:InputState){
    const player=this.player(id);if(!player.alive||message.sequence<=player.lastReceived||message.life!==undefined&&message.life!==player.life||player.queued.length>=100)return false;
    player.lastReceived=message.sequence;player.queued.push(message);return true;
  }

  private blocked(p:SimPlayer){if(this.finished)return 'MATCH_FINISHED';if(!p.alive)return 'DEAD';if(!p.grounded||Math.hypot(p.input.moveX,p.input.moveZ)>.01||p.queued.some(q=>Math.hypot(q.moveX,q.moveZ)>.01||q.jump))return 'MOVING';if(this.elapsed-p.lastCombat<2)return 'COMBAT_COOLDOWN';return '';}
  buy(id:string,action:ShopAction,weapon:Weapon,requestId:string){const p=this.player(id),previous=p.requests.get(requestId);if(previous)return previous;const result=(ok:boolean,reason:string)=>{const value={ok,reason};p.requests.set(requestId,value);if(p.requests.size>128)p.requests.delete(p.requests.keys().next().value!);return value;};const blocked=this.blocked(p);if(blocked)return result(false,blocked);const w=WEAPONS[weapon];if(!w)return result(false,'INVALID_WEAPON');
   if(action==='buy_weapon'){if(p.inventory[weapon])return result(false,'ALREADY_OWNED');if(p.coins<w.price)return result(false,'INSUFFICIENT_COINS');p.coins-=w.price;p.inventory[weapon]={ammo:w.capacity,reserve:0};p.primary=weapon;this.switchWeapon(id,weapon);}
   else if(action==='buy_ammo'){const owned=p.inventory[weapon];if(!owned)return result(false,'NOT_OWNED');if(w.unlimitedAmmo)return result(false,'UNLIMITED_AMMO');if(owned.reserve+w.ammoPack>w.reserve)return result(false,'RESERVE_FULL');if(p.coins<w.ammoPrice)return result(false,'INSUFFICIENT_COINS');p.coins-=w.ammoPrice;owned.reserve+=w.ammoPack;if(p.weapon===weapon)p.reserve=owned.reserve;}
   else {if(!p.inventory[weapon])return result(false,'NOT_OWNED');if(weapon!=='pistol')p.primary=weapon;this.switchWeapon(id,weapon);}
   return result(true,'');
  }
  queueBuy(id:string,action:ShopAction,weapon:Weapon,requestId:string,reply:(result:{ok:boolean;reason:string})=>void){if(this.purchases.length>=128){reply({ok:false,reason:'BUSY'});return;}this.purchases.push({id,action,weapon,requestId,reply,life:this.player(id).life,afterInput:this.player(id).lastReceived,expires:this.elapsed+1});}
  switchWeapon(id:string,weapon:Weapon){const p=this.player(id);if(!p.alive||p.weapon===weapon||!p.inventory[weapon]||weapon!=='pistol'&&weapon!==p.primary)return false;p.reloadLeft=0;p.inventory[p.weapon]={ammo:p.ammo,reserve:p.reserve};p.weapon=weapon;({ammo:p.ammo,reserve:p.reserve}=p.inventory[weapon]!);p.cooldown=Math.max(p.cooldown,.25);return true;}
  reload(id:string){const p=this.player(id),w=WEAPONS[p.weapon];if(!p.alive||p.reloadLeft>0||p.ammo>=w.capacity||(!w.unlimitedAmmo&&p.reserve<=0))return false;p.reloadLeft=w.reload;this.events.push({type:'reload',actorId:id});return true;}

  private queueAction(id:string,execute:()=>void,afterInput=this.player(id).lastReceived,life=this.player(id).life){if(this.actions.length<128)this.actions.push({id,afterInput,life,execute,expires:this.elapsed+1});}
  queueFire(id:string,message:FireInput){this.queueAction(id,()=>{this.fire(id,message);},message.inputSequence??this.player(id).lastReceived,message.life??this.player(id).life);}
  queueReload(id:string){this.queueAction(id,()=>{this.reload(id);});}
  queueSwitch(id:string,weapon:Weapon){this.queueAction(id,()=>{this.switchWeapon(id,weapon);});}
  private applyActions(p:SimPlayer){
    const waiting=this.actions;this.actions=[];let blocked=false;
    for(const action of waiting){if(action.id!==p.id){this.actions.push(action);continue;}
      if(action.life!==p.life||action.expires<this.elapsed||!p.alive)continue;
      if(blocked||action.afterInput>p.lastInput){blocked=true;this.actions.push(action);}else action.execute();
    }
  }
  fire(id:string,message:FireInput){
    const shooter=this.player(id),weapon=WEAPONS[shooter.weapon];
    if(message.life!==undefined&&message.life!==shooter.life)return false;
    if(message.sequence<=(shooter.lastShot??-1))return false;shooter.lastShot=message.sequence;
    if(this.finished||!shooter.alive||shooter.cooldown>1e-8||shooter.input.sprint&&!shooter.crouched&&Math.hypot(shooter.input.moveX,shooter.input.moveZ)>.01||shooter.reloadLeft>0||shooter.ammo<=0||message.weapon!==shooter.weapon)return false;
    shooter.ammo-=1;shooter.inventory[shooter.weapon]!.ammo=shooter.ammo;shooter.cooldown=(this.elapsed-shooter.lastFireTime<weapon.cadence*2?Math.max(-Math.min(.05,weapon.cadence*.75),Math.min(0,shooter.cooldown)):0)+weapon.cadence;shooter.lastCombat=this.elapsed;shooter.lastFireTime=this.elapsed;
    const origin={x:shooter.x,y:shooter.y+(shooter.crouched?1.05:1.68),z:shooter.z};
    const targets=[...this.players.values()].filter(target=>target.id!==id).map(target=>{
      const historic=this.history.sample(target.id,Math.max(this.now()-200,Math.min(this.now(),message.clientTime)));
      return {...target,x:historic?.x??target.x,z:historic?.z??target.z};
    });
    const shots=traceWeaponBurst(origin,message.yaw,message.pitch,shooter.weapon,Boolean(shooter.input.aiming&&!shooter.input.sprint),targets,message.sequence,Math.hypot(shooter.input.moveX,shooter.input.moveZ)>.01,Boolean(shooter.crouched),shooter.shotHeat);
    shooter.shotHeat=Math.min(4,shooter.shotHeat+1);this.events.push({type:'shot',actorId:id,yaw:message.yaw,pitch:message.pitch,end:shots[0].end,ends:shots.map(shot=>shot.end)});
    const hits=new Map<string,{damage:number;head:boolean}>();for(const shot of shots){if(!shot.targetId)continue;const hit=hits.get(shot.targetId)??{damage:0,head:false};hit.damage+=damageAtDistance(weapon,Math.hypot(shot.end.x-origin.x,shot.end.y-origin.y,shot.end.z-origin.z),shot.headshot);hit.head ||= shot.headshot;hits.set(shot.targetId,hit);}
    for(const [targetId,hit] of hits){const best=this.player(targetId);if(best.spawnProtection>0){this.events.push({type:'shield',actorId:id,targetId});continue;}best.lastCombat=this.elapsed;best.health=Math.max(0,best.health-hit.damage);this.events.push({type:hit.head?'headshot':'hit',actorId:id,targetId,value:hit.damage});if(best.health<=0&&best.alive){best.alive=false;best.reloadLeft=0;best.deaths++;best.respawnLeft=3;shooter.kills++;shooter.coins=Math.min(6000,shooter.coins+(best.isBot?150:300));this.events.push({type:'kill',actorId:id,targetId});if(shooter.kills>=this.scoreLimit){this.finished=true;this.winnerId=id;}}}
    return true;
  }

  tick(dt:number){
    if(this.finished)return;this.elapsed+=dt;this.remainingSeconds=Math.max(0,this.remainingSeconds-dt);this.tickNumber+=1;
    for(const p of this.players.values()){
      p.cooldown=Math.max(-WEAPONS[p.weapon].cadence,p.cooldown-dt);p.shotHeat=decayShotHeat(p.shotHeat,p.weapon,dt);p.spawnProtection=Math.max(0,p.spawnProtection-dt);
      if(p.reloadLeft>0){p.reloadLeft-=dt;if(p.reloadLeft<=0){const w=WEAPONS[p.weapon],loaded=w.unlimitedAmmo?{ammo:w.capacity,reserve:0}:reloadAmmo(p.ammo,p.reserve,w.capacity);p.ammo=loaded.ammo;p.reserve=loaded.reserve;p.inventory[p.weapon]=loaded;}}
      if(!p.alive){p.respawnLeft-=dt;if(p.respawnLeft<=0)this.respawn(p);continue;}
      if(p.isBot){this.updateBot(p,dt);this.move(p,p.input,dt);}
      else{
        p.credit=Math.min(.25,p.credit+dt);
        this.applyActions(p);
        while(p.queued.length){const command=p.queued[0],duration=command.dt??.05;if(duration>p.credit+1e-8)break;p.queued.shift();p.credit=Math.max(0,p.credit-duration);this.move(p,command,duration);p.input=command;p.yaw=command.yaw;p.pitch=command.pitch;p.lastInput=command.sequence;this.applyActions(p);}
      }
    }
    const purchases=this.purchases;this.purchases=[];for(const purchase of purchases){const p=this.player(purchase.id);if(p.life!==purchase.life){purchase.reply({ok:false,reason:'STALE_LIFE'});continue;}if(p.alive&&p.lastInput<purchase.afterInput&&purchase.expires>this.elapsed){this.purchases.push(purchase);continue;}purchase.reply(this.buy(purchase.id,purchase.action,purchase.weapon,purchase.requestId));}
    this.history.record(this.now(),new Map([...this.players].map(([id,p])=>[id,{x:p.x,z:p.z}])));
    if(this.remainingSeconds<=0){const ranked=[...this.players.values()].sort((a,b)=>b.kills-a.kills),top=ranked[0]?.kills;this.finished=true;this.winnerId=ranked.filter(player=>player.kills===top).length===1?ranked[0]?.id:undefined;}
  }

  snapshot():SnapshotEntity[]{return [...this.players.values()].map(p=>({id:p.id,nickname:p.nickname,isBot:p.isBot,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,health:p.health,weapon:p.weapon,ammo:p.ammo,reserve:p.reserve,kills:p.kills,deaths:p.deaths,alive:p.alive,reloadLeft:Math.max(0,p.reloadLeft),spawnProtection:Math.max(0,p.spawnProtection),velocityY:p.velocityY,grounded:p.grounded,crouched:Boolean(p.crouched),life:p.life,respawnLeft:p.respawnLeft,lastShot:p.lastShot,coins:p.coins,inventory:structuredClone(p.inventory),primary:p.primary,canBuy:!this.blocked(p),buyBlockedReason:this.blocked(p),shotHeat:p.shotHeat}));}
  drainEvents(){return this.events.splice(0);}

  private move(p:SimPlayer,input:MovementInput,dt:number){const next=advanceActor(p,input,p,dt);p.x=next.position.x;p.z=next.position.z;Object.assign(p,next.movement);}

  private updateBot(bot:SimPlayer,dt:number){
    if(bot.weapon!=='pistol'&&bot.ammo===0&&bot.reserve===0)this.switchWeapon(bot.id,'pistol');
    if(bot.primary&&bot.weapon==='pistol'&&(bot.inventory[bot.primary]!.ammo>0||bot.inventory[bot.primary]!.reserve>0))this.switchWeapon(bot.id,bot.primary);
    if(this.shopBot(bot))return;
    const decision=this.bots.update(bot,[...this.players.values()],dt);bot.yaw=decision.yaw;bot.pitch=decision.pitch;
    const target=decision.targetId?this.players.get(decision.targetId):undefined;
    if(target){const distance=Math.hypot(bot.x-target.x,bot.z-target.z);if(bot.weapon==='sniper'){decision.input.aiming=true;if(distance>16&&distance<=WEAPONS.sniper.range&&lineClear({x:bot.x,y:bot.y+1.68,z:bot.z},{x:target.x,y:target.y+1.2,z:target.z})){decision.input.moveX=0;decision.input.moveZ=0;}}else if(bot.weapon==='shotgun'&&distance>3){decision.input.sprint=false;}}
    bot.input={...bot.input,...decision.input,sequence:++bot.lastInput,pitch:decision.pitch};
    if(decision.reload||bot.ammo===0&&WEAPONS[bot.weapon].unlimitedAmmo)this.reload(bot.id);
    if(decision.fire)this.fire(bot.id,{sequence:bot.lastInput,weapon:bot.weapon,yaw:bot.yaw,pitch:bot.pitch,clientTime:this.now()});
  }

  private shopBot(p:SimPlayer){
    const preferences:Weapon[]=['smg','shotgun','rifle','sniper'];const botIndex=[...this.players.values()].filter(actor=>actor.isBot).findIndex(actor=>actor.id===p.id);const wanted=p.primary??preferences[Math.max(0,botIndex)%preferences.length],w=WEAPONS[wanted];
    const owned=p.inventory[wanted],canSpend=owned?owned.reserve+w.ammoPack<=w.reserve&&p.coins>=w.ammoPrice:p.coins>=w.price;
    if(!canSpend||this.elapsed-p.lastCombat<2||!p.grounded)return false;
    p.input={...p.input,moveX:0,moveZ:0,sprint:false};if(!this.blocked(p))this.buy(p.id,owned?'buy_ammo':'buy_weapon',wanted,'bot-'+this.tickNumber);return true;
  }
  private respawn(p:SimPlayer){const index=[...this.players.keys()].indexOf(p.id)%SPAWNS.length,spawn=SPAWNS[index];Object.assign(p,{x:spawn.x,z:spawn.z,y:0,velocityY:0,grounded:true,health:100,alive:true,spawnProtection:3,respawnLeft:0,reloadLeft:0,queued:[],credit:0,life:p.life+1,input:{...p.input,moveX:0,moveZ:0,jump:false,sprint:false,aiming:false}});this.bots.reset(p.id);this.events.push({type:'respawn',actorId:p.id});}
  private makePlayer(p:Participant,index:number):SimPlayer{const inventory:Inventory={pistol:{ammo:12,reserve:0}};return {...p,isBot:Boolean(p.isBot),y:0,velocityY:0,grounded:true,crouched:false,yaw:0,pitch:0,health:100,alive:true,kills:0,deaths:0,weapon:'pistol',ammo:12,reserve:0,inventory,coins:0,primary:null,shotHeat:0,lastCombat:-Infinity,lastFireTime:-Infinity,lastClientFire:-Infinity,requests:new Map(),lastInput:-1,lastReceived:-1,queued:[],credit:0,life:0,input:{sequence:-1,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,clientTime:0},cooldown:0,reloadLeft:0,respawnLeft:0,spawnProtection:3,x:p.x??SPAWNS[index].x,z:p.z??SPAWNS[index].z};}
}
