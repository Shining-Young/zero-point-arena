'use client';
import {useEffect,useRef,useState} from 'react';
import {MultiplayerGame,INITIAL_HUD} from '../lib/game/multiplayer.ts';
import {LocalGameConnection} from '../lib/network/local.ts';
import {readSettings,saveSettings} from '../lib/game/settings.ts';
import type {Difficulty} from '../shared/protocol.ts';
import {MultiplayerMatch} from './multiplayer-match';
import {SensitivityControl} from '../components/sensitivity-control';
export default function Training({onBack}:{onBack:()=>void}){
 const [started,setStarted]=useState(false),[round,setRound]=useState(0),[difficulty,setDifficulty]=useState<Difficulty>('normal'),[settings,setSettings]=useState(readSettings),[hud,setHud]=useState(INITIAL_HUD),[error,setError]=useState('');
 const mount=useRef<HTMLDivElement>(null),engine=useRef<MultiplayerGame|null>(null);
 useEffect(()=>{saveSettings(settings);engine.current?.configure(settings);},[settings]);
 useEffect(()=>{
  if(!started||!mount.current)return;const connection=new LocalGameConnection(difficulty);let game:MultiplayerGame|undefined;
  try{game=new MultiplayerGame(mount.current,connection,connection.playerId!,setHud);engine.current=game;game.configure(readSettings());connection.connect();}catch(cause){queueMicrotask(()=>setError(cause instanceof Error?cause.message:'无法初始化游戏'));}
  return()=>{game?.dispose();connection.close();engine.current=null;};
 },[started,round,difficulty]);
 if(!started)return <main className="mode-screen"><section className="training-setup"><small>ZERO POINT · OFFLINE TRAINING</small><h1>单人训练<span>.</span></h1><p>七号仓库 · 4 名人机 · 先获得 15 次击杀获胜</p><p>从手枪开始，击杀赚取金币。按 B 购买武器与弹药。</p><label>训练难度<select value={difficulty} onChange={e=>setDifficulty(e.target.value as Difficulty)}><option value="easy">新兵</option><option value="normal">标准</option><option value="hard">精英</option></select></label><SensitivityControl value={settings.sensitivity} onChange={sensitivity=>setSettings({...settings,sensitivity})}/><button className="primary-button" onClick={()=>setStarted(true)}>开始训练</button><button className="text-button" onClick={onBack}>返回模式选择</button></section></main>;
 return <main className="game-shell phase-playing"><div className="viewport" ref={mount}/>{error?<section className="game-panel"><p>{error}</p><button onClick={onBack}>返回模式选择</button></section>:<MultiplayerMatch hud={hud} roomCode="离线" training isHost settings={settings} onSettings={setSettings} onOpen={()=>engine.current?.openSettings()} onResume={()=>engine.current?.resume()} onReturnToRoom={()=>setRound(r=>r+1)} onLeave={onBack} onShop={()=>engine.current?.openShop()} onBuy={(action,weapon)=>engine.current?.buy(action,weapon)}/>}</main>;
}
