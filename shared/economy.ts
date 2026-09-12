import type { WeaponId } from './weapons.ts';
export type Inventory=Partial<Record<WeaponId,{ammo:number;reserve:number}>>;
export type ShopState={coins:number;inventory:Inventory;primary:WeaponId|null;canBuy:boolean;buyBlockedReason:string};
export type ShopAction='buy_weapon'|'buy_ammo'|'equip';
export type ShopRequest={type:'shop';requestId:string;action:ShopAction;weapon:WeaponId};
export type ShopResult={type:'shop_result';requestId:string;ok:boolean;reason:string};
