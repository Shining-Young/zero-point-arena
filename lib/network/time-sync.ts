export function sampleSnapshots<T extends {serverTime:number}>(buffer:T[],renderServerTime:number){
  if(!buffer.length)return undefined;
  const sorted=[...buffer].sort((a,b)=>a.serverTime-b.serverTime);
  const before=[...sorted].reverse().find(item=>item.serverTime<=renderServerTime)??sorted[0];
  const after=sorted.find(item=>item.serverTime>=renderServerTime)??sorted[sorted.length-1];
  const span=after.serverTime-before.serverTime;
  const alpha=span<=0?0:Math.max(0,Math.min(1,(renderServerTime-before.serverTime)/span));
  return {before,after,alpha};
}

export class ServerTimeline {
  private clockOffset?: number;
  private lastRenderTime = -Infinity;

  observe(serverTime: number, receivedAt: number) {
    const sample = receivedAt - serverTime;
    if (this.clockOffset === undefined || sample < this.clockOffset) this.clockOffset = sample;
  }

  renderTime(now: number, interpolationDelay: number) {
    if (this.clockOffset === undefined) return 0;
    this.lastRenderTime = Math.max(this.lastRenderTime, now - this.clockOffset - interpolationDelay);
    return this.lastRenderTime;
  }
}

