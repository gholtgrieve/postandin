import {createGearMaintenanceBudget,GEAR_MAINTENANCE_DEADLINE_MS,GEAR_MAINTENANCE_INVOCATION_DB_OPERATIONS,GEAR_MAINTENANCE_RETRY_MS,runGearMaintenance} from '../../lib/gear-maintenance.mjs';
import {sendMaintenanceAlert,validateMaintenanceAlertEnvironment} from '../../lib/gear-maintenance-alert.mjs';

const STATE_KEY='gear-maintenance-status-v1';
const RECONCILIATION_CURSOR_KEY='gear-photo-reconciliation-cursors-v1';
const PHOTO_PURPOSES=['gear-photo-quarantine','gear-photo'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function validateBindings(env){
  if(!env?.GEAR_DB?.prepare||!env?.GEAR_DB?.batch||!env?.IMAGES?.hosted?.image||!env?.IMAGES?.hosted?.list
    ||!env?.GEAR_MAINTENANCE_STATE?.get||!env?.GEAR_MAINTENANCE_STATE?.put||!env?.GEAR_MAINTENANCE_STATE?.delete)throw new Error('Gear maintenance bindings are not configured.');
  validateMaintenanceAlertEnvironment(env);
}

async function state(env){
  const value=await env.GEAR_MAINTENANCE_STATE.get(STATE_KEY,{type:'json'});
  return value&&value.failing===true&&typeof value.episode==='string'?value:null;
}

async function reconciliationCursorState(env){
  try{
    const value=await env.GEAR_MAINTENANCE_STATE.get(RECONCILIATION_CURSOR_KEY,{type:'json'});
    if(value===null)return {};
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!PHOTO_PURPOSES.includes(key)))return {};
    const result={};
    for(const purpose of PHOTO_PURPOSES){
      const cursor=value[purpose];
      if(cursor===undefined)continue;
      if(typeof cursor!=='string'||cursor.length<1||cursor.length>2048)return {};
      result[purpose]=cursor;
    }
    return result;
  }catch{return {};}
}

async function maintenanceAttempt(env,run,now,budget){
  const reconciliationCursors=await reconciliationCursorState(env);
  const initial=JSON.stringify(reconciliationCursors);
  const saveReconciliationCursor=async(purpose,cursor)=>{
    if(!PHOTO_PURPOSES.includes(purpose))throw new Error('Gear photo reconciliation purpose is invalid.');
    if(cursor===null)delete reconciliationCursors[purpose];else reconciliationCursors[purpose]=cursor;
  };
  try{return await run(env,{now:now(),budget,reconciliationCursors,saveReconciliationCursor});}
  finally{
    const current=JSON.stringify(reconciliationCursors);
    if(current!==initial){
      try{
        if(Object.keys(reconciliationCursors).length)await env.GEAR_MAINTENANCE_STATE.put(RECONCILIATION_CURSOR_KEY,current);
        else await env.GEAR_MAINTENANCE_STATE.delete(RECONCILIATION_CURSOR_KEY);
      }catch{
        const error=new Error('Gear photo reconciliation cursor persistence failed.');error.code='photo-reconcile-state';throw error;
      }
    }
  }
}

async function recordFailure(env,at,send){
  let current=await state(env);
  if(!current){
    current={failing:true,alerted:false,episode:crypto.randomUUID(),failedAt:at};
    await env.GEAR_MAINTENANCE_STATE.put(STATE_KEY,JSON.stringify(current));
  }
  if(!current.alerted){
    await send({kind:'failure',episode:current.episode,at},env);
    await env.GEAR_MAINTENANCE_STATE.put(STATE_KEY,JSON.stringify({...current,alerted:true}));
  }
}

async function recordRecovery(env,at,send){
  const current=await state(env);if(!current)return;
  if(current.alerted)await send({kind:'recovery',episode:current.episode,at},env);
  await env.GEAR_MAINTENANCE_STATE.delete(STATE_KEY);
}

export async function runScheduledGearMaintenance(env,{now=Date.now,delay=sleep,run=runGearMaintenance,send=sendMaintenanceAlert}={}){
  validateBindings(env);
  const budget=createGearMaintenanceBudget({maxDbOperations:GEAR_MAINTENANCE_INVOCATION_DB_OPERATIONS,deadline:now()+GEAR_MAINTENANCE_DEADLINE_MS,clock:now});
  let result,retried=false;
  try{
    result=await maintenanceAttempt(env,run,now,budget);
  }catch(firstError){
    console.error('Gear maintenance attempt failed; retrying in one minute.',firstError?.code??'unexpected');
    await delay(GEAR_MAINTENANCE_RETRY_MS);retried=true;
    try{
      result=await maintenanceAttempt(env,run,now,budget);
    }catch(secondError){
      console.error('Gear maintenance failed after retry.',secondError?.code??'unexpected');
      try{await recordFailure(env,now(),send);}
      catch(alertError){console.error('Gear maintenance failure alert state failed.',alertError?.code??'unexpected');}
      throw new Error('Gear maintenance failed after retry.');
    }
  }
  try{await recordRecovery(env,now(),send);}
  catch(alertError){console.error('Gear maintenance recovery alert state failed.',alertError?.code??'unexpected');throw new Error('Gear maintenance recovery alert failed.');}
  return {...result,retried};
}

export const createGearMaintenanceWorker=(dependencies={})=>({
  async scheduled(_controller,env,ctx){ctx.waitUntil(runScheduledGearMaintenance(env,dependencies));},
});

export default createGearMaintenanceWorker();
