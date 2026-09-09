import { advanceActor, forwardFromYaw, lineClear, reloadAmmo, SPAWNS, yawToward, type MovementInput, type MovementState } from '../lib/game/rules.ts';
import { MATCH_SECONDS, SCORE_LIMIT, SERVER_TICK_RATE } from '../shared/config.ts';
import type { Difficulty, SnapshotEntity, Weapon } from '../shared/protocol.ts';
import { traceWeaponShot } from '../shared/combat.ts';
import { PositionHistory } from './history.ts';
import { BotController } from './bots.ts';

export const WEAPONS = {
  rifle: { capacity: 30, reserve: 120, damage: 29, cadence: 0.105, reload: 1.9, range: 70 },
  pistol: { capacity: 12, reserve: 60, damage: 39, cadence: 0.27, reload: 1.3, range: 50 },
} as const;

type Participant = { id:string;nickname:string;x:number;z:number;isBot?:boolean };
type InputState = MovementInput & { sequence:number;clientTime:number;pitch:number;dt?:number;life?:number };
type FireInput={sequence:number;weapon:Weapon;yaw:number;pitch:number;clientTime:number;inputSequence?:number;life?:number};
export type SimPlayer = Participant & MovementState & {
  isBot:boolean;yaw:number;pitch:number;health:number;alive:boolean;kills:number;deaths:number;
  weapon:Weapon;ammo:number;reserve:number;lastInput:number;input:InputState;cooldown:number;
  inventory:Record<Weapon,{ammo:number;reserve:number}>;
  queued:InputState[];lastReceived:number;credit:number;life:number;lastShot?:number;
  reloadLeft:number;respawnLeft:number;spawnProtection:number;
};

type SimulationOptions={scoreLimit?:number;matchSeconds?:number;difficulty?:Difficulty;now?:()=>number};
type SimulationEvent=
  | {type:'shot';actorId:string;yaw:number;pitch:number;end?:{x:number;y:number;z:number}}
  | {type:'hit'|'headshot'|'kill'|'reload'|'respawn';actorId:string;targetId?:string;value?:number};

export class MatchSimulation {
  readonly players = new Map<string, SimPlayer>();
  readonly events: SimulationEvent[] = [];
  readonly history = new PositionHistory();
  tickNumber = 0;
  remainingSeconds:number;
  finished=false;
  winnerId?:string;
  private elapsed=0;
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

  applyInput(id:string,message:InputState){
    const player=this.player(id);if(!player.alive||message.sequence<=player.lastReceived||message.life!==undefined&&message.life!==player.life||player.queued.length>=100)return false;
    player.lastReceived=message.sequence;player.queued.push(message);return true;
  }

