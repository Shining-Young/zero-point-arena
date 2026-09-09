export type GameSettings={sensitivity:number;sound:boolean};
export const SETTINGS_KEY='zero-point-settings';
type SettingsStorage=Pick<Storage,'getItem'|'setItem'>;
const defaults:GameSettings={sensitivity:1,sound:true};
function normalize(value:Partial<GameSettings>):GameSettings{return {sensitivity:typeof value.sensitivity==='number'&&Number.isFinite(value.sensitivity)?Math.max(.3,Math.min(2.5,value.sensitivity)):1,sound:typeof value.sound==='boolean'?value.sound:true};}
export function readSettings(storage?:SettingsStorage):GameSettings{
  try{const target=storage??globalThis.localStorage;const value=JSON.parse(target.getItem(SETTINGS_KEY)??'{}');return normalize(value??{});}catch{return {...defaults};}
}
export function saveSettings(settings:GameSettings,storage?:SettingsStorage){try{(storage??globalThis.localStorage).setItem(SETTINGS_KEY,JSON.stringify(normalize(settings)));}catch{/* Storage can be unavailable in restricted windows. */}}
