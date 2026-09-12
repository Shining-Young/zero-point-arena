import { GameConnection } from './client.ts';
import { MatchSimulation } from '../../server/simulation.ts';
import type { ClientMessage,Difficulty,ServerMessage } from '../../shared/protocol.ts';
/** Offline transport: runs the exact same authoritative match rules without any socket. */
export class LocalGameConnection extends GameConnection{
 private simulation:MatchSimulation;private sinks=new Set<(message:ServerMessage)=>void>();private loop?:ReturnType<typeof setInterval>;
 paused=true;private previous=0;
 constructor(difficulty:Difficulty='normal'){
  super({url:'offline',storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});this.playerId='training-player';this.latency=0;
  this.simulation=new MatchSimulation([{id:this.playerId,nickname:'你',x:-19,z:19},...Array.from({length:4},(_,i)=>({id:`bot-${i+1}`,nickname:`BOT ${String(i+1).padStart(2,'0')}`,x:i%2?19:-19,z:i<2?-19:19,isBot:true}))],{difficulty});
 }
 override connect(){this.phase='playing';this.previous=performance.now();this.publish();this.loop=setInterval(()=>this.tick(),50);}
 setPaused(paused:boolean){this.paused=paused;this.previous=performance.now();}
 override subscribe(listener:(message:ServerMessage)=>void){this.sinks.add(listener);return()=>this.sinks.delete(listener);}
 private emitLocal(message:ServerMessage){for(const sink of this.sinks)sink(message);}
 override send(message:ClientMessage){
  if(this.phase!=='playing')return false;const id=this.playerId!;
  switch(message.type){
   case 'input':this.simulation.applyInput(id,message);break;
   case 'input_batch':for(const c of message.commands)this.simulation.applyInput(id,c);break;
   case 'fire':this.simulation.queueFire(id,message);break;
   case 'reload':this.simulation.queueReload(id);break;
   case 'switch_weapon':this.simulation.queueSwitch(id,message.weapon);break;
   case 'shop':{this.simulation.queueBuy(id,message.action,message.weapon,message.requestId,result=>{this.emitLocal({type:'shop_result',requestId:message.requestId,...result});this.publish();});break;}
   default:break;
  }return true;
 }
 override resyncInputs(){this.simulation.resetInputs(this.playerId!);const entity=this.simulation.snapshot().find(p=>p.id===this.playerId)!;this.emitLocal({type:'input_resynced',entity,lastProcessedInput:this.simulation.player(this.playerId!).lastInput});this.publish();}
 private publish(){this.lastSnapshotAt=Date.now();this.emitLocal({type:'snapshot',tick:this.simulation.tickNumber,serverTime:Date.now(),serverTickMs:50,remainingSeconds:this.simulation.remainingSeconds,lastProcessedInput:this.simulation.player(this.playerId!).lastInput,entities:this.simulation.snapshot()});}
 private tick(){
  const now=performance.now(),dt=Math.min(.1,(now-this.previous)/1000);this.previous=now;
  if(!this.paused)this.simulation.tick(dt);
  for(const event of this.simulation.drainEvents()){if(event.type==='shot')this.emitLocal({type:'combat_event',event:'shot',actorId:event.actorId,yaw:event.yaw,pitch:event.pitch,end:event.end,...('ends' in event?{ends:event.ends}:{})});else this.emitLocal({type:'combat_event',event:event.type,actorId:event.actorId,targetId:event.targetId,value:event.value});}
  this.publish();
  if(this.simulation.finished){this.phase='ended';clearInterval(this.loop);this.emitLocal({type:'match_finished',winnerId:this.simulation.winnerId,reason:this.simulation.remainingSeconds<=0?'time':'score'});}
 }
 override close(){clearInterval(this.loop);this.phase='offline';this.sinks.clear();}
 override leave(){this.close();}
}
