import assert from 'node:assert/strict';
import * as effects from '../lib/game/shot-effects.ts';

test('near-wall muzzle tracer converges on the camera crosshair',()=>{
  assert.equal(typeof effects.resolveAimShot,'function');
  const wall=new THREE.Mesh(new THREE.BoxGeometry(10,10,.2),new THREE.MeshBasicMaterial());wall.position.z=-2;wall.updateMatrixWorld(true);
  const shot=effects.resolveAimShot(new THREE.Vector3(),new THREE.Vector3(.23,-.2,-.8),new THREE.Vector3(0,0,-1),[wall],70);
  assert.ok(Math.abs(shot.end.x)<1e-8);assert.ok(Math.abs(shot.end.y)<1e-8);
  assert.ok(Math.abs(shot.end.z+1.9)<1e-7);
});
import test from 'node:test';
import * as THREE from 'three';

const shotEffects = await import('../lib/game/shot-effects.ts').catch(() => ({}));

test('stops a visual tracer at the first piece of cover', () => {
  assert.equal(typeof shotEffects.resolveShotEnd, 'function');
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), new THREE.MeshBasicMaterial());
  wall.position.set(0, 1, -5);
  wall.updateMatrixWorld(true);
  const end = shotEffects.resolveShotEnd(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1),
    [wall],
    65,
  );
  assert.ok(Math.abs(end.z + 4.5) < 0.001);
});

test('adds a short-lived tracer and muzzle flash to the scene', () => {
  assert.equal(typeof shotEffects.spawnShotEffect, 'function');
  assert.equal(typeof shotEffects.updateShotEffects, 'function');
  const scene = new THREE.Scene();
  const effect = shotEffects.spawnShotEffect(
    scene,
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 1, -12),
    false,
  );
  assert.equal(scene.children.includes(effect.root), true);
  assert.ok(effect.root.children.some(child => child instanceof THREE.Line));
  assert.ok(effect.root.children.some(child => child instanceof THREE.PointLight));
  assert.ok(effect.root.children.filter(child => child instanceof THREE.Mesh).length >= 2);
  const remaining = shotEffects.updateShotEffects(scene, [effect], 0.2);
  assert.deepEqual(remaining, []);
  assert.equal(scene.children.includes(effect.root), false);
});

test('converts multiplayer yaw and pitch into the visible shot direction', () => {
  assert.equal(typeof shotEffects.directionFromAngles, 'function');
  const forward = shotEffects.directionFromAngles(0, 0);
  assert.ok(Math.abs(forward.x) < 0.001);
  assert.ok(Math.abs(forward.y) < 0.001);
  assert.ok(Math.abs(forward.z + 1) < 0.001);
  const raised = shotEffects.directionFromAngles(Math.PI / 2, 0.25);
  assert.ok(raised.x < 0);
  assert.ok(raised.y > 0);
});
