export type WeaponFrame={reloadLeft:number;reloadTotal:number;alive:boolean;blocked?:boolean;sprint?:boolean;bob?:number};
/** Local visual state; ammo and reload completion remain owned by the simulation. */
export class WeaponPresentation{
  aimIntent=false;aim=false;recoil=0;ads=0;
  toggleAim(){this.aimIntent=!this.aimIntent;}
  reset(){this.aimIntent=false;this.aim=false;this.recoil=0;this.ads=0;}
  shoot(){this.recoil=Math.min(.12,this.recoil+.045);}
  update(dt:number,frame:WeaponFrame){
    if(!frame.alive||frame.blocked)this.reset();
    this.aim=this.aimIntent&&frame.reloadLeft<=0&&frame.alive&&!frame.blocked;
    this.ads+=((this.aim?1:0)-this.ads)*(1-Math.exp(-12*Math.max(0,dt)));
    this.recoil=Math.max(0,this.recoil-Math.max(0,dt)*.3);
    const remaining=frame.reloadLeft>0?Math.max(0,Math.min(1,frame.reloadLeft/Math.max(frame.reloadTotal,.001))):0;
    const dip=Math.sin(remaining*Math.PI);
    return {aiming:this.aim,fov:76-25*this.ads,x:.28-.26*this.ads,y:-.29+(frame.bob??0)*.6-dip*.3,z:-.5+this.recoil,rotationX:this.recoil*.7,rotationZ:remaining>0?-.4*dip:frame.sprint?-.3:0,reloadProgress:remaining>0?1-remaining:1};
  }
}
