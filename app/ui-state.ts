export type RoomPhase='lobby'|'playing'|'finished';
export type MatchResult='win'|'loss'|'draw'|'unknown'|null;

export function adjustSensitivity(value:number,delta:number){
  return Math.max(.3,Math.min(2.5,Math.round((value+delta)*10)/10));
}

export function roomView(phase:RoomPhase){return phase==='lobby'?'lobby':'match';}

export function shouldDisposeMatchEngine(phase:RoomPhase|undefined){return !phase||phase==='lobby';}

export function resultForRoom(phase:RoomPhase,result:MatchResult):MatchResult{
  return result??(phase==='finished'?'unknown':null);
}