  switchWeapon(id:string,weapon:Weapon){const p=this.player(id);if(!p.alive||p.weapon===weapon)return false;p.reloadLeft=0;p.inventory[p.weapon]={ammo:p.ammo,reserve:p.reserve};p.weapon=weapon;({ammo:p.ammo,reserve:p.reserve}=p.inventory[weapon]);p.cooldown=.25;return true;}
  reload(id:string){const p=this.player(id),w=WEAPONS[p.weapon];if(!p.alive||p.reloadLeft>0||p.ammo>=w.capacity||p.reserve<=0)return false;p.reloadLeft=w.reload;this.events.push({type:'reload',actorId:id});return true;}

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
    if(this.finished||!shooter.alive||shooter.cooldown>1/SERVER_TICK_RATE||shooter.reloadLeft>0||shooter.ammo<=0||message.weapon!==shooter.weapon)return false;
    shooter.ammo-=1;shooter.inventory[shooter.weapon].ammo=shooter.ammo;shooter.cooldown=weapon.cadence;
    const origin={x:shooter.x,y:shooter.y+(shooter.crouched?1.05:1.68),z:shooter.z};
    const targets=[...this.players.values()].filter(target=>target.id!==id).map(target=>{
      const historic=this.history.sample(target.id,Math.max(this.now()-200,Math.min(this.now(),message.clientTime)));
      return {...target,x:historic?.x??target.x,z:historic?.z??target.z};
    });
    const shot=traceWeaponShot(origin,message.yaw,message.pitch,shooter.weapon,Boolean(shooter.input.aiming),targets);
    this.events.push({type:'shot',actorId:id,yaw:message.yaw,pitch:message.pitch,end:shot.end});
    const best=shot.targetId?this.players.get(shot.targetId):undefined,bestHeadshot=shot.headshot;
    if(best&&best.spawnProtection<=0){
      const damage=bestHeadshot?weapon.damage*4:weapon.damage;
      best.health=Math.max(0,best.health-damage);this.events.push({type:bestHeadshot?'headshot':'hit',actorId:id,targetId:best.id,value:damage});
      if(best.health<=0){best.alive=false;best.deaths+=1;best.respawnLeft=3;shooter.kills+=1;this.events.push({type:'kill',actorId:id,targetId:best.id});if(shooter.kills>=this.scoreLimit){this.finished=true;this.winnerId=id;}}
    }
    return true;
  }

  tick(dt:number){
    if(this.finished)return;this.elapsed+=dt;this.remainingSeconds=Math.max(0,this.remainingSeconds-dt);this.tickNumber+=1;
    for(const p of this.players.values()){
      p.cooldown=Math.max(0,p.cooldown-dt);p.spawnProtection=Math.max(0,p.spawnProtection-dt);
      if(p.reloadLeft>0){p.reloadLeft-=dt;if(p.reloadLeft<=0){const w=WEAPONS[p.weapon],loaded=reloadAmmo(p.ammo,p.reserve,w.capacity);p.ammo=loaded.ammo;p.reserve=loaded.reserve;p.inventory[p.weapon]=loaded;}}
      if(!p.alive){p.respawnLeft-=dt;if(p.respawnLeft<=0)this.respawn(p);continue;}
      if(p.isBot){this.updateBot(p,dt);this.move(p,p.input,dt);}
      else{
        p.credit=Math.min(.25,p.credit+dt);
        this.applyActions(p);
        while(p.queued.length){const command=p.queued[0],duration=command.dt??.05;if(duration>p.credit+1e-8)break;p.queued.shift();p.credit=Math.max(0,p.credit-duration);this.move(p,command,duration);p.input=command;p.yaw=command.yaw;p.pitch=command.pitch;p.lastInput=command.sequence;this.applyActions(p);}
      }
    }
    this.history.record(this.now(),new Map([...this.players].map(([id,p])=>[id,{x:p.x,z:p.z}])));
    if(this.remainingSeconds<=0){const ranked=[...this.players.values()].sort((a,b)=>b.kills-a.kills),top=ranked[0]?.kills;this.finished=true;this.winnerId=ranked.filter(player=>player.kills===top).length===1?ranked[0]?.id:undefined;}
  }

  snapshot():SnapshotEntity[]{return [...this.players.values()].map(p=>({id:p.id,nickname:p.nickname,isBot:p.isBot,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,health:p.health,weapon:p.weapon,ammo:p.ammo,reserve:p.reserve,kills:p.kills,deaths:p.deaths,alive:p.alive,reloadLeft:Math.max(0,p.reloadLeft),spawnProtection:Math.max(0,p.spawnProtection),velocityY:p.velocityY,grounded:p.grounded,crouched:Boolean(p.crouched),life:p.life,respawnLeft:p.respawnLeft,lastShot:p.lastShot}));}
  drainEvents(){return this.events.splice(0);}

  private move(p:SimPlayer,input:MovementInput,dt:number){const next=advanceActor(p,input,p,dt);p.x=next.position.x;p.z=next.position.z;Object.assign(p,next.movement);}

  private updateBot(bot:SimPlayer,dt:number){
    const decision=this.bots.update(bot,[...this.players.values()],dt);bot.yaw=decision.yaw;bot.pitch=decision.pitch;
    bot.input={...bot.input,...decision.input,sequence:++bot.lastInput,pitch:decision.pitch};
    if(decision.reload)this.reload(bot.id);
    if(decision.fire)this.fire(bot.id,{sequence:bot.lastInput,weapon:bot.weapon,yaw:bot.yaw,pitch:bot.pitch,clientTime:this.now()});
  }

  private respawn(p:SimPlayer){const index=[...this.players.keys()].indexOf(p.id)%SPAWNS.length,spawn=SPAWNS[index],inventory={rifle:{ammo:WEAPONS.rifle.capacity,reserve:WEAPONS.rifle.reserve},pistol:{ammo:WEAPONS.pistol.capacity,reserve:WEAPONS.pistol.reserve}};Object.assign(p,{x:spawn.x,z:spawn.z,y:0,velocityY:0,grounded:true,health:100,alive:true,inventory,ammo:inventory[p.weapon].ammo,reserve:inventory[p.weapon].reserve,spawnProtection:3,respawnLeft:0,queued:[],credit:0,life:p.life+1});this.bots.reset(p.id);this.events.push({type:'respawn',actorId:p.id});}
  private makePlayer(p:Participant,index:number):SimPlayer{const inventory={rifle:{ammo:WEAPONS.rifle.capacity,reserve:WEAPONS.rifle.reserve},pistol:{ammo:WEAPONS.pistol.capacity,reserve:WEAPONS.pistol.reserve}};return {...p,isBot:Boolean(p.isBot),y:0,velocityY:0,grounded:true,crouched:false,yaw:0,pitch:0,health:100,alive:true,kills:0,deaths:0,weapon:'rifle',ammo:inventory.rifle.ammo,reserve:inventory.rifle.reserve,inventory,lastInput:-1,lastReceived:-1,queued:[],credit:0,life:0,input:{sequence:-1,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,clientTime:0},cooldown:0,reloadLeft:0,respawnLeft:0,spawnProtection:3,x:p.x??SPAWNS[index].x,z:p.z??SPAWNS[index].z};}
}
