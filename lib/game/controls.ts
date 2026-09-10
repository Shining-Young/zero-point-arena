/** Shared keyboard policy for local and network movement. */
export function readMovementControls(keys:ReadonlySet<string>,aiming:boolean,enabled=true){
 const moveX=enabled?Number(keys.has('KeyD'))-Number(keys.has('KeyA')):0;
 const moveZ=enabled?Number(keys.has('KeyW'))-Number(keys.has('KeyS')):0;
 const crouch=enabled&&(keys.has('KeyC')||keys.has('ControlLeft')||keys.has('ControlRight'));
 const sprint=enabled&&!crouch&&(moveX!==0||moveZ!==0)&&(keys.has('ShiftLeft')||keys.has('ShiftRight'));
 return {moveX,moveZ,crouch,sprint,aiming:enabled&&aiming&&!sprint,jump:enabled&&keys.has('Space')};
}
