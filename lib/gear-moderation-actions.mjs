const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ACTIONS=new Set(['dismiss','remove','restore']);
const ACTIVE_LIMIT=10;

const changes=result=>result?.meta?.changes??result?.changes??0;
const conflictError=error=>/UNIQUE constraint failed: gear_(?:removals\.listing_id|listings\.seller_id, gear_listings\.duplicate_key)/.test(String(error?.message));

function validClock(now){
  if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid moderation timestamp.');
}

function validActor(actor){
  if(typeof actor!=='string'||!actor||actor.length>254||/[\x00-\x20\x7f]/.test(actor))throw new TypeError('Invalid moderation actor.');
}

export function validateModerationAction(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!ACTIONS.has(input.action)||typeof input.id!=='string'||!UUID.test(input.id)||typeof input.reason!=='string')return null;
  const reason=input.reason.trim();
  if(!reason||reason.length>500||/[\x00-\x1f\x7f]/.test(reason))return null;
  return {action:input.action,id:input.id,reason};
}

function historyMatch(action,listing='?'){
  return `EXISTS(SELECT 1 FROM gear_moderation_history h
    WHERE h.actor=? AND h.action='${action}' AND h.listing_id=${listing}
      AND h.report_id ${action==='restore'?'IS NULL':'=?'} AND h.reason=? AND h.created_at=?)`;
}

function dismissStatements(db,{actor,id,reason},now){
  return [
    db.prepare(`INSERT INTO gear_moderation_history
      (actor,action,listing_id,report_id,report_reason,reason,before_status,after_status,created_at)
      SELECT ?,'dismiss',r.listing_id,r.id,r.reason,?,l.status,l.status,?
      FROM gear_reports r JOIN gear_listings l ON l.id=r.listing_id
      WHERE r.id=? AND r.resolution='open'`).bind(actor,reason,now,id),
    db.prepare(`UPDATE gear_reports SET resolution='dismissed'
      WHERE id=? AND resolution='open'
        AND ${historyMatch('dismiss','gear_reports.listing_id')}
      RETURNING id`).bind(id,actor,id,reason,now),
  ];
}

function removeStatements(db,{actor,id,reason},now){
  const history=db.prepare(`INSERT INTO gear_moderation_history
    (actor,action,listing_id,report_id,report_reason,reason,before_status,after_status,created_at)
    SELECT ?,'remove',l.id,r.id,r.reason,?,l.status,'removed',?
    FROM gear_reports r JOIN gear_listings l ON l.id=r.listing_id
    JOIN gear_sellers s ON s.id=l.seller_id
    WHERE r.id=? AND r.resolution='open' AND l.status IN ('available','pending')
      AND l.verified_at IS NOT NULL AND s.verified_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM gear_removals x WHERE x.listing_id=l.id)`)
    .bind(actor,reason,now,id);
  return [history,
    db.prepare(`INSERT INTO gear_removals(listing_id,previous_status,removed_at,reason)
      SELECT l.id,l.status,?,? FROM gear_reports r JOIN gear_listings l ON l.id=r.listing_id
      WHERE r.id=? AND r.resolution='open' AND l.status IN ('available','pending')
        AND ${historyMatch('remove','l.id')}`)
      .bind(now,reason,id,actor,id,reason,now),
    db.prepare(`UPDATE gear_listings SET status='removed'
      WHERE id=(SELECT listing_id FROM gear_reports WHERE id=? AND resolution='open')
        AND status IN ('available','pending') AND EXISTS(SELECT 1 FROM gear_removals x
          WHERE x.listing_id=gear_listings.id AND x.previous_status=gear_listings.status
            AND x.removed_at=? AND x.reason=?)
        AND ${historyMatch('remove','gear_listings.id')}
      RETURNING id`).bind(id,now,reason,actor,id,reason,now),
    db.prepare(`UPDATE gear_reports SET resolution='removed'
      WHERE id=? AND resolution='open'
        AND EXISTS(SELECT 1 FROM gear_listings l JOIN gear_removals x ON x.listing_id=l.id
          WHERE l.id=gear_reports.listing_id AND l.status='removed' AND x.removed_at=? AND x.reason=?)
        AND ${historyMatch('remove','gear_reports.listing_id')}
      RETURNING id`).bind(id,now,reason,actor,id,reason,now),
  ];
}

