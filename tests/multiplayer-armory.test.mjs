import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import * as THREE from 'three';
registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(s+'.ts',c);throw e}}});
const {MultiplayerGame,INITIAL_HUD}=await import('../lib/game/multiplayer.ts');const {WeaponPresentation}=await import('../lib/game/weapon-presentation.ts');
function harness(weapon='pistol'){
 const sent=[],g=Object.create(MultiplayerGame.prototype);Object.assign(g,{hud:{...INITIAL_HUD,menuOpen:false,ammo:999,weapon},keys:new Set(),weapon,shooting:true,localReloadLeft:0,lastFire:-Infinity,sequence:0,life:0,lastInputSequence:-1,unsent:[],shotHeat:0,predictedShots:[],presentation:new WeaponPresentation(),camera:new THREE.PerspectiveCamera(),audio:{shot(){},reload(){}},connection:{phase:'playing',recovering:false,send:m=>{sent.push(m);return true}},callback(){},showLocalShot(){}});g.presentation.configure(weapon);return {g,sent};
}
test('holding trigger only fires once for semi weapons but repeats for automatics',()=>{
 for(const w of ['pistol','shotgun','sniper','smg','rifle']){const {g,sent}=harness(w);for(let t=0;t<2000;t+=1000/60)g.tryFire(t);const shots=sent.filter(m=>m.type==='fire');if(['pistol','shotgun','sniper'].includes(w))assert.equal(shots.length,1);else assert.ok(shots.length>10);}
});
test('empty pistol reloads with zero finite reserve, without firing again from held trigger',()=>{
 const {g,sent}=harness();g.hud.ammo=0;g.hud.reserve=0;g.tryFire(0);assert.ok(g.localReloadLeft>0);assert.ok(sent.some(m=>m.type==='reload'));assert.equal(g.shooting,false);
});
test('opening shop clears input and releases pointer without pausing training',()=>{
 const {g}=harness(),previous=globalThis.document;let paused,unlocked=false;g.connection.setPaused=v=>paused=v;g.keys.add('KeyW');g.presentation.toggleAim();g.renderer={domElement:{}};globalThis.document={pointerLockElement:g.renderer.domElement,exitPointerLock(){unlocked=true}};
 try{g.openShop();assert.equal(paused,false);assert.equal(g.hud.shopOpen,true);assert.equal(g.hud.menuOpen,false);assert.equal(g.keys.size,0);assert.equal(g.shooting,false);assert.equal(g.presentation.aimIntent,false);assert.ok(unlocked);assert.equal(g.active,false);}finally{globalThis.document=previous;}
});

test('denied mouse lock after closing shop actually pauses offline settings',async()=>{
 const {g}=harness(),previous=globalThis.document;let paused=false;g.connection.setPaused=value=>paused=value;g.audio.init=()=>{};g.hud.shopOpen=true;g.renderer={domElement:{requestPointerLock:()=>Promise.reject(new Error('denied'))}};globalThis.document={pointerLockElement:null};
 try{g.resume();await new Promise(r=>setImmediate(r));assert.equal(g.hud.menuOpen,true);assert.equal(g.hud.shopOpen,false);assert.equal(paused,true);}finally{globalThis.document=previous;}
});
