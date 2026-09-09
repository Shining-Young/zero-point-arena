import type { Difficulty } from '../shared/protocol.ts';
import { findPath, lineClear, moveActor, yawToward, type MovementInput, type Point } from '../lib/game/rules.ts';

const BOT_SETTINGS = {
  easy: { reaction: 1.25, spread: .14, tracking: 1.8, burst: .16, rest: .85 },
  normal: { reaction: .85, spread: .095, tracking: 2.8, burst: .24, rest: .7 },
  hard: { reaction: .5, spread: .067, tracking: 4.2, burst: .32, rest: .5 },
} as const;

export function botSettings(difficulty: Difficulty) { return BOT_SETTINGS[difficulty]; }

export type BotTarget = Point & { id:string; y:number; alive:boolean; crouched?:boolean; isBot?:boolean };
export type BotActor = BotTarget & { yaw:number; pitch:number; ammo:number; reserve:number; reloadLeft:number; cooldown:number };
export type BotDecision = { input:MovementInput; yaw:number; pitch:number; fire:boolean; reload:boolean; targetId?:string };
type BotState = {
  targetId?:string; reactionLeft:number; burstLeft:number; restLeft:number;
  errorLeft:number; errorYaw:number; errorPitch:number; previousTarget?:Point;
  path:Point[]; pathLeft:number;
};
const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.z-b.z);
const angle = (value:number) => Math.atan2(Math.sin(value),Math.cos(value));
const bounded = (value:number,limit:number) => Math.max(-limit,Math.min(limit,value));

/** Chooses intent only: simulation owns collision, cadence, ammunition and damage. */
export class BotController {
  private readonly states = new Map<string,BotState>();
  private readonly settings:ReturnType<typeof botSettings>;
  private readonly random:()=>number;

  constructor(difficulty:Difficulty='normal',random:()=>number=Math.random) {
    this.settings=botSettings(difficulty);this.random=random;
  }

  reset(id:string) { this.states.delete(id); }

  update(bot:BotActor,humans:readonly BotTarget[],dt:number):BotDecision {
    const input:MovementInput={moveX:0,moveZ:0,yaw:bot.yaw,sprint:false,crouch:false,jump:false};
    const decision:BotDecision={input,yaw:bot.yaw,pitch:bot.pitch,fire:false,reload:false};
    if(!bot.alive){this.reset(bot.id);return decision;}
    if(!Number.isFinite(dt)||dt<=0)return decision;
    let state=this.states.get(bot.id);
    if(!state){state={reactionLeft:0,burstLeft:0,restLeft:0,errorLeft:0,errorYaw:0,errorPitch:0,path:[],pathLeft:0};this.states.set(bot.id,state);}
    const eye={x:bot.x,y:bot.y+(bot.crouched?1.15:1.65),z:bot.z};
    const visible=(target:BotTarget)=>lineClear(eye,{x:target.x,y:target.y+(target.crouched ? .9 : 1.25),z:target.z});
    const candidates=humans.filter(target=>target.alive&&!target.isBot&&target.id!==bot.id).sort((a,b)=>distance(bot,a)-distance(bot,b));
    const current=candidates.find(target=>target.id===state.targetId);
    // Retain a visible target to avoid flickering between similarly distant opponents.
    const target=current&&visible(current)?current:candidates.find(visible)??candidates[0];
    decision.reload=bot.ammo<=0&&bot.reserve>0&&bot.reloadLeft<=0;
    if(!target){this.reset(bot.id);return decision;}
    decision.targetId=target.id;
    if(state.targetId!==target.id){
      state.targetId=target.id;state.reactionLeft=this.settings.reaction;state.burstLeft=0;state.restLeft=0;
      state.previousTarget=undefined;state.errorLeft=0;state.pathLeft=0;state.path=[];
    }
    const seen=visible(target),dist=distance(bot,target);
    const speed=state.previousTarget?Math.min(8,distance(state.previousTarget,target)/dt):0;
    state.previousTarget={x:target.x,z:target.z};
    if(!seen){state.reactionLeft=this.settings.reaction;state.burstLeft=0;state.restLeft=0;}
    else state.reactionLeft=Math.max(0,state.reactionLeft-dt);
    state.errorLeft-=dt;
    if(state.errorLeft<=0){
      // Angular spread is calibrated around 15m, not a guaranteed hit percentage.
      const error=this.settings.spread*(.8+dist/75+speed*.08);
      state.errorYaw=(this.random()*2-1)*error;state.errorPitch=(this.random()*2-1)*error*.45;
      state.errorLeft=.18+this.random()*.18;
    }
    const desiredYaw=yawToward(bot,target)+state.errorYaw;
    const desiredPitch=Math.atan2(target.y+(target.crouched ? .9 : 1.25)-eye.y,Math.max(.1,dist))+state.errorPitch;
    decision.yaw=angle(bot.yaw+bounded(angle(desiredYaw-bot.yaw),this.settings.tracking*dt));
    decision.pitch=bot.pitch+bounded(desiredPitch-bot.pitch,this.settings.tracking*.7*dt);
    input.yaw=decision.yaw;

    state.pathLeft-=dt;
    if(dist>4||!seen){
      if(state.pathLeft<=0){state.path=findPath(bot,target);state.pathLeft=.8;}
      while(state.path.length&&distance(bot,state.path[0])<.35)state.path.shift();
      const direct=lineClear({...bot,y:.3},{...target,y:.3});
      const waypoint=direct?target:state.path[0];
      if(waypoint){
        const length=distance(bot,waypoint),dx=(waypoint.x-bot.x)/Math.max(.01,length),dz=(waypoint.z-bot.z)/Math.max(.01,length);
        const probe=moveActor(bot,dx*.4,dz*.4);
        if(distance(bot,probe)>.01){
          const scale=Math.min(1,length/(4.2*dt));
          input.moveX=(dx*Math.cos(input.yaw)-dz*Math.sin(input.yaw))*scale;
          input.moveZ=(-dx*Math.sin(input.yaw)-dz*Math.cos(input.yaw))*scale;
        }else state.pathLeft=0;
      }
    }
    if(!seen||state.reactionLeft>0||dist>35||bot.reloadLeft>0||bot.ammo<=0)return decision;
    if(state.restLeft>0){state.restLeft=Math.max(0,state.restLeft-dt);return decision;}
    if(state.burstLeft<=0)state.burstLeft=this.settings.burst*(.85+this.random()*.3);
    state.burstLeft-=dt;
    decision.fire=bot.cooldown<=0&&Math.abs(angle(desiredYaw-decision.yaw))<.12&&Math.abs(desiredPitch-decision.pitch)<.12;
    if(state.burstLeft<=0)state.restLeft=this.settings.rest*(.85+this.random()*.3);
    return decision;
  }
}

