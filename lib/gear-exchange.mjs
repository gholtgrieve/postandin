// Shared by future posting/browse clients and server validation.
// Public listing fields only; this module does not authorize or publish records.
export const CATEGORIES = Object.freeze([
  'Skates', 'Sticks', 'Protective gear', 'Goalie gear', 'Apparel',
  'Bags & accessories', 'Bundles',
]);
export const SIZES = Object.freeze([
  'Youth', 'Junior', 'Intermediate', 'Senior', 'One size', 'Mixed sizes',
]);
export const CONDITIONS = Object.freeze([
  'New / unused', 'Used — excellent', 'Used — good', 'Used — fair',
]);
export const REPORT_REASONS = Object.freeze(['Misleading listing', 'Spam or suspicious activity', 'Prohibited item', 'Other concern']);
export const LISTING_TYPES = Object.freeze(['sale', 'trade', 'free']);
export const CLUBS = Object.freeze([
  'Seattle Junior', 'Sno-King', 'Jr. Kraken', 'Everett', 'Star Academy',
  'Kent Valley', 'Tacoma Rockets', 'Redhawks', 'Other',
]);
// Advance this identifier whenever the seller-facing adult acknowledgement or
// the disclosures it covers materially change. Store the value with the draft;
// never infer acknowledgement from a seller account or a later form version.
export const ADULT_ACKNOWLEDGEMENT_VERSION = 'gear-adult-v1';
export const LIMITS = Object.freeze({
  minPriceCents: 100, maxPriceCents: 500000,
  // Publication triggers in migrations 0002/0004 repeat active count and duration.
  photos: 6, activeListings: 10, durationDays: 30,
  title: 100, description: 3000, city: 60, fit: 160, otherClub: 80, trade: 180, name: 60, email: 254, message: 2000,
});

export const normalize = value => String(value ?? '').normalize('NFKC')
  .trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');

// Keep the Other marker for filtering, but display/search the supplied name.
export function clubNames(listing) {
  return (listing.clubs ?? []).flatMap(club => club === 'Other'
    ? (listing.otherClub?.trim() ? [listing.otherClub.trim()] : []) : [club]);
}

// Callers must supply only publicly visible records. Expiry/authorization are
// enforced by the server, never by this convenience filter.
export function matchesListing(listing, filters = {}) {
  for (const field of ['category', 'size', 'type']) {
    if (filters[field] && listing[field] !== filters[field]) return false;
  }
  if (filters.city && normalize(listing.city) !== normalize(filters.city)) return false;
  if (filters.club && !(listing.clubs ?? []).includes(filters.club)) return false;
  if (filters.maxPrice !== undefined && filters.maxPrice !== '') {
    const ceiling = Number(filters.maxPrice);
    if (!Number.isFinite(ceiling) || ceiling < 0) return false;
    // Trade has no comparable asking price; Free is zero.
    const price = listing.type === 'free' ? 0
      : listing.type === 'sale' ? listing.priceCents / 100 : NaN;
    if (!Number.isFinite(price) || price > ceiling) return false;
  }
  const text = normalize([
    listing.title, listing.description, listing.category, listing.size,
    listing.fit, listing.condition, listing.city, listing.type === 'trade' ? listing.trade : '',
    ...clubNames(listing),
  ].join(' '));
  return normalize(filters.q).split(' ').filter(Boolean)
    .every(word => text.includes(word));
}

// Normalize offer-specific fields before storing a draft.
export function offerFields(type, dollars, trade) {
  return { priceCents: type === 'sale' ? Math.round(Number(dollars) * 100)
    : type === 'free' ? 0 : null, trade: type === 'trade' ? trade.trim() : '' };
}
export function formatPrice(type, cents) {
  return type === 'sale' ? new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
  }).format(cents / 100) : type === 'trade' ? 'Trade' : 'Free';
}
