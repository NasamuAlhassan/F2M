import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { RubricDoc, ClockConfig } from '../domain/types';
import { db } from './client';
import { buyers, commodities, regions, rubrics, units } from './schema';

// Approximate region centroids — distance fallback when a farmer has no GPS fix.
const REGION_SEED: Array<{ code: string; lat: number; lng: number }> = [
  { code: 'AHAFO', lat: 6.92, lng: -2.53 },
  { code: 'ASHANTI', lat: 6.75, lng: -1.52 },
  { code: 'BONO', lat: 7.34, lng: -2.33 },
  { code: 'BONO_EAST', lat: 7.58, lng: -1.93 },
  { code: 'CENTRAL', lat: 5.4, lng: -1.0 },
  { code: 'EASTERN', lat: 6.16, lng: -0.45 },
  { code: 'GREATER_ACCRA', lat: 5.65, lng: -0.19 },
  { code: 'NORTH_EAST', lat: 10.52, lng: -0.36 },
  { code: 'NORTHERN', lat: 9.4, lng: -0.84 },
  { code: 'OTI', lat: 7.9, lng: 0.3 },
  { code: 'SAVANNAH', lat: 9.08, lng: -1.82 },
  { code: 'UPPER_EAST', lat: 10.79, lng: -0.85 },
  { code: 'UPPER_WEST', lat: 10.06, lng: -2.5 },
  { code: 'VOLTA', lat: 6.61, lng: 0.47 },
  { code: 'WESTERN', lat: 4.94, lng: -1.76 },
  { code: 'WESTERN_NORTH', lat: 6.2, lng: -2.49 },
];

type CommoditySeed = {
  code: string;
  sortOrder: number; // menu position — most-traded first
  category: 'grain' | 'perishable' | 'tuber';
  clockType: 'storable' | 'perishable';
  clock: ClockConfig;
  units: Array<{ code: string; kgPerUnit: number; isInformal?: boolean }>;
  rubric: RubricDoc;
};

const band = (a: string, b: string, c: string, reject: string) => ({ A: a, B: b, C: c, REJECT: reject });

