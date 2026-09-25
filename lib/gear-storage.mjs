import { validateDraft } from './gear-validation.mjs';

export async function createDraft(db, input, now = Date.now()) {
  const d=validateDraft(input), id=crypto.randomUUID(), sellerId=crypto.randomUUID();
  // Seller reuse is bookkeeping, never proof of ownership. Each listing needs
  // its own submission-bound verification token. Seller verification must never
  // publish other drafts; unverified drafts stay out of management and quotas.
  // D1 batch is transactional: seller, listing and club records succeed together.
  await db.batch([
    db.prepare('INSERT INTO gear_sellers(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').bind(sellerId,d.email,now),
    db.prepare(`INSERT INTO gear_listings
      (id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,trade,other_club,created_at)
      VALUES(?,(SELECT id FROM gear_sellers WHERE email=?),?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,d.email,d.sellerName,d.title,d.description,d.category,d.size,d.fit,d.condition,d.city,d.type,d.priceCents,d.trade,d.otherClub,now),
    ...d.clubs.map(club=>db.prepare('INSERT INTO gear_listing_clubs(listing_id,club) VALUES(?,?)').bind(id,club)),
  ]);
  return {id,status:'unverified'};
}
// Trusted LOCAL tooling only. Do not expose this via Pages before ownership checks.
export async function readLocalDraft(db,id) {
  const row=await db.prepare(`SELECT l.*,s.email FROM gear_listings l
    JOIN gear_sellers s ON s.id=l.seller_id WHERE l.id=? AND l.status='unverified'`).bind(id).first();
  if(!row) return null;
  const {results}=await db.prepare('SELECT club FROM gear_listing_clubs WHERE listing_id=? ORDER BY club').bind(id).all();
  return {...row,clubs:results.map(r=>r.club)};
}
// Public read path deliberately selects only public fields, never seller email/ID.
export async function readPublicListings(db, now=Date.now()) {
  const {results}=await db.prepare(`SELECT l.id,l.title,l.description,l.category,l.size,l.fit,l.condition,l.city,
    l.type,l.price_cents AS priceCents,l.trade,l.other_club AS otherClub,l.seller_name AS sellerName,l.status,
    (SELECT json_group_array(club) FROM (SELECT club FROM gear_listing_clubs WHERE listing_id=l.id ORDER BY club)) AS clubs
    FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
    WHERE l.status IN ('available','pending') AND l.verified_at IS NOT NULL
      AND s.verified_at IS NOT NULL AND l.expires_at>?
    ORDER BY l.created_at DESC,l.id LIMIT 100`).bind(now).all();
  return results.map(row=>({...row,clubs:JSON.parse(row.clubs)}));
}
