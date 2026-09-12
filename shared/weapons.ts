export type WeaponId='pistol'|'smg'|'shotgun'|'rifle'|'sniper';
export const WEAPON_IDS:WeaponId[]=['pistol','smg','shotgun','rifle','sniper'];
export type WeaponDefinition={id:WeaponId;name:string;description:string;capacity:number;reserve:number;unlimitedAmmo:boolean;damage:number;headMultiplier:number;cadence:number;reload:number;range:number;price:number;ammoPack:number;ammoPrice:number;falloffStart:number;falloffEnd:number;minDamage:number;pellets:number;automatic:boolean;spread:number;adsSpread:number;recoil:number;recovery:number;adsFov:number;stability:number};
const make=(id:WeaponId,name:string,capacity:number,reserve:number,damage:number,headMultiplier:number,rpm:number,reload:number,price:number,ammoPack:number,ammoPrice:number,falloffStart:number,falloffEnd:number,minDamage:number,pellets:number,automatic:boolean,spread:number,adsSpread:number,recoil:number,stability:number):WeaponDefinition=>({id,name,description:name,capacity,reserve,unlimitedAmmo:id==='pistol',damage,headMultiplier,cadence:60/rpm,reload,range:100,price,ammoPack,ammoPrice,falloffStart,falloffEnd,minDamage,pellets,automatic,spread,adsSpread,recoil,recovery:3,adsFov:id==='sniper'?30:55,stability});
export const WEAPONS:Record<WeaponId,WeaponDefinition>={
 pistol:make('pistol','P-12',12,0,18,2,300,1.3,0,0,0,15,40,.5,1,false,.012,.003,.025,75),
 smg:make('smg','V-9',30,120,19,2,850,1.7,450,30,45,12,35,.4,1,true,.025,.009,.018,60),
 shotgun:make('shotgun','SG-8',6,24,12,1.5,75,2.6,600,6,60,8,25,.2,9,false,.09,.065,.065,40),
 rifle:make('rifle','AR-4',30,120,30,3.5,600,2.2,900,30,90,30,65,.65,1,true,.015,.003,.03,70),
 sniper:make('sniper','SR-7',5,20,85,2,48,3,1500,5,100,60,100,.8,1,false,.05,.0005,.09,90),
};
export function damageAtDistance(weapon:WeaponId|WeaponDefinition,distance:number,headshot=false){const w=typeof weapon==='string'?WEAPONS[weapon]:weapon;const fraction=Math.max(0,Math.min(1,(distance-w.falloffStart)/(w.falloffEnd-w.falloffStart)));return w.damage*(1-fraction*(1-w.minDamage))*(headshot?w.headMultiplier:1);}