const COMMODITY_SEED: CommoditySeed[] = [
  {
    code: 'MAIZE',
    sortOrder: 10,
    category: 'grain',
    clockType: 'storable',
    clock: { offerTtlMinutes: 1440, distanceDecayKm: 300, allowsForward: true, maxWindowDays: 60 },
    units: [
      { code: 'BAG_50KG', kgPerUnit: 50 },
      { code: 'BAG_100KG', kgPerUnit: 100 },
      { code: 'OLONKA', kgPerUnit: 2.5, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'moisture',
          labelKey: 'rubric.maize.moisture',
          visualCues: 'wet sheen, swollen kernels, clumping, condensation inside the bag',
          bandDescriptors: band(
            'Kernels dry and free-flowing, no sheen or clumping',
            'Slight dullness or a few clumped kernels',
            'Noticeable clumping or swollen kernels',
            'Visibly wet, sprouting, or dripping grain',
          ),
        },
        {
          key: 'broken_kernels',
          labelKey: 'rubric.maize.broken_kernels',
          visualCues: 'split or fragmented kernels, exposed white endosperm',
          bandDescriptors: band(
            'Under about 2% broken kernels',
            'Roughly 2-5% broken kernels',
            'Roughly 5-10% broken kernels',
            'Over 10% broken or crushed kernels',
          ),
        },
        {
          key: 'foreign_matter',
          labelKey: 'rubric.maize.foreign_matter',
          visualCues: 'chaff, cob fragments, stones, sand, plant debris mixed in the grain',
          bandDescriptors: band(
            'Essentially clean grain',
            'Traces of chaff only',
            'Visible debris or stones',
            'Heavy contamination with soil, stones or debris',
          ),
        },
        {
          key: 'discoloration',
          labelKey: 'rubric.maize.discoloration',
          visualCues: 'yellow-brown staining, heat damage, insect frass on kernels',
          bandDescriptors: band(
            'Uniform kernel colour',
            'A few discoloured kernels',
            'Widespread discoloration',
            'Blackened or heat-damaged bulk',
          ),
        },
        {
          key: 'mould',
          labelKey: 'rubric.maize.mould',
          visualCues: 'white, green or black fuzz, caked clumps, musty-looking surfaces',
          bandDescriptors: band(
            'No visible mould',
            'Isolated specks on very few kernels',
            'Small mouldy patches present',
            'Widespread mould or caking',
          ),
        },
      ],
    },
  },
  {
    code: 'TOMATO',
    sortOrder: 20,
    category: 'perishable',
    clockType: 'perishable',
    clock: { offerTtlMinutes: 120, distanceDecayKm: 50, allowsForward: false, maxWindowDays: 2 },
    units: [
      { code: 'CRATE', kgPerUnit: 52 },
      { code: 'BASKET', kgPerUnit: 25, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'colour_ripeness',
          labelKey: 'rubric.tomato.colour_ripeness',
          visualCues: 'uniform red versus green shoulders versus dark overripe patches',
          bandDescriptors: band(
            'Uniform ripe red at firm stage',
            'Mostly ripe with minor unevenness',
            'Mixed ripeness or an overripe portion',
            'Predominantly overripe or green fruit',
          ),
        },
        {
          key: 'firmness',
          labelKey: 'rubric.tomato.firmness',
          visualCues: 'taut skin versus wrinkling, collapse, or leaking fruit',
          bandDescriptors: band(
            'Taut and firm fruit',
            'Slight give or wrinkling on some fruit',
            'Clearly soft fruit visible',
            'Collapsed or leaking fruit',
          ),
        },
        {
          key: 'bruising',
          labelKey: 'rubric.tomato.bruising',
          visualCues: 'flattened dark spots, cracked skin, pressure marks from stacking',
          bandDescriptors: band(
            'No visible bruising',
            'Minor pressure marks on a few fruit',
            'Bruising on many fruit',
            'Widespread crushing or cracked skins',
          ),
        },
        {
          key: 'rot',
          labelKey: 'rubric.tomato.rot',
          visualCues: 'grey or black lesions, white fungal rings, wet patches, flies',
          bandDescriptors: band(
            'No rot visible',
            'One or two suspect fruit',
            'Several rotting fruit',
            'Rot spreading through the crate',
          ),
        },
        {
          key: 'size_uniformity',
          labelKey: 'rubric.tomato.size_uniformity',
          visualCues: 'consistent fruit size versus a mix of tiny and large fruit',
          bandDescriptors: band(
            'Consistent fruit size',
            'Mostly consistent size',
            'Mixed sizes',
            'Extremely uneven with many undersized fruit',
          ),
        },
      ],
    },
  },
  {
    code: 'YAM',
    sortOrder: 30,
    category: 'tuber',
    clockType: 'storable',
    clock: { offerTtlMinutes: 720, distanceDecayKm: 200, allowsForward: true, maxWindowDays: 30 },
    units: [
      { code: 'TUBER', kgPerUnit: 2.5 },
      { code: 'HUNDRED', kgPerUnit: 250 },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'cuts_damage',
          labelKey: 'rubric.yam.cuts_damage',
          visualCues: 'machete cuts, gouges, broken tips, exposed white flesh',
          bandDescriptors: band(
            'Clean intact tubers',
            'Minor skin nicks only',
            'Cut or gouged tubers present',
            'Deep cuts or broken tubers widespread',
          ),
        },
        {
          key: 'sprouting',
          labelKey: 'rubric.yam.sprouting',
          visualCues: 'sprout shoots at the head, bud swelling',
          bandDescriptors: band(
            'No sprouting',
            'Bud swelling only',
            'Short sprouts on some tubers',
            'Long sprouts widespread',
          ),
        },
        {
          key: 'rot',
          labelKey: 'rubric.yam.rot',
          visualCues: 'soft dark patches, wet decay, mouldy ends',
          bandDescriptors: band(
            'No rot visible',
            'Small dry surface blemish',
            'Soft patches on some tubers',
            'Wet rot present',
          ),
        },
        {
          key: 'shrivel',
          labelKey: 'rubric.yam.shrivel',
          visualCues: 'wrinkled skin, dry fibrous appearance, weight loss',
          bandDescriptors: band(
            'Plump fresh tubers',
            'Slight wrinkling',
            'Noticeable shrivel',
            'Severely dehydrated tubers',
          ),
        },
      ],
    },
  },
];

