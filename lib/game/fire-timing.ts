/** Keep fractional frame remainder only during sustained fire; idle never banks shots. */
export function nextShotTime(previous:number,now:number,interval:number){return now-previous<interval*2?previous+interval:now;}
