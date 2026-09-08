import { advanceActor, forwardFromYaw, lineClear, reloadAmmo, SPAWNS, yawToward, type MovementInput, type MovementState } from '../lib/game/rules.ts';
import { MATCH_SECONDS, SCORE_LIMIT, SERVER_TICK_RATE } from '../shared/config.ts';
import type { Difficulty, SnapshotEntity, Weapon } from '../shared/protocol.ts';
import { PositionHistory } from './history.ts';
import { botSettings } from './bots.ts';

export const WEAPONS = {
  rifle: { capacity: 30, reserve: 120, damage: 29, cadence: 0.105, reload: 1.9, range: 70 },
  pistol: { capacity: 12, reserve: 60, damage: 39, cadence: 0.27, reload: 1.3, range: 50 },
} as const;

type Participant = { id:string;nickname:string;x:number;z:number;isBot?:boolean };
type InputState = MovementInput & { sequence:number;clientTime:number;pitch:number };
export type SimPlayer = Participant & MovementState & {
  isBot:boolean;yaw:number;pitch:number;health:number;alive:boolean;kills:number;deaths:number;
  weapon:Weapon;ammo:number;reserve:number;lastInput:number;input:InputState;cooldown:number;
  inventory:Record<Weapon,{ammo:number;reserve:number}>;
  reloadLeft:number;respawnLeft:number;spawnProtection:number;
};

