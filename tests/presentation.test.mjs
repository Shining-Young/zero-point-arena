import assert from 'node:assert/strict';
import test from 'node:test';
const settings=await import('../lib/game/settings.ts').catch(()=>({}));
const presentation=await import('../lib/game/weapon-presentation.ts').catch(()=>({}));
test('settings survive switching modes and reject corrupt stored values',()=>{
  assert.equal(typeof settings.readSettings,'function');
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  settings.saveSettings({sensitivity:1.7,sound:false},storage);
  assert.deepEqual(settings.readSettings(storage),{sensitivity:1.7,sound:false});
  storage.setItem(settings.SETTINGS_KEY,'{"sensitivity":99,"sound":"yes"}');
  assert.deepEqual(settings.readSettings(storage),{sensitivity:2.5,sound:true});
  storage.setItem(settings.SETTINGS_KEY,'broken');
  assert.deepEqual(settings.readSettings(storage),{sensitivity:1,sound:true});
});
test('ADS toggles, hides through reload and restores the intended aim afterward',()=>{
  assert.equal(typeof presentation.WeaponPresentation,'function');
  const p=new presentation.WeaponPresentation(),normal={reloadLeft:0,reloadTotal:1.9,alive:true};
  p.toggleAim();const aimed=p.update(.1,normal);assert.equal(aimed.aiming,true);assert.ok(aimed.fov<76&&aimed.fov>51);
  const loading=p.update(.1,{...normal,reloadLeft:.95});assert.equal(loading.aiming,false);assert.ok(loading.y<-.4);assert.ok(loading.rotationZ<-.3);assert.equal(loading.reloadProgress,.5);
  assert.equal(p.update(.1,normal).aiming,true);
  p.toggleAim();assert.equal(p.update(.1,normal).aiming,false);
});
test('recoil recovers, and death or menu interrupts aim without restoring it',()=>{
  assert.equal(typeof presentation.WeaponPresentation,'function');
  const p=new presentation.WeaponPresentation(),normal={reloadLeft:0,reloadTotal:1.9,alive:true};
  p.shoot();const kick=p.update(.01,normal);assert.ok(kick.z>-.5);
  assert.ok(p.update(1,normal).z<kick.z);
  p.toggleAim();p.update(.1,{...normal,alive:false});assert.equal(p.update(.1,normal).aiming,false);
  p.toggleAim();p.update(.1,{...normal,blocked:true});assert.equal(p.update(.1,normal).aiming,false);
  p.toggleAim();p.reset();assert.equal(p.update(.1,normal).aiming,false);
});