// Wave 2 (M9): adding a commodity means writing a rubric, not rewriting the platform.
COMMODITY_SEED.push(
  {
    code: 'RICE',
    sortOrder: 40,
    category: 'grain',
    clockType: 'storable',
    clock: { offerTtlMinutes: 1440, distanceDecayKm: 300, allowsForward: true, maxWindowDays: 60 },
    units: [
      { code: 'BAG_50KG', kgPerUnit: 50 },
      { code: 'BAG_25KG', kgPerUnit: 25 },
      { code: 'OLONKA', kgPerUnit: 2.2, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'moisture',
          labelKey: 'rubric.rice.moisture',
          visualCues: 'clumping paddy or milled grains, dull wet sheen, condensation in the bag',
          bandDescriptors: band(
            'Dry free-flowing grain',
            'Slight dullness, no clumping',
            'Some clumped patches',
            'Visibly wet or caked grain',
          ),
        },
        {
          key: 'broken_grains',
          labelKey: 'rubric.rice.broken_grains',
          visualCues: 'fragmented kernels, chalky broken ends among whole grains',
          bandDescriptors: band(
            'Under about 5% brokens',
            'Roughly 5-15% brokens',
            'Roughly 15-30% brokens',
            'Mostly broken or crushed grain',
          ),
        },
        {
          key: 'foreign_matter',
          labelKey: 'rubric.rice.foreign_matter',
          visualCues: 'husk, stones, sand, paddy mixed into milled rice',
          bandDescriptors: band('Essentially clean', 'Traces of husk', 'Visible stones or husk', 'Heavy contamination'),
        },
        {
          key: 'discoloration',
          labelKey: 'rubric.rice.discoloration',
          visualCues: 'yellow, grey or heat-damaged kernels among white grain',
          bandDescriptors: band(
            'Uniform colour',
            'A few discoloured kernels',
            'Widespread discoloration',
            'Predominantly yellowed or damaged',
          ),
        },
        {
          key: 'mould',
          labelKey: 'rubric.rice.mould',
          visualCues: 'musty caking, dark fungal specks',
          bandDescriptors: band('No visible mould', 'Isolated specks', 'Small mouldy patches', 'Widespread mould'),
        },
      ],
    },
  },
  {
    code: 'GROUNDNUT',
    sortOrder: 50,
    category: 'grain',
    clockType: 'storable',
    clock: { offerTtlMinutes: 1440, distanceDecayKm: 300, allowsForward: true, maxWindowDays: 60 },
    units: [
      { code: 'BAG_50KG', kgPerUnit: 50 },
      { code: 'BOWL', kgPerUnit: 2.2, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'moisture',
          labelKey: 'rubric.groundnut.moisture',
          visualCues: 'soft rubbery kernels, damp shells, clumping',
          bandDescriptors: band('Dry hard kernels', 'Slightly soft few kernels', 'Noticeably damp', 'Wet or rubbery bulk'),
        },
        {
          key: 'shrivelled_kernels',
          labelKey: 'rubric.groundnut.shrivelled_kernels',
          visualCues: 'wrinkled undersized kernels among plump ones',
          bandDescriptors: band(
            'Plump uniform kernels',
            'Under ~10% shrivelled',
            'Roughly 10-25% shrivelled',
            'Mostly shrivelled or immature',
          ),
        },
        {
          key: 'foreign_matter',
          labelKey: 'rubric.groundnut.foreign_matter',
          visualCues: 'shell fragments, stones, soil mixed with kernels',
          bandDescriptors: band('Essentially clean', 'Traces of shell', 'Visible stones or soil', 'Heavy contamination'),
        },
        {
          key: 'mould',
          labelKey: 'rubric.groundnut.mould',
          visualCues: 'dark or greenish mould on kernels, damaged discoloured kernels — aflatoxin risk, grade strictly',
          bandDescriptors: band(
            'No mould or damage visible',
            'One or two suspect kernels',
            'Several mouldy or dark kernels',
            'Visible mould — reject for aflatoxin risk',
          ),
        },
      ],
    },
  },
  {
    code: 'PEPPER',
    sortOrder: 60,
    category: 'perishable',
    clockType: 'perishable',
    clock: { offerTtlMinutes: 120, distanceDecayKm: 50, allowsForward: false, maxWindowDays: 2 },
    units: [
      { code: 'SACK', kgPerUnit: 45 },
      { code: 'BASKET', kgPerUnit: 20, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'colour_ripeness',
          labelKey: 'rubric.pepper.colour_ripeness',
          visualCues: 'uniform red or green versus mixed dull patches',
          bandDescriptors: band(
            'Uniform vivid colour',
            'Mostly uniform, minor variation',
            'Mixed ripeness or dull patches',
            'Predominantly overripe or discoloured',
          ),
        },
        {
          key: 'firmness',
          labelKey: 'rubric.pepper.firmness',
          visualCues: 'taut glossy skin versus wrinkling and softness',
          bandDescriptors: band('Firm glossy pods', 'Slight wrinkling on some', 'Soft pods visible', 'Limp or collapsing pods'),
        },
        {
          key: 'rot',
          labelKey: 'rubric.pepper.rot',
          visualCues: 'dark wet lesions, white mould at the stem end',
          bandDescriptors: band('No rot visible', 'One or two suspect pods', 'Several rotting pods', 'Rot through the sack'),
        },
        {
          key: 'size_uniformity',
          labelKey: 'rubric.pepper.size_uniformity',
          visualCues: 'consistent pod size versus a mix of tiny and large',
          bandDescriptors: band('Consistent size', 'Mostly consistent', 'Mixed sizes', 'Extremely uneven'),
        },
      ],
    },
  },
  {
    code: 'ONION',
    sortOrder: 70,
    category: 'perishable',
    clockType: 'perishable',
    clock: { offerTtlMinutes: 720, distanceDecayKm: 100, allowsForward: false, maxWindowDays: 7 },
    units: [
      { code: 'BAG_50KG', kgPerUnit: 50 },
      { code: 'BASKET', kgPerUnit: 25, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'skin_cure',
          labelKey: 'rubric.onion.skin_cure',
          visualCues: 'dry papery outer skins versus stripped or moist bulbs',
          bandDescriptors: band(
            'Well-cured papery skins',
            'Mostly cured, some bare bulbs',
            'Many bare or moist bulbs',
            'Uncured wet bulbs',
          ),
        },
        {
          key: 'firmness',
          labelKey: 'rubric.onion.firmness',
          visualCues: 'hard bulbs versus soft necks and give under pressure',
          bandDescriptors: band('Hard tight bulbs', 'Slight give on a few', 'Soft bulbs present', 'Widespread soft bulbs'),
        },
        {
          key: 'sprouting',
          labelKey: 'rubric.onion.sprouting',
          visualCues: 'green shoots at the neck',
          bandDescriptors: band('No sprouting', 'Neck swelling only', 'Short sprouts on some', 'Green shoots widespread'),
        },
        {
          key: 'rot',
          labelKey: 'rubric.onion.rot',
          visualCues: 'wet dark basal rot, sour smell staining the bag',
          bandDescriptors: band('None visible', 'One or two suspect bulbs', 'Several rotting bulbs', 'Wet rot in the bag'),
        },
      ],
    },
  },
  {
    code: 'PLANTAIN',
    sortOrder: 80,
    category: 'perishable',
    clockType: 'perishable',
    clock: { offerTtlMinutes: 240, distanceDecayKm: 80, allowsForward: false, maxWindowDays: 3 },
    units: [{ code: 'BUNCH', kgPerUnit: 12 }],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'ripeness_stage',
          labelKey: 'rubric.plantain.ripeness_stage',
          visualCues: 'green through yellow to black-spotted fingers',
          bandDescriptors: band(
            'Green to light-turning, trade-ready',
            'Yellowing but firm',
            'Ripe with dark spotting',
            'Overripe blackened fingers',
          ),
        },
        {
          key: 'finger_fill',
          labelKey: 'rubric.plantain.finger_fill',
          visualCues: 'full rounded fingers versus thin angular ones',
          bandDescriptors: band('Full well-filled fingers', 'Mostly filled', 'Thin or angular fingers', 'Immature thin bunches'),
        },
        {
          key: 'bruising',
          labelKey: 'rubric.plantain.bruising',
          visualCues: 'dark pressure marks, split skins from transport',
          bandDescriptors: band('Clean unmarked fingers', 'Minor marks on a few', 'Bruising on many', 'Widespread splits and crushing'),
        },
        {
          key: 'rot',
          labelKey: 'rubric.plantain.rot',
          visualCues: 'soft wet patches, mould at the crown',
          bandDescriptors: band('None visible', 'One or two suspect fingers', 'Several rotting fingers', 'Crown rot spreading'),
        },
      ],
    },
  },
);

