import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { encodeServerMessage, MAX_MESSAGE_BYTES, parseClientMessage, ProtocolError, PROTOCOL_VERSION, RELEASE_VERSION, type ServerMessage } from '../shared/protocol.ts';
import { RoomError, RoomManager } from './room-manager.ts';
import { MatchSimulation } from './simulation.ts';
import { TokenBucket } from './rate-limit.ts';

type Session={id:string;socket:WebSocket;hello:boolean;playerId?:string;roomCode?:string;all:TokenBucket;input:TokenBucket};
type Options={port?:number;host?:string};

export async function createGameServer(options:Options={}){
  const rooms=new RoomManager(),sessions=new Map<string,Session>(),simulations=new Map<string,MatchSimulation>();
  const http=createServer((request,response)=>{
    if(request.method==='GET'&&request.url==='/health'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ok:true,protocolVersion:PROTOCOL_VERSION,releaseVersion:RELEASE_VERSION}));return;}
    response.writeHead(404);response.end('Not found');
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:MAX_MESSAGE_BYTES});
  http.on('upgrade',(request,socket,head)=>{
    if(request.url!=='/game'){socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request));
  });
  const send=(session:Session,message:ServerMessage)=>{if(session.socket.readyState===WebSocket.OPEN)session.socket.send(encodeServerMessage(message));};
  const error=(session:Session,code:string)=>send(session,{type:'error',code,message:code});
  const broadcast=(roomCode:string,message:ServerMessage)=>{for(const session of sessions.values())if(session.roomCode===roomCode)send(session,message);};
  const roomState=(roomCode:string)=>{const room=rooms.getRoom(roomCode);if(room)broadcast(roomCode,rooms.roomState(room));};
  const welcome=(session:Session,player:{id:string;reconnectToken:string})=>send(session,{type:'welcome',playerId:player.id,reconnectToken:player.reconnectToken,serverTime:Date.now()});

  wss.on('connection',(socket:WebSocket,_request:IncomingMessage)=>{
    const session:Session={id:randomUUID(),socket,hello:false,all:new TokenBucket(60,60),input:new TokenBucket(30,30)};sessions.set(session.id,session);
    socket.on('error',()=>{});
    socket.on('message',data=>{
      const raw=data.toString();
      if(Buffer.byteLength(raw,'utf8')>MAX_MESSAGE_BYTES){socket.close(1009,'Message too large');return;}
      if(!session.all.take()){socket.close(1008,'Rate limit');return;}
      try{
        const message=parseClientMessage(raw);
        if(message.type==='hello'){
          session.hello=true;
          if(message.reconnectToken){
            const restored=rooms.reconnect(message.reconnectToken,Date.now(),session.id);
            session.playerId=restored.player.id;session.roomCode=restored.room.code;
            simulations.get(restored.room.code)?.resetInputs(restored.player.id);
            if(restored.evictedConnectionId){const old=sessions.get(restored.evictedConnectionId);old?.socket.close(4001,'Reconnected elsewhere');}
            welcome(session,restored.player);roomState(restored.room.code);
          }
          return;
        }
        if(!session.hello){error(session,'HELLO_REQUIRED');return;}
        if(message.type==='ping'){send(session,{type:'pong',clientTime:message.clientTime});return;}
        if(message.type==='create_room'){
          if(session.playerId){error(session,'ALREADY_IN_ROOM');return;}
          const created=rooms.createRoom(message,session.id);session.playerId=created.player.id;session.roomCode=created.room.code;welcome(session,created.player);roomState(created.room.code);return;
        }
        if(message.type==='join_room'){
          if(session.playerId){error(session,'ALREADY_IN_ROOM');return;}
          const joined=rooms.joinRoom(message.roomCode,message,session.id);session.playerId=joined.player.id;session.roomCode=joined.room.code;welcome(session,joined.player);roomState(joined.room.code);return;
        }
        if(!session.playerId||!session.roomCode){error(session,'ROOM_REQUIRED');return;}
        const room=rooms.getRoom(session.roomCode);if(!room)throw new RoomError('ROOM_NOT_FOUND');
        switch(message.type){
          case 'set_ready':rooms.setReady(room.code,session.playerId,message.ready);roomState(room.code);break;
          case 'configure_room':rooms.configureRoom(room.code,session.playerId,message);roomState(room.code);break;
          case 'start_match':{
            rooms.startMatch(room.code,session.playerId);
            const participants:Array<{id:string;nickname:string;x:number;z:number;isBot?:boolean}>=[...room.players.values()].map((p,index)=>({id:p.id,nickname:p.nickname,x:[-19,19,-19,19][index]??0,z:[19,-19,-19,19][index]??0}));
            for(let i=0;i<room.botCount;i+=1)participants.push({id:`bot-${i+1}`,nickname:`BOT ${String(i+1).padStart(2,'0')}`,x:i%2?19:-19,z:i<2?-19:19,isBot:true});
            simulations.set(room.code,new MatchSimulation(participants,{difficulty:room.difficulty}));broadcast(room.code,{type:'match_started',serverTime:Date.now()});roomState(room.code);break;
          }
          case 'input':if(session.input.take())simulations.get(room.code)?.applyInput(session.playerId,message);else error(session,'INPUT_RATE_LIMIT');break;
          case 'input_batch':if(session.input.take())for(const command of message.commands)simulations.get(room.code)?.applyInput(session.playerId,command);else error(session,'INPUT_RATE_LIMIT');break;
          case 'resync_input':{const sim=simulations.get(room.code);if(sim){sim.resetInputs(session.playerId);send(session,{type:'input_resynced',entity:sim.snapshot().find(p=>p.id===session.playerId)!,lastProcessedInput:sim.player(session.playerId).lastInput});}break;}
          case 'fire':simulations.get(room.code)?.queueFire(session.playerId,message);break;
          case 'reload':simulations.get(room.code)?.queueReload(session.playerId);break;
          case 'switch_weapon':simulations.get(room.code)?.queueSwitch(session.playerId,message.weapon);break;
          case 'play_again':rooms.playAgain(room.code,session.playerId);simulations.delete(room.code);roomState(room.code);break;
          case 'leave_room':rooms.leaveRoom(room.code,session.playerId);session.playerId=undefined;session.roomCode=undefined;roomState(room.code);break;
        }
      }catch(cause){
        const code=cause instanceof ProtocolError||cause instanceof RoomError?cause.code:'SERVER_ERROR';
        if(code==='MESSAGE_TOO_LARGE'){socket.close(1009,'Message too large');return;}error(session,code);
      }
    });
    socket.on('close',()=>{
      sessions.delete(session.id);
      const current=session.roomCode&&session.playerId?rooms.getRoom(session.roomCode)?.players.get(session.playerId):undefined;
      if(session.playerId&&current?.connectionId===session.id){const room=rooms.disconnect(session.playerId);if(room)roomState(room.code);}
    });
  });

  let lastTick=performance.now();
  const timer=setInterval(()=>{
    const now=performance.now(),serverTickMs=now-lastTick;lastTick=now;
    rooms.sweep();
    for(const [code,simulation] of simulations){
      const room=rooms.getRoom(code);if(!room){simulations.delete(code);continue;}
      simulation.tick(Math.min(.25,Math.max(.001,serverTickMs/1000)));
      for(const event of simulation.drainEvents()){
        if(event.type==='shot')broadcast(code,{type:'combat_event',event:'shot',actorId:event.actorId,yaw:event.yaw,pitch:event.pitch,end:event.end});
        else broadcast(code,{type:'combat_event',event:event.type,actorId:event.actorId,targetId:event.targetId,value:event.value});
      }
      const publishSnapshot=()=>{const entities=simulation.snapshot();for(const session of sessions.values())if(session.roomCode===code)send(session,{type:'snapshot',tick:simulation.tickNumber,serverTime:Date.now(),serverTickMs,remainingSeconds:simulation.remainingSeconds,lastProcessedInput:session.playerId?simulation.players.get(session.playerId)?.lastInput:undefined,entities});};
      let published=false;if(simulation.tickNumber%2===0){publishSnapshot();published=true;}
      if(simulation.finished){if(!published)publishSnapshot();broadcast(code,{type:'match_finished',winnerId:simulation.winnerId,reason:simulation.remainingSeconds<=0?'time':'score'});room.phase='finished';roomState(code);simulations.delete(code);}
    }
  },50);timer.unref();

  await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(options.port??3001,options.host??'127.0.0.1',()=>resolve());});
  const address=http.address();if(!address||typeof address==='string')throw new Error('LISTEN_FAILED');const host=address.address.includes(':')?'127.0.0.1':address.address;
  return {httpUrl:`http://${host}:${address.port}`,wsBase:`ws://${host}:${address.port}`,rooms,close:async()=>{clearInterval(timer);for(const client of wss.clients)client.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>http.close(()=>resolve()));}};
}
