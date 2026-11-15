import type {
  AlcoholMode,
  Cents,
  Contacts,
  PricedRiskClass,
  ProgramRules,
  ProvinceCode,
  RiskClass,
  Theme,
} from '../apps/api/src/domain/types.js';
import { STANDARD_QUESTIONS } from '../apps/api/src/modules/questions/index.js';
import { CATALOGUE, PRODUCTS, type ProductCode } from './catalogue.js';
import { createRng } from './prng.js';

export interface SeedData {
  brokers: { id: string; name: string; email: string }[];
  programs: {
    id: string;
    code: string;
    name: string;
    province: ProvinceCode;
    brokerId: string;
    loadingBps: number;
    commissionBps: number;
    feeCents: Cents;
    theme: Theme;
    contacts: Contacts;
  }[];
  venues: {
    id: string;
    programId: string;
    name: string;
    municipality: string;
    contactEmail: string;
  }[];
  rentals: { programId: string; ref: string; venueId: string }[];
  products: { id: string; code: ProductCode; name: string; maxHours: number }[];
  activities: {
    id: string;
    productId: string;
    title: string;
    riskClass: RiskClass;
    aliases: string[];
    searchText: string;
  }[];
  rateRows: {
    id: string;
    productId: string;
    riskClass: PricedRiskClass;
    limitCents: Cents;
    alcohol: AlcoholMode;
    participantsMin: number;
    participantsMax: number;
    netCentsPerHour: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
  programRules: {
    id: string;
    programId: string;
    version: number;
    effectiveFrom: string;
    rules: ProgramRules;
  }[];
  sanctions: { id: string; name: string; listName: string }[];
}

const BROKERS = [
  { name: 'Northgate Brokerage', email: 'placements@northgate-brokerage.example' },
  { name: 'Harbourline Insurance Group', email: 'placements@harbourline.example' },
  { name: 'Maple and Finch Risk', email: 'placements@maplefinch.example' },
];

const PROGRAMS = [
  {
    code: 'FHV',
    look: {
      brand: '#0b6b80',
      tagline: 'Arenas, halls and parks of the Town of Fairhaven',
      welcome:
        'Renting the arena, a community centre or the pavilion? Cover for your event takes a few minutes.',
      supportEmail: 'cover@fairhaven.example',
      supportPhone: '+1 613 555 0142',
      hours: 'Weekdays 8:30 to 4:30, Eastern',
    },
    name: 'Fairhaven Municipal Facilities',
    municipality: 'Fairhaven',
    province: 'ON',
    loadingBps: 4500,
    commissionBps: 1500,
    feeCents: 350,
    venues: [
      'Fairhaven Arena',
      'Fairhaven Community Centre',
      'Lakeside Pavilion',
      'Elm Street Library Hall',
    ],
    rules: {
      autoConfidenceMin: 0.8,
      autoMaxClass: 'B',
      maxParticipantsAuto: 300,
      alcoholAuto: true,
      excludedActivityIds: [],
      limitsCents: [200_000_000, 500_000_000],
      questions: STANDARD_QUESTIONS,
    },
  },
  {
    code: 'RVT',
    look: {
      brand: '#6b2d86',
      tagline: 'School gyms and halls after hours',
      welcome:
        'Booking a school space for a team, a club or a celebration? Insure it here before the day.',
      supportEmail: 'cover@riverton.example',
      supportPhone: '+1 403 555 0187',
      hours: 'School days 9 to 4, Mountain',
    },
    name: 'Riverton School Board',
    municipality: 'Riverton',
    province: 'AB',
    loadingBps: 4200,
    commissionBps: 1200,
    feeCents: 300,
    venues: [
      'Riverton High Gym',
      'Westbrook Elementary Hall',
      'Riverton Arts Centre',
      'North Field Fieldhouse',
    ],
    rules: {
      autoConfidenceMin: 0.85,
      autoMaxClass: 'B',
      maxParticipantsAuto: 200,
      alcoholAuto: false,
      excludedActivityIds: [],
      limitsCents: [200_000_000],
      questions: STANDARD_QUESTIONS,
    },
  },
  {
    code: 'SAB',
    look: {
      brand: '#a3231a',
      tagline: 'Salles communautaires · community halls',
      welcome: 'Bienvenue. The halls by the park, the arena and the lake are all insured here.',
      supportEmail: 'cover@saint-aubin.example',
      supportPhone: '+1 819 555 0123',
      hours: 'Lundi au vendredi, 9 h à 17 h',
    },
    name: 'Saint-Aubin Community Halls',
    municipality: 'Saint-Aubin',
    province: 'QC',
    loadingBps: 4800,
    commissionBps: 1800,
    feeCents: 400,
    venues: [
      'Salle Saint-Aubin',
      'Centre Culturel du Parc',
      'Aréna Municipal',
      'Salle des Fêtes du Lac',
    ],
    rules: {
      autoConfidenceMin: 0.8,
      autoMaxClass: 'C',
      maxParticipantsAuto: 500,
      alcoholAuto: true,
      excludedActivityIds: [],
      limitsCents: [200_000_000, 500_000_000],
      questions: STANDARD_QUESTIONS,
    },
  },
] as const;

// A monogram in the program's colour, as the data URL a client would upload: invented, like every name here.
function monogram(code: string, brand: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${brand}"/><text x="32" y="41" fill="#ffffff" font-family="Georgia, serif" font-size="24" font-weight="700" text-anchor="middle">${code.slice(0, 2)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Net cents per hour = product base x class x limit x alcohol x participants band (see data/README.md).
const BASE_CENTS_PER_HOUR: Record<ProductCode, number> = {
  room_rental: 1300,
  vendor_single: 900,
  vendor_blanket: 2100,
  sports_event: 1100,
  sports_league: 700,
  sports_camp: 1500,
  instructor: 600,
  parade: 2600,
};
const CLASS_FACTOR: Record<PricedRiskClass, number> = { A: 1, B: 1.6, C: 2.6 };
const LIMITS: readonly { cents: Cents; factor: number }[] = [
  { cents: 200_000_000, factor: 1 },
  { cents: 500_000_000, factor: 1.45 },
];
const ALCOHOL_FACTOR: Record<AlcoholMode, number> = { none: 1, served: 1.35, sold: 1.7 };
const BANDS: readonly [min: number, max: number, factor: number][] = [
  [1, 25, 1],
  [26, 50, 1],
  [51, 75, 1.9],
  [76, 100, 2.3],
  [101, 150, 3.1],
  [151, 200, 3.9],
  [201, 300, 5.2],
  [301, 500, 7.5],
];
// The previous version is 4% cheaper, so quotes for earlier event dates differ from current ones.
const VERSIONS = [
  { factor: 0.96, from: '2025-03-01', to: '2026-03-01' },
  { factor: 1, from: '2026-03-01', to: null },
] as const;

const NAME_PARTS = [
  'Zor',
  'Vath',
  'Quil',
  'Lan',
  'Marsh',
  'Bel',
  'Trane',
  'Kov',
  'Ard',
  'Nyx',
  'Orm',
  'Sel',
];
const NAME_SUFFIXES = ['Industries', 'Trading Ltd', 'Holdings', 'Ventures', 'Logistics', 'Group'];

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export function generate(seed: number): SeedData {
  const rng = createRng(seed);

  const products = PRODUCTS.map((p) => ({ id: `prd_${p.code}`, ...p }));
  const productId = (code: ProductCode) => `prd_${code}`;

  const activities: SeedData['activities'] = [];
  for (const product of PRODUCTS) {
    for (const [title, riskClass, aliases = []] of CATALOGUE[product.code]) {
      activities.push({
        id: `act_${pad(activities.length + 1, 4)}`,
        productId: productId(product.code),
        title,
        riskClass,
        aliases: [...aliases],
        searchText: [title, ...aliases].join(' | '),
      });
    }
  }

  const rateRows: SeedData['rateRows'] = [];
  for (const product of PRODUCTS) {
    const base = BASE_CENTS_PER_HOUR[product.code] * (0.95 + 0.1 * rng());
    for (const version of VERSIONS) {
      for (const riskClass of ['A', 'B', 'C'] as const) {
        for (const limit of LIMITS) {
          for (const alcohol of ['none', 'served', 'sold'] as const) {
            for (const [min, max, bandFactor] of BANDS) {
              const cents =
                base *
                version.factor *
                CLASS_FACTOR[riskClass] *
                limit.factor *
                ALCOHOL_FACTOR[alcohol] *
                bandFactor;
              rateRows.push({
                id: `rate_${pad(rateRows.length + 1, 5)}`,
                productId: productId(product.code),
                riskClass,
                limitCents: limit.cents,
                alcohol,
                participantsMin: min,
                participantsMax: max,
                netCentsPerHour: Math.max(1, Math.round(cents)),
                effectiveFrom: version.from,
                effectiveTo: version.to,
              });
            }
          }
        }
      }
    }
  }

  const sanctions: SeedData['sanctions'] = [];
  const used = new Set<string>();
  while (sanctions.length < 40) {
    const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)] as T;
    const name = `${pick(NAME_PARTS)}${pick(NAME_PARTS).toLowerCase()} ${pick(NAME_SUFFIXES)}`;
    if (used.has(name)) continue;
    used.add(name);
    sanctions.push({
      id: `sanc_${pad(sanctions.length + 1, 3)}`,
      name,
      listName: 'synthetic-list',
    });
  }

