export const ACTIVITY_STICK_AND_PUCK = 'stick-and-puck';
export const ACTIVITY_DROP_IN_HOCKEY = 'drop-in-hockey';
export const ACTIVITY_PUBLIC_SKATE = 'public-skate';

export const SUPPORTED_ACTIVITIES = Object.freeze([
  ACTIVITY_STICK_AND_PUCK,
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
]);

export const DAYSMART_DROP_IN_LABELS = Object.freeze({
  kraken: Object.freeze([
    'Drop-In',
    'Novice Drop-In',
  ]),
  snoking: Object.freeze([
    "MH's Chill Drop-In",
    'Adult (18+) Lunch Hockey',
    "Women's Drop-In",
    'Adult Weekend Drop-In',
    'SKAHL Beginner Drop-In',
    'Adult Learn to Play 3v3 Drop-In',
  ]),
});

export const DAYSMART_EXCLUDED_DROP_IN_LABELS = Object.freeze({
  kraken: Object.freeze([
    'Adult Morning Skills Goalie Drop-in',
  ]),
  snoking: Object.freeze([
    'Ritchie / Huscroft Drop-In (Invite Only)',
    "Rocco's Drop-In (Invite Only)",
    'Leung Summer Drop-In (Invite Only)',
  ]),
});

export const RECTIMES_DROP_IN_LABELS = Object.freeze({
  1145: Object.freeze(['OVA Lunch Hockey']),
  1146: Object.freeze(['Adult Drop in']),
});

export const EVERETT_DROP_IN_LABELS = Object.freeze([
  'Drop in - Pay At Desk',
  'Drop in - Pay At Desk (LR 1 & 3)',
  'Drop in - Pay At Desk LR 2 & 4',
  'Drop in - Pay At Desk (LR 2 & 4)',
]);

export function activitySet(activities) {
  const requested = activities ?? [ACTIVITY_STICK_AND_PUCK];
  if (typeof requested === 'string') return new Set([requested]);
  return requested instanceof Set ? requested : new Set(requested);
}

export function classifyDaySmartActivity({ company, leagueName, eventText, sourceActivity }) {
  if (sourceActivity === ACTIVITY_PUBLIC_SKATE) {
    return ACTIVITY_PUBLIC_SKATE;
  }
  if (DAYSMART_EXCLUDED_DROP_IN_LABELS[company]?.includes(leagueName)) {
    return null;
  }
  if (DAYSMART_DROP_IN_LABELS[company]?.includes(leagueName)) {
    return ACTIVITY_DROP_IN_HOCKEY;
  }

  const text = plainText(eventText).toLowerCase();
  if (text.includes('learn to play')) return null;
  if (
    text.includes('stick') ||
    text.includes('s&p') ||
    text.includes('s & p') ||
    text.includes('full hockey gear')
  ) {
    return ACTIVITY_STICK_AND_PUCK;
  }
  return null;
}

export function classifyRecTimesActivity(venueId, groupName) {
  if (RECTIMES_DROP_IN_LABELS[venueId]?.includes(groupName)) {
    return ACTIVITY_DROP_IN_HOCKEY;
  }
  return /stick\s*(?:&|and)\s*puck/i.test(groupName ?? '')
    ? ACTIVITY_STICK_AND_PUCK
    : null;
}

export function classifyEverettActivity(title) {
  if (EVERETT_DROP_IN_LABELS.includes(title)) return ACTIVITY_DROP_IN_HOCKEY;
  return /stick\s*(?:&|and)\s*puck/i.test(title ?? '')
    ? ACTIVITY_STICK_AND_PUCK
    : null;
}

export function daySmartDropInDetails(company, leagueName) {
  const key = `${company}:${leagueName}`;
  return {
    'kraken:Drop-In': {
      subtitle: 'Adult 18+',
      eligibility: eligibility({ ageMin: 18, audience: 'adult' }),
    },
    'kraken:Novice Drop-In': {
      subtitle: 'Adult 18+ · Beginner · Division 6 or lower',
      eligibility: eligibility({
        ageMin: 18,
        audience: 'adult',
        skill: 'Beginner; Division 6 or lower',
      }),
    },
    "snoking:MH's Chill Drop-In": {
      subtitle: 'Adult coed · All skill levels',
      eligibility: eligibility({ ageMin: 18, audience: 'adult', skill: 'All skill levels' }),
    },
    'snoking:Adult (18+) Lunch Hockey': {
      subtitle: 'Adult 18+',
      eligibility: eligibility({ ageMin: 18, audience: 'adult' }),
    },
    "snoking:Women's Drop-In": {
      subtitle: 'Women · Adult · All skill levels',
      eligibility: eligibility({ ageMin: 18, audience: 'women', skill: 'All skill levels' }),
    },
    'snoking:Adult Weekend Drop-In': {
      subtitle: 'Adult 18+',
      eligibility: eligibility({ ageMin: 18, audience: 'adult' }),
    },
    'snoking:SKAHL Beginner Drop-In': {
      subtitle: 'Adult 18+ · Beginner',
      eligibility: eligibility({ ageMin: 18, audience: 'adult', skill: 'Beginner' }),
    },
    'snoking:Adult Learn to Play 3v3 Drop-In': {
      subtitle: 'Adult 18+ · New and beginning players · 3v3',
      eligibility: eligibility({
        ageMin: 18,
        audience: 'adult',
        skill: 'New and beginning players',
        notes: '3v3',
      }),
    },
  }[key] ?? { subtitle: null, eligibility: eligibility() };
}

export function eligibility(overrides = {}) {
  return {
    ageMin: null,
    ageMax: null,
    audience: null,
    skill: null,
    notes: null,
    ...overrides,
  };
}

function plainText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
