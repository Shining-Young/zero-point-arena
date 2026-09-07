import { parseServerMessage, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../shared/protocol.ts';
import type { ConnectionPhase } from './store.ts';

type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};
type SocketLike={readyState:number;send(raw:string):void;close():void;addEventListener(type:string,listener:(event:any)=>void):void};
type Options={url:string;socketFactory?:(url:string)=>SocketLike;storage?:StorageLike;setTimeout?:(fn:()=>void,ms:number)=>unknown;clearTimeout?:(id:unknown)=>void};

export class GameConnection{
  phase:ConnectionPhase='offline';playerId?:string;reconnectToken?:string;latency=0;
  private socket?:SocketLike;private listeners=new Set<(message:ServerMessage)=>void>();private queued:ClientMessage[]=[];private manual=false;private attempt=0;private timer?:unknown;
  private readonly socketFactory:(url:string)=>SocketLike;private readonly storage?:StorageLike;private readonly schedule:(fn:()=>void,ms:number)=>unknown;private readonly cancel:(id:unknown)=>void;
  constructor(private readonly options:Options){
    this.socketFactory=options.socketFactory??(url=>new WebSocket(url));this.storage=options.storage??(typeof localStorage==='undefined'?undefined:localStorage);
    this.schedule=options.setTimeout??((fn,ms)=>setTimeout(fn,ms));this.cancel=options.clearTimeout??(id=>clearTimeout(id as ReturnType<typeof setTimeout>));
    this.reconnectToken=this.storage?.getItem('zero-point-reconnect')??undefined;
  }
  connect(){this.manual=false;this.phase=this.attempt?'reconnecting':'connecting';const socket=this.socketFactory(this.options.url);this.socket=socket;
    socket.addEventListener('open',()=>{this.attempt=0;this.sendNow({type:'hello',protocolVersion:PROTOCOL_VERSION,releaseVersion:'0.2.0',...(this.reconnectToken?{reconnectToken:this.reconnectToken}:{})});for(const message of this.queued)this.sendNow(message);this.queued=[];});
    socket.addEventListener('message',event=>{try{const message=parseServerMessage(String(event.data));if(message.type==='welcome'){this.playerId=message.playerId;this.reconnectToken=message.reconnectToken;this.storage?.setItem('zero-point-reconnect',message.reconnectToken);}if(message.type==='room_state')this.phase=message.phase==='playing'?'playing':'lobby';if(message.type==='match_started')this.phase='playing';if(message.type==='match_finished')this.phase='ended';if(message.type==='error'&&message.code==='VERSION_MISMATCH'){this.phase='ended';this.manual=true;}for(const listener of this.listeners)listener(message);}catch{}});
    socket.addEventListener('close',()=>{if(this.manual)return;this.phase='reconnecting';const delays=[1000,2000,4000,8000],delay=delays[Math.min(this.attempt++,delays.length-1)];this.timer=this.schedule(()=>this.connect(),delay);});
  }
  send(message:ClientMessage){if(this.socket?.readyState===1)this.sendNow(message);else this.queued.push(message);}
  subscribe(listener:(message:ServerMessage)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  close(){this.manual=true;if(this.timer)this.cancel(this.timer);this.socket?.close();this.phase='offline';}
  leave(){this.send({type:'leave_room'});this.storage?.removeItem('zero-point-reconnect');this.reconnectToken=undefined;this.close();}
  private sendNow(message:ClientMessage){this.socket?.send(JSON.stringify(message));}
}
