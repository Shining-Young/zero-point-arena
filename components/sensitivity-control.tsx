'use client';
import { adjustSensitivity } from '../app/ui-state';

export function SensitivityControl({value,onChange}:{value:number;onChange:(value:number)=>void}){
  const update=(next:number)=>onChange(adjustSensitivity(next,0));
  return <div className="sensitivity-control">
    <div className="setting-row"><span>鼠标灵敏度</span><output htmlFor="mouse-sensitivity">{value.toFixed(1)}</output></div>
    <div className="sensitivity-inputs">
      <button type="button" aria-label="降低鼠标灵敏度" onClick={()=>onChange(adjustSensitivity(value,-.1))}>−</button>
      <input id="mouse-sensitivity" aria-label="鼠标灵敏度" type="range" min="0.3" max="2.5" step="0.1" value={value} onChange={event=>update(Number(event.target.value))}/>
      <button type="button" aria-label="提高鼠标灵敏度" onClick={()=>onChange(adjustSensitivity(value,.1))}>+</button>
      <input className="sensitivity-number" aria-label="鼠标灵敏度数值" type="number" min="0.3" max="2.5" step="0.1" value={value.toFixed(1)} onChange={event=>update(Number(event.target.value))}/>
      <button type="button" className="sensitivity-reset" onClick={()=>onChange(1)}>重置</button>
    </div>
  </div>;
}
