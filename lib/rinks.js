// Single source of truth for rink configuration.
// Imported by the scheduler Worker and referenced by the client via /lib/rinks.js.
// When adding a new rink, add it here — no other files need updating.

export const RINKS = {
  kci: {
    name: "Kraken Community Iceplex",
    city: "Seattle",
    url: "https://www.krakencommunityiceplex.com/stick-puck/",
    color: "#9A7B00",
    system: "daysmart",
    config: { company: "kraken", sportId: 20 },
  },
  snokingRenton: {
    name: "Sno-King Ice Arena",
    city: "Renton",
    url: "https://www.snokingicearenas.com/",
    color: "#CC2200",
    system: "daysmart",
    config: { company: "snoking", sportId: 20, resourceIds: [11, 12] },
  },
  snokingKirkland: {
    name: "Sno-King Ice Arena",
    city: "Kirkland",
    url: "https://www.snokingicearenas.com/",
    color: "#E83318",
    system: "daysmart",
    config: { company: "snoking", sportId: 20, resourceIds: [1] },
  },
  snokingSnoqualmie: {
    name: "Sno-King Ice Arena",
    city: "Snoqualmie",
    url: "https://www.snokingicearenas.com/",
    color: "#FF6644",
    system: "daysmart",
    config: { company: "snoking", sportId: 20, resourceIds: [13, 14] },
  },
  olympicview: {
    name: "Olympic View Arena",
    city: "Mountlake Terrace",
    url: "https://www.olympicviewarena.com/",
    color: "#44BBAA",
    system: "rectimes",
    config: { venueId: 1145 },
  },
  lynnwood: {
    name: "Lynnwood Ice Center",
    city: "Lynnwood",
    url: "https://www.lynnwoodicecenter.com/",
    color: "#1565A8",
    system: "rectimes",
    config: { venueId: 1146 },
  },
  everett: {
    name: "Everett Community Ice Rink",
    city: "Everett",
    url: "https://aotw-arena.web.app/",
    color: "#2E7D4F",
    system: "everett",
    config: {},
  },
  kentValley: {
    name: "Kent Valley Ice Centre",
    city: "Kent",
    url: "https://kentvalleyicecentre.net/",
    color: "#8B44CC",
    system: "ical",
    config: {},
  },
};
