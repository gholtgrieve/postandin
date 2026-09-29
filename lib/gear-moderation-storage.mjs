// Read-only production moderation projection. It deliberately omits seller
// email/ID, duplicate keys, acknowledgement evidence and hosted-image IDs.
export async function readOpenModerationReports(db) {
  const {results=[]}=await db.prepare(`SELECT
    r.id AS reportId,r.listing_id AS listingId,r.listing_title AS listingTitle,
    r.reason,r.created_at AS createdAt,r.resolution,
    l.title,l.description,l.category,l.size,l.fit,l.condition,l.city,l.type,
    l.price_cents AS priceCents,l.trade,l.seller_name AS sellerName,l.status,
    l.expires_at AS expiresAt
    FROM gear_reports r
    JOIN gear_listings l ON l.id=r.listing_id
    WHERE r.resolution='open'
    ORDER BY r.created_at DESC,r.id
    LIMIT 101`).bind().all();
  const reports=results.slice(0,100).map(row=>({
    reportId:row.reportId,
    listingId:row.listingId,
    listingTitle:row.listingTitle,
    reason:row.reason,
    createdAt:row.createdAt,
    resolution:row.resolution,
    listing:{
      title:row.title,
      description:row.description,
      category:row.category,
      size:row.size,
      fit:row.fit,
      condition:row.condition,
      city:row.city,
      type:row.type,
      priceCents:row.priceCents,
      trade:row.trade,
      sellerName:row.sellerName,
      status:row.status,
      expiresAt:row.expiresAt,
    },
  }));
  return {reports,truncated:results.length>100};
}