function restoreStatements(db,{actor,id,reason},now){
  const eligible=`l.id=? AND l.status='removed' AND x.previous_status IN ('available','pending')
    AND l.verified_at IS NOT NULL AND s.verified_at IS NOT NULL AND l.expires_at>?
    AND (SELECT count(*) FROM gear_listings active WHERE active.seller_id=l.seller_id
      AND active.status IN ('available','pending') AND active.expires_at>?)<${ACTIVE_LIMIT}
    AND NOT EXISTS(SELECT 1 FROM gear_listings duplicate WHERE duplicate.id!=l.id
      AND duplicate.seller_id=l.seller_id AND duplicate.duplicate_key=l.duplicate_key
      AND duplicate.status IN ('available','pending') AND duplicate.expires_at>?)`;
  // Before production seller deletion exists, its durable marker must also be
  // added to this eligibility predicate so owner restore cannot bypass deletion.
  return [
    db.prepare(`INSERT INTO gear_moderation_history
      (actor,action,listing_id,report_id,report_reason,reason,before_status,after_status,created_at)
      SELECT ?,'restore',l.id,NULL,NULL,?,l.status,x.previous_status,?
      FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
      JOIN gear_removals x ON x.listing_id=l.id WHERE ${eligible}`)
      .bind(actor,reason,now,id,now,now,now),
    db.prepare(`UPDATE gear_listings SET status='expired'
      WHERE id!=? AND status IN ('available','pending') AND expires_at<=?
        AND seller_id=(SELECT seller_id FROM gear_listings WHERE id=?)
        AND duplicate_key=(SELECT duplicate_key FROM gear_listings WHERE id=?)
        AND EXISTS(SELECT 1 FROM gear_listings target JOIN gear_removals x ON x.listing_id=target.id
          WHERE target.id=? AND target.status='removed')
        AND ${historyMatch('restore')}`)
      .bind(id,now,id,id,id,actor,id,reason,now),
    db.prepare(`UPDATE gear_listings SET status=(SELECT previous_status FROM gear_removals WHERE listing_id=gear_listings.id)
      WHERE id=? AND status='removed' AND expires_at>?
        AND EXISTS(SELECT 1 FROM gear_removals x WHERE x.listing_id=gear_listings.id)
        AND ${historyMatch('restore','gear_listings.id')}
      RETURNING id`).bind(id,now,actor,reason,now),
    db.prepare(`DELETE FROM gear_removals WHERE listing_id=?
      AND EXISTS(SELECT 1 FROM gear_listings l WHERE l.id=gear_removals.listing_id
        AND l.status IN ('available','pending'))
      AND ${historyMatch('restore','gear_removals.listing_id')}
      RETURNING listing_id`).bind(id,actor,reason,now),
  ];
}

export async function moderateListing(db,input,now=Date.now()){
  validClock(now);validActor(input?.actor);
  const action=validateModerationAction(input);
  if(!action)throw new TypeError('Invalid moderation action.');
  const value={...action,actor:input.actor};
  const statements=action.action==='dismiss'?dismissStatements(db,value,now):action.action==='remove'?removeStatements(db,value,now):restoreStatements(db,value,now);
  try{
    const results=await db.batch(statements);
    if(changes(results[0])===0)return false;
    const required=action.action==='restore'?[0,2,3]:results.map((_result,index)=>index);
    // D1 has committed when batch resolves. This is a diagnostic alarm, not a
    // rollback guard; the same-batch history predicates make it unreachable
    // unless a future schema or statement breaks the transaction invariant.
    if(required.some(index=>changes(results[index])!==1))throw new Error('Moderation transaction invariant failed.');
    return true;
  }catch(error){
    if(conflictError(error))return false;
    throw error;
  }
}
