export class TokenBucket {
  private tokens:number;
  private updatedAt:number;
  constructor(private readonly capacity:number,private readonly refillPerSecond:number,now=Date.now()){this.tokens=capacity;this.updatedAt=now;}
  take(now=Date.now()){
    this.tokens=Math.min(this.capacity,this.tokens+(now-this.updatedAt)/1000*this.refillPerSecond);this.updatedAt=now;
    if(this.tokens<1)return false;this.tokens-=1;return true;
  }
}

