import {OBSTACLES} from '../lib/game/rules.ts';
export function Radar({state,large=false}:{state:{x:number;z:number;yaw:number;bots:{x:number;z:number;visible:boolean}[]};large?:boolean}){
  return <svg className={large?'radar large':'radar'} viewBox="-27 -27 54 54" aria-label="七号仓库地图，橙色箭头是你，红点是可见敌人">
    <defs><pattern id={large?'map-grid-lg':'map-grid'} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M 4 0 L 0 0 0 4" fill="none" stroke="#a5bcb2" strokeWidth=".08" opacity=".2"/></pattern></defs>
    <rect x="-26" y="-26" width="52" height="52" fill="#152025"/>
    <rect x="-24" y="-24" width="48" height="48" fill={`url(#${large?'map-grid-lg':'map-grid'})`} stroke="#5a6c6d" strokeWidth=".55"/>
    {OBSTACLES.map((o,i)=><rect key={i} x={o.x-o.w/2} y={o.z-o.d/2} width={o.w} height={o.d} fill={o.kind==='container'?'#506971':'#758080'} stroke="#9facaa" strokeWidth=".16"/>)}
    <text x="-20" y="-16" fill="#b6c3bc" fontSize="3">A</text><text x="15" y="20" fill="#b6c3bc" fontSize="3">B</text>
    {state.bots.filter(b=>b.visible).map((b,i)=><circle key={i} cx={b.x} cy={b.z} r=".8" fill="#ff8068"/>)}
    <g transform={`translate(${state.x} ${state.z}) rotate(${-state.yaw*180/Math.PI})`}><path d="M 0 -2.3 L 1.7 1.6 L 0 .7 L -1.7 1.6 Z" fill="#ffb354"/><circle r="3.6" fill="none" stroke="#ffb354" strokeWidth=".18" opacity=".5"/></g>
  </svg>;
}
