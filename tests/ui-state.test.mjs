import assert from 'node:assert/strict';
import test from 'node:test';

const ui=await import('../app/ui-state.ts').catch(()=>({}));

test('sensitivity controls clamp and round every adjustment to one decimal',()=>{
  assert.equal(typeof ui.adjustSensitivity,'function');
  assert.equal(ui.adjustSensitivity(1.04,0),1);
  assert.equal(ui.adjustSensitivity(2.5,.1),2.5);
  assert.equal(ui.adjustSensitivity(.3,-.1),.3);
  assert.equal(ui.adjustSensitivity(1.2,.1),1.3);
});

test('finished rooms keep the match view and receive a neutral fallback result',()=>{
  assert.equal(ui.roomView('lobby'),'lobby');
  assert.equal(ui.roomView('playing'),'match');
  assert.equal(ui.roomView('finished'),'match');
  assert.equal(ui.resultForRoom('finished',null),'unknown');
  assert.equal(ui.resultForRoom('playing',null),null);
  assert.equal(ui.resultForRoom('finished','win'),'win');
});

test('match engine stays mounted through results and is released in the lobby',()=>{
  assert.equal(typeof ui.shouldDisposeMatchEngine,'function');
  assert.equal(ui.shouldDisposeMatchEngine('playing'),false);
  assert.equal(ui.shouldDisposeMatchEngine('finished'),false);
  assert.equal(ui.shouldDisposeMatchEngine('lobby'),true);
  assert.equal(ui.shouldDisposeMatchEngine(undefined),true);
});