type SimulationOptions={scoreLimit?:number;matchSeconds?:number;difficulty?:Difficulty;now?:()=>number};
type SimulationEvent=
  | {type:'shot';actorId:string;yaw:number;pitch:number}
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

  constructor(participants:Participant[],options:SimulationOptions={}){
    this.scoreLimit=options.scoreLimit??SCORE_LIMIT;this.remainingSeconds=options.matchSeconds??MATCH_SECONDS;
    this.difficulty=options.difficulty??'normal';this.now=options.now??Date.now;
    participants.forEach((p,index)=>this.players.set(p.id,this.makePlayer(p,index)));
  }

  player(id:string){const player=this.players.get(id);if(!player)throw new Error('PLAYER_NOT_FOUND');return player;}

  applyInput(id:string,message:InputState){
    const player=this.player(id);if(message.sequence<=player.lastInput)return false;
    player.lastInput=message.sequence;player.input=message;player.yaw=message.yaw;player.pitch=message.pitch;return true;
  }

  switchWeapon(id:string,weapon:Weapon){const p=this.player(id);if(!p.alive||p.reloadLeft>0)return false;p.inventory[p.weapon]={ammo:p.ammo,reserve:p.reserve};p.weapon=weapon;({ammo:p.ammo,reserve:p.reserve}=p.inventory[weapon]);p.cooldown=.25;return true;}
  reload(id:string){const p=this.player(id),w=WEAPONS[p.weapon];if(!p.alive||p.reloadLeft>0||p.ammo>=w.capacity||p.reserve<=0)return false;p.reloadLeft=w.reload;this.events.push({type:'reload',actorId:id});return true;}

  fire(id:string,message:{sequence:number;weapon:Weapon;yaw:number;pitch:number;clientTime:number}){
    const shooter=this.player(id),weapon=WEAPONS[shooter.weapon];
    if(this.finished||!shooter.alive||shooter.cooldown>1/SERVER_TICK_RATE||shooter.reloadLeft>0||shooter.ammo<=0||message.weapon!==shooter.weapon)return false;
    shooter.ammo-=1;shooter.inventory[shooter.weapon].ammo=shooter.ammo;shooter.cooldown=weapon.cadence;this.events.push({type:'shot',actorId:id,yaw:message.yaw,pitch:message.pitch});
    const forward=forwardFromYaw(message.yaw),cosPitch=Math.cos(message.pitch),originY=shooter.y+(shooter.crouched?1.15:1.65);
    let best:SimPlayer|undefined,bestAlong=Infinity,bestHeadshot=false;
    for(const target of this.players.values()){
      if(target.id===id||!target.alive)continue;
      const requestedAt=Math.max(this.now()-200,Math.min(this.now(),message.clientTime));
      const historic=this.history.sample(target.id,requestedAt),tx=historic?.x??target.x,tz=historic?.z??target.z;
      const dx=tx-shooter.x,dz=tz-shooter.z,along=dx*forward.x+dz*forward.z;
      if(along<=0||along/Math.max(cosPitch,.01)>weapon.range)continue;
      const perpendicular=Math.abs(dx*forward.z-dz*forward.x);
      if(perpendicular>.55||along>=bestAlong)continue;
      const hitY=originY+Math.tan(message.pitch)*along;
      if(hitY<target.y+.2||hitY>target.y+1.98)continue;
      if(!lineClear({x:shooter.x,y:originY,z:shooter.z},{x:tx,y:hitY,z:tz}))continue;
      best=target;bestAlong=along;bestHeadshot=hitY>=target.y+1.72;
    }
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
      if(p.isBot)this.updateBot(p,dt);
      const next=advanceActor({x:p.x,z:p.z},p.input,p,dt);p.x=next.position.x;p.z=next.position.z;p.y=next.movement.y;p.velocityY=next.movement.velocityY;p.grounded=next.movement.grounded;p.crouched=next.movement.crouched;
    }
    this.history.record(this.now(),new Map([...this.players].map(([id,p])=>[id,{x:p.x,z:p.z}])));
    if(this.remainingSeconds<=0){const ranked=[...this.players.values()].sort((a,b)=>b.kills-a.kills),top=ranked[0]?.kills;this.finished=true;this.winnerId=ranked.filter(player=>player.kills===top).length===1?ranked[0]?.id:undefined;}
  }

  snapshot():SnapshotEntity[]{return [...this.players.values()].map(p=>({id:p.id,nickname:p.nickname,isBot:p.isBot,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,health:p.health,weapon:p.weapon,ammo:p.ammo,reserve:p.reserve,kills:p.kills,deaths:p.deaths,alive:p.alive,reloadLeft:Math.max(0,p.reloadLeft),spawnProtection:Math.max(0,p.spawnProtection)}));}
  drainEvents(){return this.events.splice(0);}

  private updateBot(bot:SimPlayer,dt:number){
    const target=[...this.players.values()].filter(p=>p.alive&&!p.isBot).sort((a,b)=>Math.hypot(a.x-bot.x,a.z-bot.z)-Math.hypot(b.x-bot.x,b.z-bot.z))[0];
    if(!target)return;const dx=target.x-bot.x,dz=target.z-bot.z,dist=Math.hypot(dx,dz);bot.yaw=yawToward(bot,target);
    bot.input={...bot.input,sequence:bot.lastInput+1,moveZ:dist>5?1:0,yaw:bot.yaw};bot.lastInput+=1;
    const settings=botSettings(this.difficulty);
    if(dist<30&&lineClear({x:bot.x,y:1.4,z:bot.z},{x:target.x,y:1.2,z:target.z})&&this.elapsed%(settings.reaction+.01)<dt){this.fire(bot.id,{sequence:bot.lastInput,weapon:bot.weapon,yaw:bot.yaw,pitch:0,clientTime:this.now()});}
  }

  private respawn(p:SimPlayer){const index=[...this.players.keys()].indexOf(p.id)%SPAWNS.length,spawn=SPAWNS[index],inventory={rifle:{ammo:WEAPONS.rifle.capacity,reserve:WEAPONS.rifle.reserve},pistol:{ammo:WEAPONS.pistol.capacity,reserve:WEAPONS.pistol.reserve}};Object.assign(p,{x:spawn.x,z:spawn.z,y:0,velocityY:0,grounded:true,health:100,alive:true,inventory,ammo:inventory[p.weapon].ammo,reserve:inventory[p.weapon].reserve,spawnProtection:3,respawnLeft:0});this.events.push({type:'respawn',actorId:p.id});}
  private makePlayer(p:Participant,index:number):SimPlayer{const inventory={rifle:{ammo:WEAPONS.rifle.capacity,reserve:WEAPONS.rifle.reserve},pistol:{ammo:WEAPONS.pistol.capacity,reserve:WEAPONS.pistol.reserve}};return {...p,isBot:Boolean(p.isBot),y:0,velocityY:0,grounded:true,crouched:false,yaw:0,pitch:0,health:100,alive:true,kills:0,deaths:0,weapon:'rifle',ammo:inventory.rifle.ammo,reserve:inventory.rifle.reserve,inventory,lastInput:-1,input:{sequence:-1,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,clientTime:0},cooldown:0,reloadLeft:0,respawnLeft:0,spawnProtection:3,x:p.x??SPAWNS[index].x,z:p.z??SPAWNS[index].z};}
}