export const DEMO_BUYER = {
  email: 'buyer@demo.ftm',
  password: 'demo-buyer-2026',
  name: 'Adjoa Mensah',
  company: 'Accra Fresh Markets Ltd',
  momoMsisdn: '233555000123',
  regionCode: 'GREATER_ACCRA',
};

export async function seed(): Promise<void> {
  for (const r of REGION_SEED) {
    db.insert(regions)
      .values({ code: r.code, nameKey: `region.${r.code}`, lat: r.lat, lng: r.lng })
      .onConflictDoNothing()
      .run();
  }

  for (const c of COMMODITY_SEED) {
    db.insert(commodities)
      .values({
        code: c.code,
        nameKey: `commodity.${c.code}`,
        category: c.category,
        clockType: c.clockType,
        clockConfig: JSON.stringify(c.clock),
        activeRubricVersion: 1,
        sortOrder: c.sortOrder,
      })
      .onConflictDoUpdate({ target: commodities.code, set: { sortOrder: c.sortOrder } })
      .run();
    const commodity = db.select().from(commodities).where(eq(commodities.code, c.code)).get();
    if (!commodity) throw new Error(`seed: commodity ${c.code} missing after insert`);

    for (const u of c.units) {
      db.insert(units)
        .values({
          commodityId: commodity.id,
          code: u.code,
          nameKey: `unit.${u.code}`,
          kgPerUnit: u.kgPerUnit,
          isInformal: u.isInformal ?? false,
        })
        .onConflictDoNothing()
        .run();
    }

    db.insert(rubrics)
      .values({ commodityId: commodity.id, version: 1, doc: JSON.stringify(c.rubric) })
      .onConflictDoNothing()
      .run();
  }

  const existingBuyer = db.select().from(buyers).where(eq(buyers.email, DEMO_BUYER.email)).get();
  if (!existingBuyer) {
    db.insert(buyers)
      .values({
        email: DEMO_BUYER.email,
        passwordHash: bcrypt.hashSync(DEMO_BUYER.password, 10),
        name: DEMO_BUYER.name,
        company: DEMO_BUYER.company,
        momoMsisdn: DEMO_BUYER.momoMsisdn,
        regionCode: DEMO_BUYER.regionCode,
      })
      .run();
  }

  console.log(`Seed complete. Demo buyer login: ${DEMO_BUYER.email} / ${DEMO_BUYER.password}`);
}