  return {
    brokers: BROKERS.map((b, i) => ({ id: `brk_${i + 1}`, name: b.name, email: b.email })),
    programs: PROGRAMS.map((p, i) => ({
      id: `prg_${i + 1}`,
      code: p.code,
      name: p.name,
      province: p.province,
      brokerId: `brk_${i + 1}`,
      loadingBps: p.loadingBps,
      commissionBps: p.commissionBps,
      feeCents: p.feeCents,
      theme: {
        brand: p.look.brand,
        logo: monogram(p.code, p.look.brand),
        tagline: p.look.tagline,
        welcome: p.look.welcome,
      },
      contacts: {
        supportEmail: p.look.supportEmail,
        supportPhone: p.look.supportPhone,
        telegram: null,
        hours: p.look.hours,
      },
    })),
    venues: PROGRAMS.flatMap((p, i) =>
      p.venues.map((name, j) => ({
        id: `ven_${i + 1}${j + 1}`,
        programId: `prg_${i + 1}`,
        name,
        municipality: p.municipality,
        contactEmail: `bookings.${i + 1}${j + 1}@venues.example`,
      })),
    ),
    // Six rentals per venue, numbered per program the way a venue's booking system would hand them out.
    rentals: PROGRAMS.flatMap((p, i) =>
      p.venues.flatMap((_, j) =>
        Array.from({ length: 6 }, (__, k) => ({
          programId: `prg_${i + 1}`,
          ref: `R-${1001 + j * 6 + k}`,
          venueId: `ven_${i + 1}${j + 1}`,
        })),
      ),
    ),
    products,
    activities,
    rateRows,
    programRules: PROGRAMS.map((p, i) => ({
      id: `rul_${i + 1}_1`,
      programId: `prg_${i + 1}`,
      version: 1,
      effectiveFrom: '2026-03-01',
      rules: {
        ...p.rules,
        autoMaxClass: p.rules.autoMaxClass,
        excludedActivityIds: [...p.rules.excludedActivityIds],
        limitsCents: [...p.rules.limitsCents],
      },
    })),
    sanctions,
  };
}
