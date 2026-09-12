import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {PROTOCOL_VERSION,RELEASE_VERSION} from '../shared/config.ts';
const endpoint=process.env.GAME_SERVER_URL;
if(!endpoint?.startsWith('wss://'))throw new Error('GAME_SERVER_URL must be a wss:// URL');
const make=()=>new Promise((resolve,reject)=>{const ws=new WebSocket(endpoint),messages=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));ws.once('open',()=>resolve({ws,messages,send:value=>ws.send(JSON.stringify(value))}));ws.once('error',reject)});
const waitUntil=(client,predicate,label)=>new Promise((resolve,reject)=>{const until=Date.now()+20_000;const scan=()=>{const found=client.messages.find(predicate);if(found)resolve(found);else if(Date.now()>until)reject(new Error(`timeout ${label}: ${client.messages.filter(m=>m.type==='error').map(m=>m.code)}`));else setTimeout(scan,50)};scan();});
const a=await make(),b=await make();
try{
 for(const c of[a,b])c.send({type:'hello',protocolVersion:PROTOCOL_VERSION,releaseVersion:RELEASE_VERSION});
 a.send({type:'create_room',nickname:'Public-A',humanLimit:4,botCount:1,difficulty:'easy'});const room=await waitUntil(a,m=>m.type==='room_state','room');
 b.send({type:'join_room',nickname:'Public-B',roomCode:room.roomCode});await waitUntil(b,m=>m.type==='welcome','welcome');
 a.send({type:'set_ready',ready:true});b.send({type:'set_ready',ready:true});await new Promise(r=>setTimeout(r,300));a.send({type:'start_match'});
 const first=await waitUntil(a,m=>m.type==='snapshot','snapshot'),local=first.entities.find(p=>p.nickname==='Public-A');assert.equal(first.entities.length,3);assert.ok(first.entities.every(p=>p.weapon==='pistol'&&p.coins===0));
 a.send({type:'shop',requestId:'public-buy',action:'buy_weapon',weapon:'smg'});const denied=await waitUntil(a,m=>m.type==='shop_result','shop denial');assert.equal(denied.ok,false);assert.equal(denied.reason,'INSUFFICIENT_COINS');
 for(let sequence=1;sequence<=10;sequence++){a.send({type:'input',sequence,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,dt:.01,life:local.life,clientTime:Date.now()});await new Promise(r=>setTimeout(r,50));}
 const moved=await waitUntil(a,m=>m.type==='snapshot'&&m.lastProcessedInput>=10,'move');assert.ok(moved.entities.find(p=>p.id===local.id).z<local.z);
 a.send({type:'fire',weapon:'pistol',sequence:11,yaw:0,pitch:0,clientTime:Date.now(),life:local.life,inputSequence:10});await waitUntil(a,m=>m.type==='snapshot'&&m.entities.find(p=>p.id===local.id)?.ammo===11,'fire');
 a.send({type:'reload'});const reloading=await waitUntil(a,m=>m.type==='snapshot'&&m.entities.find(p=>p.id===local.id)?.reloadLeft>0,'reload');
 await waitUntil(a,m=>m.type==='snapshot'&&m.tick>reloading.tick&&m.entities.find(p=>p.id===local.id)?.ammo===12,'infinite pistol reload');
 a.send({type:'ping',clientTime:123});assert.equal((await waitUntil(a,m=>m.type==='pong','heartbeat')).clientTime,123);
 a.send({type:'resync_input'});const reset=await waitUntil(a,m=>m.type==='input_resynced','reset');assert.ok(reset.entity.life>local.life);
 a.send({type:'input',sequence:20,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,dt:.01,life:reset.entity.life,clientTime:Date.now()});await waitUntil(a,m=>m.type==='snapshot'&&m.lastProcessedInput===20,'recovery');
 console.log(JSON.stringify({ok:true,releaseVersion:RELEASE_VERSION,participants:3,pistolStart:true,shopValidation:true,wForward:true,fire:true,infiniteReload:true,heartbeat:true,recovery:true}));
}finally{for(const c of[a,b]){if(c.ws.readyState===WebSocket.OPEN)c.send({type:'leave_room'});c.ws.close();}}
