import assert from 'node:assert/strict';
import WebSocket from 'ws';

const endpoint=process.env.GAME_SERVER_URL;
if(!endpoint?.startsWith('wss://'))throw new Error('GAME_SERVER_URL must be a wss:// URL');
const make=()=>new Promise((resolve,reject)=>{const ws=new WebSocket(endpoint),messages=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));ws.once('open',()=>resolve({ws,messages,send:value=>ws.send(JSON.stringify(value)),wait:type=>new Promise((ok,fail)=>{const until=Date.now()+20_000;const scan=()=>{const found=messages.find(item=>item.type===type);if(found)ok(found);else if(Date.now()>until)fail(new Error(`timeout ${type}`));else setTimeout(scan,50)};scan();})}));ws.once('error',reject)});
const a=await make(),b=await make();
try{
  for(const client of[a,b])client.send({type:'hello',protocolVersion:1,releaseVersion:'0.2.1'});
  a.send({type:'create_room',nickname:'Public-A',humanLimit:4,botCount:1,difficulty:'normal'});const room=await a.wait('room_state');
  b.send({type:'join_room',nickname:'Public-B',roomCode:room.roomCode});await b.wait('welcome');
  a.send({type:'set_ready',ready:true});b.send({type:'set_ready',ready:true});await new Promise(resolve=>setTimeout(resolve,300));a.send({type:'start_match'});
  const [first,second]=await Promise.all([a.wait('snapshot'),b.wait('snapshot')]);assert.equal(first.entities.length,3);assert.deepEqual(first.entities.map(e=>e.id).sort(),second.entities.map(e=>e.id).sort());
  const local=first.entities.find(entity=>entity.nickname==='Public-A');assert.ok(local);
  a.send({type:'input',sequence:1,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,clientTime:Date.now()});await new Promise(resolve=>setTimeout(resolve,300));
  const moved=[...a.messages].reverse().find(message=>message.type==='snapshot').entities.find(entity=>entity.id===local.id);assert.ok(moved.z<local.z,'public server must move W toward -Z at yaw 0');
  a.send({type:'fire',weapon:'rifle',sequence:2,yaw:0,pitch:0,clientTime:Date.now()});await new Promise(resolve=>setTimeout(resolve,200));
  const fired=[...a.messages].reverse().find(message=>message.type==='snapshot').entities.find(entity=>entity.id===local.id);assert.equal(fired.ammo,29);
  console.log(JSON.stringify({ok:true,endpoint,roomCode:room.roomCode,participants:first.entities.length,wForward:true,fire:true}));
}finally{a.ws.close();b.ws.close();}
