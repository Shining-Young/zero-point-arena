'use client';
import { useState } from 'react';
import Game from './training';
import Multiplayer from './multiplayer';

export default function RootGame(){const[mode,setMode]=useState<'choose'|'training'|'multi'>('choose');if(mode==='training')return <Game onBack={()=>setMode('choose')}/>;if(mode==='multi')return <Multiplayer onBack={()=>setMode('choose')}/>;return <main className="mode-screen"><section><small>ZERO POINT · 零点行动</small><h1>选择作战模式<span>.</span></h1><button className="mode-card" onClick={()=>setMode('training')}><b>单人训练</b><span>离线挑战 4 名人机</span></button><button className="mode-card featured" onClick={()=>setMode('multi')}><b>互联网联机</b><span>创建房间，邀请 1–3 位朋友</span></button><p>联机模式使用房间码，不需要注册账号。</p></section></main>}

