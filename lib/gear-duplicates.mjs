// Price, offer type, condition and description are deliberately excluded:
// changing the terms of an existing item should be an edit, not another ad.
const normalized=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
export function duplicateKey(d){
  return JSON.stringify([
    d.title,d.category,d.size,d.fit,d.city,
    [...new Set(d.clubs??[])].map(normalized).sort().join('|'),
    (d.clubs??[]).includes('Other')?d.otherClub:'',
  ].map(normalized));
}
