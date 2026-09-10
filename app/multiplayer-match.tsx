import { Cross, Crosshair, Play, Shield, Skull, Volume2, VolumeX, Zap } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { SensitivityControl } from '@/components/sensitivity-control';
import type { MultiplayerHud } from '../lib/game/multiplayer.ts';
import type { GameSettings } from '../lib/game/settings.ts';
import { Radar } from './game';
import type { MatchResult } from './ui-state';

type DisplayHud=Omit<MultiplayerHud,'result'>&{result:MatchResult};

export function MultiplayerMatch({hud,roomCode,settings,isHost,onSettings,onOpen,onResume,onReturnToRoom,onLeave}:{hud:DisplayHud;roomCode:string;settings:GameSettings;isHost:boolean;onSettings:(value:GameSettings)=>void;onOpen:()=>void;onResume:()=>void;onReturnToRoom:()=>void;onLeave:()=>void}){
  const time=`${String(Math.floor(hud.remaining/60)).padStart(2,'0')}:${String(Math.floor(hud.remaining%60)).padStart(2,'0')}`;
  const reloadTotal=hud.weapon==='rifle'?1.9:1.3;
  return <>
    <header className="topbar"><div className="brand"><span className="brand-symbol"><Crosshair size={25}/></span><span>ZERO / POINT<small>联机 · {roomCode}</small></span></div><div className="scoreboard"><div className="your-score"><span>你</span><strong>{String(hud.kills).padStart(2,'0')}</strong></div><div className="match-clock"><small>击杀竞赛 · 目标 15</small><b>{time}</b></div><div className="enemy-score"><strong>{String(hud.leaderKills).padStart(2,'0')}</strong><span>{hud.leaderName||'领先对手'}</span></div></div><div className="top-actions"><button aria-label={settings.sound?'关闭音效':'打开音效'} onClick={()=>onSettings({...settings,sound:!settings.sound})}>{settings.sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button><button className="pause-button" onClick={onOpen}>ESC</button></div></header>
    <div className="radar-hud"><Radar state={{x:hud.x,z:hud.z,yaw:hud.yaw,bots:hud.enemies}}/><div><span className="live-dot"/> 七号仓库 <span>{hud.latency<0?'延迟测量中':`${Math.round(hud.latency)} ms`}</span></div></div>
    <div className="kill-feed" aria-live="polite">{hud.feed.map(f=><div key={f.id} className={f.attacker==='你'?'friendly':''}><strong>{f.attacker}</strong>{f.headshot?<Crosshair size={15}/>:<Zap size={14}/>}<span>{f.victim}</span>{f.headshot&&<small>爆头</small>}</div>)}</div>
    {hud.alive&&!hud.menuOpen&&!hud.result&&<><div className={`crosshair ${hud.aiming?'aiming':''}`}><i/><i/><i/><i/><b/></div>{hud.hitMarker>0&&<div key={hud.hitMarker} className={`multi-hit-marker ${hud.headshot?'headshot':''}`}>×</div>}{hud.protection>0&&<div className="protection"><Shield size={15}/> 出生保护 {Math.ceil(hud.protection)}s</div>}{hud.reloadLeft>0&&<div className="reload-indicator"><span>正在换弹</span><div><i style={{width:`${Math.max(0,Math.min(100,(1-hud.reloadLeft/reloadTotal)*100))}%`}}/></div></div>}{hud.ammo===0&&hud.reloadLeft<=0&&<div className="reload-indicator">{hud.reserve>0?'按 R 换弹':'备用弹药耗尽 · 按 1 / 2 切换武器'}</div>}</>}
    {hud.hurt>0&&<div key={hud.hurt} className="multi-damage-vignette"/>}{hud.shieldHit&&hud.shieldHit>0&&<div key={hud.shieldHit} className="multi-shield-feedback"><Shield size={18}/> 出生保护抵挡伤害</div>}
    <div className="bottom-hud"><div className={`health-block ${hud.health<30?'low':''}`}><Cross size={27}/><strong>{hud.health}</strong><div><span>生命值</span><div className="health-track"><i style={{width:`${hud.health}%`}}/></div></div></div><div className="hud-tip"><kbd>1</kbd> 步枪 <kbd>2</kbd> 手枪 <span>·</span><kbd>R</kbd> 换弹</div><div className="ammo-block"><div className="weapon-label"><span>{hud.weapon==='rifle'?'AR-4':'P-12'}</span><small>{hud.weapon==='rifle'?'突击步枪 / 自动':'战术手枪 / 连发'}</small></div><div className="ammo-count"><strong className={hud.ammo<6?'low-ammo':''}>{String(hud.ammo).padStart(2,'0')}</strong><span>/ {hud.reserve}</span></div></div></div>
    {!hud.alive&&!hud.result&&!hud.menuOpen&&<div className="death-overlay"><Skull size={34}/><small>你已阵亡</small><h2>重返战场</h2><div className="respawn-number">{Math.max(1,Math.ceil(hud.respawnLeft))}</div><p>正在寻找安全出生点</p></div>}
    {hud.menuOpen&&!hud.result&&<div className="modal-backdrop"><section className="game-panel"><div className="eyebrow">MATCH SETTINGS</div><h2>行动设置<span>.</span></h2><p>联机比赛仍在继续。准备好后返回战场。</p><SensitivityControl value={settings.sensitivity} onChange={sensitivity=>onSettings({...settings,sensitivity})}/><div className="setting-row sound-setting"><span>游戏音效</span><Switch checked={settings.sound} onCheckedChange={sound=>onSettings({...settings,sound})} aria-label="游戏音效"/></div><button className="primary-button" onClick={onResume}><Play size={18}/> 继续行动</button><button className="text-button" onClick={onLeave}>离开房间，返回模式选择</button><NetworkDetails hud={hud}/><p>WASD 移动 · 左键射击 · 右键切换瞄准<br/>R 换弹 · 1 / 2 切枪 · ESC 设置</p></section></div>}
    {hud.result&&<div className="modal-backdrop"><section className="game-panel result-panel"><div className="eyebrow">MISSION COMPLETE</div><h2>{hud.result==='win'?'行动胜利':hud.result==='loss'?'再接再厉':hud.result==='draw'?'势均力敌':'比赛已结束'}<span>.</span></h2><p>{hud.result==='unknown'?'已重新连接到结束的房间，本局结果不可用。':'本局比赛已结束'}</p>{hud.result!=='unknown'&&<div className="result-stats"><div><b>{hud.kills}</b><span>击杀</span></div><div><b>{hud.deaths}</b><span>阵亡</span></div><div><b>{Math.round(300-hud.remaining)}s</b><span>对战时长</span></div></div>}{isHost?<button className="primary-button" onClick={onReturnToRoom}>返回房间</button>:<p className="room-waiting">等待房主返回房间…</p>}<button className="text-button" onClick={onLeave}>离开房间，返回模式选择</button></section></div>}
    {!hud.connected&&!hud.result&&<div className="network-overlay"><div><strong>{hud.networkStatus||'连接不稳定，正在恢复比赛…'}</strong><small>恢复后会自动回到当前战局，请保持此页面开启。</small><NetworkDetails hud={hud}/></div></div>}
  </>;
}

function NetworkDetails({hud}:{hud:DisplayHud}){
  const parts=[hud.latency>=0?`延迟 ${Math.round(hud.latency)}ms`:'延迟测量中',hud.snapshotAge!=null?`快照 ${Math.round(hud.snapshotAge)}ms`:null,hud.pendingInputs!=null?`待确认 ${hud.pendingInputs}`:null,hud.frameMs!=null?`帧 ${hud.frameMs.toFixed(1)}ms`:null,hud.serverTickMs!=null?`服务端 ${hud.serverTickMs.toFixed(1)}ms`:null].filter(Boolean);
  return <small className="network-details">{parts.join(' · ')}</small>;
}
