// Runs only while the local server is listening. Production scheduling is separate.
export function startMaintenance(run,{schedule=setTimeout,cancel=clearTimeout,onError=()=>console.error('Local Gear cleanup failed; retrying in one minute.')}={}){
 let timer,stopped=false;
 function tick(){if(stopped)return;let delay=86400000;try{run();}catch{delay=60000;onError();}if(!stopped){timer=schedule(tick,delay);timer?.unref?.();}}
 tick();return ()=>{stopped=true;cancel(timer);};
}
