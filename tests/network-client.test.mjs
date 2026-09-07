import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { GameConnection } from '../lib/network/client.ts';
import { sampleSnapshots } from '../lib/network/time-sync.ts';

class FakeSocket extends EventEmitter {
  static OPEN=1;readyState=0;sent=[];
  addEventListener(type,fn){this.on(type,fn)}
  send(raw){this.sent.push(JSON.parse(raw))}
  open(){this.readyState=1;this.emit('open')}
  message(value){this.emit('message',{data:JSON.stringify(value)})}
  close(){this.readyState=3;this.emit('close',{code:1000})}
}

test('sends hello, stores welcome identity and notifies subscribers', () => {
  const socket=new FakeSocket(),stored=new Map(),events=[];
  const connection=new GameConnection({url:'ws://test/game',socketFactory:()=>socket,storage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}});
  connection.subscribe(message=>events.push(message));connection.connect();socket.open();
  assert.equal(socket.sent[0].type,'hello');
  socket.message({type:'welcome',playerId:'p1',reconnectToken:'abcdefghijklmnop',serverTime:10});
  assert.equal(connection.playerId,'p1');assert.equal(stored.get('zero-point-reconnect'),'abcdefghijklmnop');assert.equal(events.length,1);
});

test('samples snapshots around render time', () => {
  const result=sampleSnapshots([{serverTime:100},{serverTime:200}],150);
  assert.equal(result?.alpha,.5);assert.equal(result?.before.serverTime,100);assert.equal(result?.after.serverTime,200);
});
