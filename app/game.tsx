'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Crosshair, Volume2, VolumeX, Expand, Shield, Target, ChevronRight, RotateCcw, Play, ArrowLeft, Skull, Timer, Zap, Monitor, Radio, Flag, Cross } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { INITIAL, type ArenaGame, type Snapshot, type Difficulty, type Options } from '@/lib/game/engine';
import { OBSTACLES } from '@/lib/game/rules';

const difficulties=[{id:'easy',label:'新兵',hint:'轻松热身'},{id:'normal',label:'标准',hint:'保持警惕'},{id:'hard',label:'精英',hint:'全力以赴'}] as const;
const controls=[['W A S D','移动'],['鼠标','转向'],['左键 / 右键','射击 / 瞄准'],['R','换弹'],['1 / 2','切枪'],['SHIFT','冲刺'],['SPACE','跳跃'],['C / CTRL','蹲伏'],['ESC','暂停']];
function Radar({state,large=false}:{state:Snapshot;large?:boolean}){
  return <svg className={large?'radar large':'radar'} viewBox="-27 -27 54 54" aria-label="七号仓库地图，橙色箭头是你，红点是可见敌人" role="img">
    <defs><pattern id={large?'map-grid-lg':'map-grid'} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M 4 0 L 0 0 0 4" fill="none" stroke="#a5bcb2" strokeWidth=".08" opacity=".2"/></pattern></defs>
    <rect x="-26" y="-26" width="52" height="52" fill="#152025"/>
    <rect x="-24" y="-24" width="48" height="48" fill={`url(#${large?'map-grid-lg':'map-grid'})`} stroke="#5a6c6d" strokeWidth=".55"/>
    {OBSTACLES.map((o,i)=><rect key={i} x={o.x-o.w/2} y={o.z-o.d/2} width={o.w} height={o.d} fill={o.kind==='container'?'#506971':'#758080'} stroke="#9facaa" strokeWidth=".16"/>)}
    <text x="-20" y="-16" fill="#b6c3bc" fontSize="3">A</text><text x="15" y="20" fill="#b6c3bc" fontSize="3">B</text>
    {state.bots.filter(b=>b.visible).map((b,i)=><circle key={i} cx={b.x} cy={b.z} r=".8" fill="#ff8068"/>)}
    <g transform={`translate(${state.x} ${state.z}) rotate(${-state.yaw*180/Math.PI})`}><path d="M 0 -2.3 L 1.7 1.6 L 0 .7 L -1.7 1.6 Z" fill="#ffb354"/><circle r="3.6" fill="none" stroke="#ffb354" strokeWidth=".18" opacity=".5"/></g>
  </svg>;
}
function KeyGuide(){return <div className="key-guide">{controls.map(([key,label])=><span key={key}><kbd>{key}</kbd><span>{label}</span></span>)}</div>;}
export default function Game(){
  const mount=useRef<HTMLDivElement>(null),game=useRef<ArenaGame|null>(null);
  const [state,setState]=useState<Snapshot>(INITIAL),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [options,setOptions]=useState<Options>({difficulty:'normal',sensitivity:1,sound:true}),[notice,setNotice]=useState('');
  useEffect(()=>{
    let cancelled=false;
    import('@/lib/game/engine').then(({ArenaGame:Engine})=>{
      if(cancelled||!mount.current)return;
      try{game.current=new Engine(mount.current,setState);setReady(true);}catch(e){console.error(e);setError('三维场景未能启动。请使用支持 WebGL 的电脑浏览器，并开启硬件加速后刷新。');}
    }).catch(()=>setError('游戏资源加载失败，请刷新页面重试。'));
    return()=>{cancelled=true;game.current?.dispose();game.current=null;};
  },[]);
  useEffect(()=>{game.current?.configure(options);},[options]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);},[notice]);
  const toggleSound=()=>setOptions(o=>({...o,sound:!o.sound}));
  const fullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setNotice('当前窗口不支持全屏，可在独立浏览器中打开游戏。');}};
  const time=`${Math.floor(state.time/60).toString().padStart(2,'0')}:${Math.floor(state.time%60).toString().padStart(2,'0')}`;
  const menu=state.phase==='menu',playing=['playing','respawn'].includes(state.phase);
  return <main className={`game-shell phase-${state.phase}`}>
    <div ref={mount} className="viewport"/>
    {menu&&<div className="menu-shade"/>}
    {(!ready||error)&&<div className="loading-surface"><Crosshair size={38}/><strong>{error?'无法进入训练场':'正在准备训练场'}</strong><p>{error||'装配装备与场景…'}</p>{error&&<button className="primary-button" onClick={()=>window.location.reload()}>重新加载 <RotateCcw size={18}/></button>}</div>}
    <header className="topbar">
      <div className="brand"><span className="brand-symbol"><Crosshair size={25}/></span><span>ZERO<span className="brand-slash"> / </span>POINT<small>零点行动</small></span></div>
      {menu?<div className="session-label"><span className="live-dot"/> 本地训练场 <span className="divider">/</span><span>单人 · 人机对战</span></div>:<div className="scoreboard"><div className="your-score"><span>你</span><strong>{String(state.kills).padStart(2,'0')}</strong></div><div className="match-clock"><small>击杀竞赛 · 目标 15</small><b>{time}</b></div><div className="enemy-score"><strong>{String(state.deaths).padStart(2,'0')}</strong><span>人机</span></div></div>}
      <div className="top-actions"><button aria-label={options.sound?'关闭音效':'打开音效'} title={options.sound?'关闭音效':'打开音效'} onClick={toggleSound}>{options.sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button><button aria-label="切换全屏" title="全屏" onClick={fullscreen}><Expand size={19}/></button>{playing&&<button className="pause-button" onClick={()=>game.current?.pause()}>ESC</button>}</div>
    </header>
    {menu&&<>
      <section className="briefing">
        <div className="eyebrow"><span className="orange-rule"/> 01 — COMBAT TRAINING</div>
        <h1>零点<span>行动<span className="title-dot">.</span></span></h1>
        <p className="mode-title"><Crosshair size={18}/> 击杀竞赛 <span>DEATHMATCH</span></p>
        <p className="brief">进入七号仓库，与 4 名 AI 对手交战。<br/>保持移动，利用掩体，率先取得 15 次击杀。</p>
        <div className="difficulty-label"><span>对手难度</span><small>DIFFICULTY</small></div>
        <RadioGroup value={options.difficulty} onValueChange={v=>setOptions(o=>({...o,difficulty:v as Difficulty}))} className="difficulty-options" aria-label="对手难度">
          {difficulties.map((d,i)=><label key={d.id} className={`difficulty-card ${options.difficulty===d.id?'selected':''}`}><div className="difficulty-top"><span className="rank-bars">{[0,1,2].map(n=><i key={n} className={n<=i?'lit':''}/>)}</span><RadioGroupItem value={d.id} aria-label={d.label}/></div><strong>{d.label}</strong><small>{d.hint}</small></label>)}
        </RadioGroup>
        <button className="primary-button deploy-button" disabled={!ready} onClick={()=>game.current?.start(options)}><span><Play size={20} fill="currentColor"/> 开始行动</span><ArrowUpRight size={25}/></button>
        <div className="launch-note"><Shield size={13}/> 无需登录游戏账号 <span>·</span> 即时开始</div>
      </section>
      <aside className="map-brief"><div className="map-heading"><div><small>作战区域 / 07</small><h2>七号仓库</h2></div><ArrowUpRight size={22}/></div><Radar state={state} large/><div className="map-details"><span><Radio size={14}/> 4 名 AI 对手</span><span><Timer size={14}/> 5 分钟</span></div><div className="map-coordinates">DEPOT 07 <span>工业区 · 日间</span></div></aside>
      <div className="scene-caption"><span className="live-dot"/> LIVE ENVIRONMENT <i/> 七号仓库 / 北区</div>
      <footer className="menu-footer"><KeyGuide/><div className="build-label">ZERO POINT <span>训练版本 1.0</span></div></footer>
    </>}
    {!menu&&<>
      <div className="radar-hud"><Radar state={state}/><div><span className="live-dot"/> 七号仓库 <span>N ↑</span></div></div>
      <div className="kill-feed" aria-live="polite">{state.feed.map(f=><div key={f.id} className={f.attacker==='你'?'friendly':''}><strong>{f.attacker}</strong>{f.headshot?<Crosshair size={15}/>:<Zap size={14}/>}<span>{f.victim}</span>{f.headshot&&<small>爆头</small>}</div>)}</div>
      {playing&&state.health>0&&<>
        <div className={`crosshair ${state.aim?'aiming':''}`}><i/><i/><i/><i/><b/></div>
        {state.hit>0&&<div className={`hit-marker ${state.hit>1?'headshot':''}`}>×</div>}
        {state.protection>0&&<div className="protection"><Shield size={15}/> 出生保护 {Math.ceil(state.protection)}s</div>}
        {state.reloading>0&&<div className="reload-indicator"><span>正在换弹</span><div><i style={{width:`${(1-state.reloading)*100}%`}}/></div></div>}
        {state.ammo===0&&state.reloading===0&&<div className="reload-indicator">{state.reserve>0?'按 R 换弹':'备用弹药耗尽 · 按 1 / 2 切换武器'}</div>}
      </>}
      <div className="damage-vignette" style={{opacity:state.hurt*.75}}/>
      <div className="bottom-hud"><div className={`health-block ${state.health<30?'low':''}`}><Cross size={27}/><strong>{state.health}</strong><div><span>生命值</span><div className="health-track"><i style={{width:`${state.health}%`}}/></div></div></div><div className="hud-tip"><kbd>1</kbd> 步枪 <kbd>2</kbd> 手枪 <span>·</span><kbd>R</kbd> 换弹</div><div className="ammo-block"><div className="weapon-label"><span>{state.weapon===0?'AR-4':'P-12'}</span><small>{state.weapon===0?'突击步枪 / 自动':'战术手枪 / 连发'}</small></div><div className="ammo-count"><strong className={state.ammo<6?'low-ammo':''}>{String(state.ammo).padStart(2,'0')}</strong><span>/ {state.reserve}</span></div></div></div>
      {state.fallback&&playing&&<div className="fallback-note">鼠标未锁定：按住右键转向，或用方向键调整视角；左键射击。</div>}
    </>}
    {state.phase==='respawn'&&<div className="death-overlay"><Skull size={34}/><small>你已阵亡</small><h2>重返战场</h2><div className="respawn-number">{Math.max(1,Math.ceil(state.respawn))}</div><p>正在寻找安全出生点</p></div>}
    {state.phase==='paused'&&<div className="modal-backdrop"><section className="game-panel"><div className="eyebrow">TAKE A BREATHER</div><h2>行动暂停<span>.</span></h2><p>战场已暂停，准备好后继续。</p><label className="setting-row"><span>鼠标灵敏度</span><b>{options.sensitivity.toFixed(1)}</b></label><Slider aria-label="鼠标灵敏度" value={[options.sensitivity]} min={.3} max={2.5} step={.1} onValueChange={value=>setOptions(o=>({...o,sensitivity:Array.isArray(value)?value[0]:value}))}/><label className="setting-row sound-setting"><span>游戏音效</span><Switch checked={options.sound} onCheckedChange={checked=>setOptions(o=>({...o,sound:checked}))} aria-label="游戏音效"/></label><button className="primary-button" onClick={()=>game.current?.resume()}><span><Play size={18}/> 继续行动</span><ChevronRight size={20}/></button><button className="text-button" onClick={()=>game.current?.menu()}><ArrowLeft size={16}/> 结束本局，返回训练场</button><KeyGuide/></section></div>}
    {state.phase==='finished'&&<div className="modal-backdrop"><section className="game-panel result-panel"><div className="eyebrow">MISSION COMPLETE</div><div className="result-emblem">{state.result==='win'?<Flag size={39}/>:<Target size={39}/>}</div><h2>{state.result==='win'?'行动胜利':state.result==='draw'?'势均力敌':'再接再厉'}<span>.</span></h2><p>{state.result==='win'?'七号仓库，由你掌控。':state.result==='draw'?'时间结束，双方击杀数相同。':'调整节奏，下一局重新出发。'}</p><div className="result-score"><strong>{state.kills}</strong><span>:</span><b>{state.deaths}</b></div><div className="result-stats"><div><b>{state.shots?Math.round(state.hits/state.shots*100):0}%</b><span>命中率</span></div><div><b>{state.headshots}</b><span>爆头击杀</span></div><div><b>{Math.round(300-state.time)}s</b><span>对战时长</span></div></div><button className="primary-button" onClick={()=>game.current?.start(options)}><span><RotateCcw size={18}/> 再来一局</span><ArrowUpRight size={22}/></button><button className="text-button" onClick={()=>game.current?.menu()}>返回训练场</button></section></div>}
    {notice&&<div className="toast" role="status">{notice}</div>}
    <div className="mobile-warning"><Monitor size={36}/><h2>准备键盘与鼠标</h2><p>零点行动需要电脑键鼠操作。<br/>请在电脑浏览器中打开，并使用横向窗口。</p></div>
  </main>;
}
