# Economy and armory implementation — approved 2026-09-11

Approved scope: five guns, per-match coins, B shop, NPC parity, pistol-only start, 0 coins, infinite pistol reserve with finite magazine; death retains owned guns and remaining ammunition, no refill; new match resets. One equipped primary plus pistol, may own multiple primaries. Kill NPC150/human300 cap6000. Shop alive+stationary+2 seconds no firing/damage; never pauses multiplayer; browse when dead. No armor/trade/drop/sell.

Weapons exact baseline:
- pistol P-12 damage18 head2 rpm300 capacity12 reload1.3 price0 unlimited reserve falloff15..40 floor.5
- smg V-9 damage19 head2 rpm850 capacity30 reload1.7 price450 ammo30/45 reserve120 falloff12..35 floor.4
- shotgun SG-8 damage12 pellets9 head1.5 rpm75 capacity6 reload2.6 price600 ammo6/60 reserve24 falloff8..25 floor.2
- rifle AR-4 damage30 head3.5 rpm600 capacity30 reload2.2 price900 ammo30/90 reserve120 falloff30..65 floor.65
- sniper SR-7 damage85 head2 rpm48 capacity5 reload3 price1500 ammo5/100 reserve20 falloff60..100 floor.8
All max ray range100. Purchase first mag full reserve0. Ammo adds reserve only, reject overflow. Repeat equip never refills nor resets cadence. Semi pistol/shotgun/sniper, auto smg/rifle. ADS toggle; sprint exits ADS. Weapon-specific recoil/spread/animations/audio/models. Shotgun pellets aggregate damage per victim one kill reward. Seeded spread shared server and client, authoritative result. Head/body damage same bots/humans, difficulty only AI.

Contract:
shared/weapons.ts exports WeaponId='pistol'|'smg'|'shotgun'|'rifle'|'sniper', WEAPON_IDS in that order, WEAPONS record fields id,name,description,capacity,reserve (max; pistol0 with unlimitedAmmo true),damage,headMultiplier,cadence(seconds),reload,range100,price,ammoPack,ammoPrice,falloffStart,falloffEnd,minDamage,pellets,automatic,spread (radians static hip),adsSpread,recoil,recovery,adsFov,stability(0..100). exports damageAtDistance(weapon,distance,headshot?).
shared/economy.ts exports Inventory=Partial<Record<WeaponId,{ammo:number;reserve:number}>>, ShopState={coins:number;inventory:Inventory;primary:WeaponId|null;canBuy:boolean;buyBlockedReason:string}; shop buy request {type:'shop',requestId:string,action:'buy_weapon'|'buy_ammo'|'equip',weapon:WeaponId}; result {type:'shop_result',requestId,ok:boolean,reason:string}.
SnapshotEntity adds coins,inventory,primary,canBuy,buyBlockedReason (optional initially for old fixture compatibility acceptable; runtime always filled). Weapon from protocol expanded. Shot event adds ends?:Point3[] (pellets). Server public buy(playerId,action,weapon,requestId) returns {ok,reason}; gateway invokes sends result. All mutations server owned, dedupe request IDs bounded per player. shared combat traceWeaponShot accepts all IDs; new traceWeaponBurst(origin,yaw,pitch,weapon,aiming,targets,seed,moving=false,crouched=false,shotHeat=0) returns shot array using deterministic offsets. Exports may add heat helper.

Tasks
1 Server/shared weapons/economy/ballistics/NPC and meaningful tests (delegate).
2 Root: models, audio, presentation; client five guns/shop; shared UI; local training adapter reuses MatchSimulation (pure TS no Node imports) and MultiplayerGame, retaining offline pause.
3 Integration review, update old tests for pistol start legitimately, verify full tests/typecheck/build/pack. Release0.3.0 protocol5; no browser automation. Deploy via CLI if available or give user Render instructions.

Progress: implementation complete; 127 automated checks, typecheck, local two-client smoke and client build passed. Independent review completed; reproduced and fixed sniper NPC engagement beyond 35m. Release packaging in progress. Ruling: keep current checkout and branch codex/economy-armory to preserve launch path. Ruling: single authoritative simulation reused by training to prevent economy/ballistics divergence; old offline engine retained only until UI replacement verified.
