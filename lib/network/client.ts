import { parseServerMessage, PROTOCOL_VERSION, RELEASE_VERSION, type ClientMessage, type ServerMessage } from '../../shared/protocol.ts';
import type { ConnectionPhase } from './store.ts';
type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};
type SocketLike={readyState:number;send(raw:string):void;close():void;addEventListener(type:string,listener:(event:any)=>void):void};
type Options={url:string;socketFactory?:(url:string)=>SocketLike;storage?:StorageLike;now?:()=>number;setTimeout?:(fn:()=>void,ms:number)=>unknown;clearTimeout?:(id:unknown)=>void};
const REALTIME=new Set(['input','input_batch','fire','reload','switch_weapon','resync_input','ping','shop']);
export class GameConnection{
 phase:ConnectionPhase='offline';playerId?:string;reconnectToken?:string;latency=-1;
 lastSnapshotAt=0;serverTickMs=50;recovering=false;
 private socket?:SocketLike;private listeners=new Set<(message:ServerMessage)=>void>();private queued:ClientMessage[]=[];private manual=false;private attempt=0;private timer?:unknown;private heartbeat?:unknown;private receivedAt=0;private pingAt?:number;private recoveryAt=0;
 private readonly socketFactory:(url:string)=>SocketLike;private readonly storage?:StorageLike;private readonly schedule:(fn:()=>void,ms:number)=>unknown;private readonly cancel:(id:unknown)=>void;private readonly now:()=>number;
 constructor(private readonly options:Options){
  this.socketFactory=options.socketFactory??(url=>new WebSocket(url));this.storage=options.storage??(typeof localStorage==='undefined'?undefined:localStorage);
  this.now=options.now??Date.now;
  this.schedule=options.setTimeout??((fn,ms)=>{const timer=setTimeout(fn,ms);(timer as unknown as {unref?:()=>void}).unref?.();return timer});this.cancel=options.clearTimeout??(id=>clearTimeout(id as ReturnType<typeof setTimeout>));
  this.reconnectToken=this.storage?.getItem('zero-point-reconnect')??undefined;
 }
 connect(){
  this.manual=false;this.phase=this.attempt?'reconnecting':'connecting';const socket=this.socketFactory(this.options.url);this.socket=socket;
  socket.addEventListener('open',()=>{if(this.socket!==socket||this.manual)return;this.receivedAt=this.now();this.recoveryAt=this.now();this.latency=-1;this.sendNow({type:'hello',protocolVersion:PROTOCOL_VERSION,releaseVersion:RELEASE_VERSION,...(this.reconnectToken?{reconnectToken:this.reconnectToken}:{})});for(const message of this.queued)this.sendNow(message);this.queued=[];this.watch(socket);});
  socket.addEventListener('message',event=>{
   if(this.socket!==socket||this.manual)return;let message:ServerMessage;
   try{message=parseServerMessage(String(event.data));}catch{return;}
   this.receivedAt=this.now();this.attempt=0;
   if(message.type==='pong'){if(message.clientTime===this.pingAt)this.latency=Math.max(0,this.now()-message.clientTime);return;}
   if(message.type==='welcome'){this.playerId=message.playerId;this.reconnectToken=message.reconnectToken;this.storage?.setItem('zero-point-reconnect',message.reconnectToken);this.recovering=false;this.lastSnapshotAt=this.now();}
   if(message.type==='room_state')this.phase=message.phase==='playing'?'playing':message.phase==='finished'?'ended':'lobby';
   if(message.type==='match_started'){this.phase='playing';this.lastSnapshotAt=this.now();this.recovering=false;}
   if(message.type==='snapshot'){this.lastSnapshotAt=this.now();this.serverTickMs=message.serverTickMs??50;}
   if(message.type==='input_resynced'){this.recovering=false;this.lastSnapshotAt=this.now();}
   if(message.type==='match_finished')this.phase='ended';
   if(message.type==='error'&&message.code==='INPUT_RATE_LIMIT')this.resyncInputs();
   if(message.type==='error'&&message.code==='VERSION_MISMATCH'){this.phase='ended';this.manual=true;this.cancel(this.heartbeat);socket.close();}
   for(const listener of this.listeners)listener(message);
  });
  socket.addEventListener('close',()=>this.restart(socket));
 }
 private restart(socket:SocketLike){
  if(this.socket!==socket||this.manual)return;
  this.socket=undefined;this.cancel(this.heartbeat);this.phase='reconnecting';this.recovering=true;
  const delays=[1000,2000,4000,8000],delay=delays[Math.min(this.attempt++,delays.length-1)];
  this.timer=this.schedule(()=>this.connect(),delay);
  if(socket.readyState<2)socket.close();
 }

 private watch(socket:SocketLike){this.heartbeat=this.schedule(()=>{
  if(this.socket!==socket||this.manual||socket.readyState!==1)return;
  if(this.now()-this.receivedAt>2500||(this.recovering&&this.now()-this.recoveryAt>2500)){this.restart(socket);return;}
  this.pingAt=this.now();this.sendNow({type:'ping',clientTime:this.pingAt});this.watch(socket);
 },1000);}
 resyncInputs(){if(this.recovering||this.phase!=='playing')return;this.recovering=true;this.recoveryAt=this.now();if(!this.send({type:'resync_input'}))this.recovering=false;}
 send(message:ClientMessage){if(this.socket?.readyState===1){this.sendNow(message);return true;}if(!REALTIME.has(message.type))this.queued.push(message);return false;}
 subscribe(listener:(message:ServerMessage)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 close(){this.manual=true;this.cancel(this.timer);this.cancel(this.heartbeat);this.socket?.close();this.phase='offline';}
 leave(){this.send({type:'leave_room'});this.storage?.removeItem('zero-point-reconnect');this.reconnectToken=undefined;this.close();}
 private sendNow(message:ClientMessage){this.socket?.send(JSON.stringify(message));}
}
