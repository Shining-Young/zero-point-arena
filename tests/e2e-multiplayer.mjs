import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/gateway.ts';

const server=await createGameServer({port:0});
const make=()=>new Promise((resolve,reject)=>{const ws=new WebSocket(`${server.wsBase}/game`),messages=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));ws.once('open',()=>resolve({ws,messages,send:value=>ws.send(JSON.stringify(value)),wait:type=>new Promise((ok,fail)=>{const until=Date.now()+2500;const scan=()=>{const found=messages.find(item=>item.type===type);if(found)ok(found);else if(Date.now()>until)fail(new Error(`timeout ${type}`));else setTimeout(scan,10)};scan();})}));ws.once('error',reject)});
const a=await make(),b=await make();
try{
  a.send({type:'hello',protocolVersion:1,releaseVersion:'0.2.1'});b.send({type:'hello',protocolVersion:1,releaseVersion:'0.2.1'});
  a.send({type:'create_room',nickname:'Alpha',humanLimit:4,botCount:1,difficulty:'normal'});const room=await a.wait('room_state');
  b.send({type:'join_room',nickname:'Bravo',roomCode:room.roomCode});await b.wait('welcome');
  a.send({type:'set_ready',ready:true});b.send({type:'set_ready',ready:true});await new Promise(r=>setTimeout(r,40));a.send({type:'start_match'});
  const sa=await a.wait('snapshot'),sb=await b.wait('snapshot');assert.equal(sa.entities.length,3);assert.deepEqual(sa.entities.map(e=>e.id).sort(),sb.entities.map(e=>e.id).sort());
  const local=sa.entities.find(entity=>!entity.isBot&&entity.x===-19&&entity.z===19);assert.ok(local);
  a.send({type:'input',sequence:1,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,clientTime:Date.now()});
  await new Promise(resolve=>setTimeout(resolve,250));
  const moved=[...a.messages].reverse().find(message=>message.type==='snapshot').entities.find(entity=>entity.id===local.id);assert.ok(moved.z<local.z,'W moves toward -Z at yaw 0');
  a.send({type:'fire',weapon:'rifle',sequence:2,yaw:0,pitch:0,clientTime:Date.now()});await a.wait('combat_event');await new Promise(resolve=>setTimeout(resolve,120));
  const fired=[...a.messages].reverse().find(message=>message.type==='snapshot').entities.find(entity=>entity.id===local.id);assert.equal(fired.ammo,29);
  console.log(JSON.stringify({ok:true,roomCode:room.roomCode,participants:sa.entities.length,wForward:true,fire:true}));
}finally{a.ws.close();b.ws.close();await server.close();}
