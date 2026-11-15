import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { RubricDoc, ClockConfig } from '../domain/types';
import { loadRegistries } from '../domain/registries';
import { db } from './client';
import { commodities, marketPrices, priceObservations, regions, rubrics, units, vehicleClasses } from './schema';

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

// Phase 1 (D-051): the northern grains and legumes, and cassava — the crops the
// owner's farmers grow beside the first eight. Bag sizes are the trade's own:
// a "maxi bag" of grain or beans is about 100kg; fresh cassava goes by the sack.
const grainClock: ClockConfig = { offerTtlMinutes: 1440, distanceDecayKm: 300, allowsForward: true, maxWindowDays: 60 };

COMMODITY_SEED.push(
  {
    code: 'CASSAVA',
    sortOrder: 90,
    category: 'tuber',
    // Fresh roots spoil within two or three days of lifting (blue-black streaking),
    // so cassava trades like a perishable, unlike yam.
    clockType: 'perishable',
    clock: { offerTtlMinutes: 240, distanceDecayKm: 80, allowsForward: false, maxWindowDays: 2 },
    units: [{ code: 'SACK', kgPerUnit: 90 }],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'streaking',
          labelKey: 'rubric.cassava.streaking',
          visualCues: 'blue-black or brown streaks in cut flesh, dark ring under the peel — roots lifted too long ago',
          bandDescriptors: band(
            'White flesh, no streaks — freshly lifted',
            'Faint streaking at the cut ends only',
            'Streaks spreading into the flesh',
            'Flesh dark throughout',
          ),
        },
        {
          key: 'cuts_damage',
          labelKey: 'rubric.cassava.cuts_damage',
          visualCues: 'broken roots, machete cuts, peel stripped off',
          bandDescriptors: band('Whole roots, peel intact', 'Minor nicks or peeled patches', 'Many broken or cut roots', 'Mostly broken pieces'),
        },
        {
          key: 'rot',
          labelKey: 'rubric.cassava.rot',
          visualCues: 'soft wet patches, sour smell, mould at the ends',
          bandDescriptors: band('No rot visible', 'One or two suspect roots', 'Several rotting roots', 'Rot through the sack'),
        },
        {
          key: 'size_uniformity',
          labelKey: 'rubric.cassava.size_uniformity',
          visualCues: 'consistent root size versus thin woody roots mixed in',
          bandDescriptors: band('Consistent well-filled roots', 'Mostly consistent', 'Mixed sizes', 'Mostly thin or woody roots'),
        },
      ],
    },
  },
  {
    code: 'MILLET',
    sortOrder: 100,
    category: 'grain',
    clockType: 'storable',
    clock: grainClock,
    units: [
      { code: 'BAG_100KG', kgPerUnit: 100 },
      { code: 'BAG_50KG', kgPerUnit: 50 },
      { code: 'OLONKA', kgPerUnit: 2.5, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'moisture',
          labelKey: 'rubric.millet.moisture',
          visualCues: 'clumping grain, dull damp look, condensation in the bag',
          bandDescriptors: band('Dry free-flowing grain', 'Slight dullness, no clumping', 'Some clumped patches', 'Visibly wet or caked grain'),
        },
        {
          key: 'foreign_matter',
          labelKey: 'rubric.millet.foreign_matter',
          visualCues: 'chaff, stones, sand and plant debris among the small grains',
          bandDescriptors: band('Essentially clean', 'Traces of chaff', 'Visible sand or stones', 'Heavy contamination'),
        },
        {
          key: 'shrivelled_grains',
          labelKey: 'rubric.millet.shrivelled_grains',
          visualCues: 'small empty or shrivelled grains among plump ones',
          bandDescriptors: band('Plump uniform grain', 'A few shrivelled grains', 'Many shrivelled grains', 'Mostly empty or immature'),
        },
        {
          key: 'insect_damage',
          labelKey: 'rubric.millet.insect_damage',
          visualCues: 'bored grains, live insects, powdery dust',
          bandDescriptors: band('No insect damage', 'Isolated bored grains', 'Visible insects or dust', 'Heavy infestation'),
        },
        {
          key: 'mould',
          labelKey: 'rubric.millet.mould',
          visualCues: 'musty caking, dark or pink fungal growth',
          bandDescriptors: band('No visible mould', 'Isolated specks', 'Small mouldy patches', 'Widespread mould'),
        },
      ],
    },
  },
  {
    code: 'SORGHUM',
    sortOrder: 110,
    category: 'grain',
    clockType: 'storable',
    clock: grainClock,
    units: [
      { code: 'BAG_100KG', kgPerUnit: 100 },
      { code: 'BAG_50KG', kgPerUnit: 50 },
      { code: 'OLONKA', kgPerUnit: 2.5, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'moisture',
          labelKey: 'rubric.sorghum.moisture',
          visualCues: 'clumping grain, swollen kernels, condensation in the bag',
          bandDescriptors: band('Dry free-flowing grain', 'Slight dullness, no clumping', 'Some clumped patches', 'Visibly wet or sprouting grain'),
        },
        {
          key: 'broken_grains',
          labelKey: 'rubric.sorghum.broken_grains',
          visualCues: 'split or crushed kernels, exposed white starch',
          bandDescriptors: band('Under about 3% broken', 'Roughly 3-8% broken', 'Roughly 8-15% broken', 'Mostly broken or crushed'),
        },
        {
          key: 'foreign_matter',
          labelKey: 'rubric.sorghum.foreign_matter',
          visualCues: 'glumes, stalk pieces, stones and sand',
          bandDescriptors: band('Essentially clean', 'Traces of chaff', 'Visible debris or stones', 'Heavy contamination'),
        },
        {
          key: 'mould',
          labelKey: 'rubric.sorghum.mould',
          visualCues: 'grain mould: pink, grey or black discoloured kernels, caking — grade strictly',
          bandDescriptors: band('No visible mould', 'A few discoloured kernels', 'Mouldy kernels throughout', 'Widespread mould or caking'),
        },
        {
          key: 'insect_damage',
          labelKey: 'rubric.sorghum.insect_damage',
          visualCues: 'bored kernels, live weevils, powdery dust',
          bandDescriptors: band('No insect damage', 'Isolated bored kernels', 'Visible insects or dust', 'Heavy infestation'),
        },
      ],
    },
  },
  {
    code: 'SOYBEAN',
    sortOrder: 120,
    category: 'grain',
    clockType: 'storable',
    clock: grainClock,
    units: [
      { code: 'BAG_100KG', kgPerUnit: 100 },
      { code: 'BAG_50KG', kgPerUnit: 50 },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'moisture',
          labelKey: 'rubric.soybean.moisture',
          visualCues: 'soft wrinkled beans, damp clumping, condensation in the bag',
          bandDescriptors: band('Dry hard beans', 'A few soft beans', 'Noticeably damp', 'Wet or swollen beans'),
        },
        {
          key: 'split_beans',
          labelKey: 'rubric.soybean.split_beans',
          visualCues: 'halved beans and loose seed coats among whole beans',
          bandDescriptors: band('Under about 5% split', 'Roughly 5-10% split', 'Roughly 10-20% split', 'Mostly split or crushed'),
        },
        {
          key: 'foreign_matter',
          labelKey: 'rubric.soybean.foreign_matter',
          visualCues: 'pod pieces, stalks, stones and soil',
          bandDescriptors: band('Essentially clean', 'Traces of pod or stalk', 'Visible stones or soil', 'Heavy contamination'),
        },
        {
          key: 'discoloration',
          labelKey: 'rubric.soybean.discoloration',
          visualCues: 'green immature beans, purple or brown stained seed coats',
          bandDescriptors: band('Uniform pale yellow', 'A few green or stained beans', 'Many discoloured beans', 'Predominantly green or stained'),
        },
        {
          key: 'mould',
          labelKey: 'rubric.soybean.mould',
          visualCues: 'white or grey fungal growth, musty caking',
          bandDescriptors: band('No visible mould', 'Isolated specks', 'Small mouldy patches', 'Widespread mould'),
        },
      ],
    },
  },
  {
    code: 'COWPEA',
    sortOrder: 130,
    category: 'grain',
    clockType: 'storable',
    clock: grainClock,
    units: [
      { code: 'BAG_100KG', kgPerUnit: 100 },
      { code: 'BAG_50KG', kgPerUnit: 50 },
      { code: 'OLONKA', kgPerUnit: 2.5, isInformal: true },
    ],
    rubric: {
      gradeBands: ['A', 'B', 'C', 'REJECT'],
      aggregation: 'worst_criterion',
      criteria: [
        {
          key: 'insect_damage',
          labelKey: 'rubric.cowpea.insect_damage',
          visualCues: 'round exit holes from weevils (bruchids), eggs on the seed coat, powdery dust — the main loss in stored beans',
          bandDescriptors: band('No holes or eggs', 'A few holed beans', 'Many holed beans or live weevils', 'Heavy infestation'),
        },
        {
          key: 'moisture',
          labelKey: 'rubric.cowpea.moisture',
          visualCues: 'soft swollen beans, damp clumping',
          bandDescriptors: band('Dry hard beans', 'A few soft beans', 'Noticeably damp', 'Wet or sprouting beans'),
        },
        {
          key: 'foreign_matter',
          labelKey: 'rubric.cowpea.foreign_matter',
          visualCues: 'pod shells, stones and soil among the beans',
          bandDescriptors: band('Essentially clean', 'Traces of shell', 'Visible stones or soil', 'Heavy contamination'),
        },
        {
          key: 'shrivelled_discoloured',
          labelKey: 'rubric.cowpea.shrivelled_discoloured',
          visualCues: 'wrinkled undersized beans, dark or stained seed coats',
          bandDescriptors: band('Plump even-coloured beans', 'A few shrivelled or stained', 'Many shrivelled or stained', 'Mostly shrivelled or dark'),
        },
        {
          key: 'mould',
          labelKey: 'rubric.cowpea.mould',
          visualCues: 'white or green fungal growth, musty caking',
          bandDescriptors: band('No visible mould', 'Isolated specks', 'Small mouldy patches', 'Widespread mould'),
        },
      ],
    },
  },
);

// `excluded.<column>`: in an upsert, the value the INSERT tried to write.
const excluded = (column: AnyPgColumn) => sql.raw(`excluded."${column.name}"`);

/**
 * Reference data: regions, crops, units, rubrics, market prices, the vehicle
 * rate card. Safe to run again: rows that exist are kept.
 *
 * `refresh` (the default, for db:reset) also rewrites the reference prices and
 * the rate card to these values. The deploy (db:setup) and a local start run it
 * with `refresh: false`, so a crop added here (Phase 1 added five) reaches an
 * existing database without touching anything already there.
 *
 * One statement per table, not one per row: against the hosted database each
 * statement is a network round trip, and ~200 of them made the deploy build
 * take minutes.
 */
export async function seed(opts: { refresh?: boolean } = {}): Promise<void> {
  const refresh = opts.refresh ?? true;
  await db
    .insert(regions)
    .values(REGION_SEED.map((r) => ({ code: r.code, nameKey: `region.${r.code}`, lat: r.lat, lng: r.lng })))
    .onConflictDoNothing();

  await db
    .insert(commodities)
    .values(
      COMMODITY_SEED.map((c) => ({
        code: c.code,
        nameKey: `commodity.${c.code}`,
        category: c.category,
        clockType: c.clockType,
        clockConfig: JSON.stringify(c.clock),
        activeRubricVersion: 1,
        sortOrder: c.sortOrder,
      })),
    )
    .onConflictDoUpdate({ target: commodities.code, set: { sortOrder: excluded(commodities.sortOrder) } });

  const idByCode = new Map((await db.select({ id: commodities.id, code: commodities.code }).from(commodities)).map((c) => [c.code, c.id]));
  const commodityId = (code: string) => {
    const id = idByCode.get(code);
    if (id === undefined) throw new Error(`seed: commodity ${code} missing after insert`);
    return id;
  };

  await db
    .insert(units)
    .values(
      COMMODITY_SEED.flatMap((c) =>
        c.units.map((u) => ({
          commodityId: commodityId(c.code),
          code: u.code,
          nameKey: `unit.${u.code}`,
          kgPerUnit: u.kgPerUnit,
          isInformal: u.isInformal ?? false,
        })),
      ),
    )
    .onConflictDoNothing();

  await db
    .insert(rubrics)
    .values(COMMODITY_SEED.map((c) => ({ commodityId: commodityId(c.code), version: 1, doc: JSON.stringify(c.rubric) })))
    .onConflictDoNothing();

  await seedMarketPrices(refresh, idByCode);

  // Logistics rate card (D-024): base fee + per-km, quoted upfront per vehicle class.
  const VEHICLE_SEED = [
    { code: 'tricycle', capacityKg: 400, baseFee: 2000, perKmRate: 250, sortOrder: 10 },
    { code: 'van', capacityKg: 1500, baseFee: 4000, perKmRate: 400, sortOrder: 20 },
    { code: 'light_truck', capacityKg: 5000, baseFee: 8000, perKmRate: 600, sortOrder: 30 },
  ];
  const vehicles = db.insert(vehicleClasses).values(VEHICLE_SEED.map((v) => ({ ...v, nameKey: `vehicle.${v.code}` })));
  if (refresh) {
    await vehicles.onConflictDoUpdate({
      target: vehicleClasses.code,
      set: {
        capacityKg: excluded(vehicleClasses.capacityKg),
        baseFee: excluded(vehicleClasses.baseFee),
        perKmRate: excluded(vehicleClasses.perKmRate),
        sortOrder: excluded(vehicleClasses.sortOrder),
      },
    });
  } else {
    await vehicles.onConflictDoNothing();
  }

  // The registries are cached in memory (domain/registries.ts): refresh them from what was just written.
  await loadRegistries();
  console.log('Seed complete: regions, commodities, units, rubrics, market prices, vehicle rate card.');
}

// Reference market prices (GHS/kg → pesewas). Placeholder data clearly marked
// as reference — a real price feed replaces upsertMarketPrice's caller later.
const MARKETS: Array<{ market: string; regionCode: string }> = [
  { market: 'Techiman', regionCode: 'BONO_EAST' },
  { market: 'Agbogbloshie', regionCode: 'GREATER_ACCRA' },
  { market: 'Kumasi Central', regionCode: 'ASHANTI' },
  { market: 'Tamale Aboabo', regionCode: 'NORTHERN' },
];

// pesewas/kg in market order above
const PRICE_SEED: Record<string, [number, number, number, number]> = {
  MAIZE: [380, 460, 420, 350],
  TOMATO: [550, 780, 650, 500],
  YAM: [320, 450, 380, 280],
  RICE: [900, 1100, 1000, 850],
  GROUNDNUT: [1200, 1450, 1300, 1050],
  PEPPER: [800, 1050, 900, 700],
  ONION: [650, 800, 720, 580],
  PLANTAIN: [300, 420, 360, 340],
  // Phase 1 crops, from 2025-26 reports: FAO FPMA sorghum at Techiman (GHS 726.67
  // per 109kg, May 2026), soya after the export ban (~GHS 350 a bag), cowpea
  // (~GHS 10.6/kg, Aug 2026), cassava sacks at GHS 300-400. Reference only.
  CASSAVA: [350, 450, 400, 330],
  MILLET: [720, 850, 780, 650],
  SORGHUM: [667, 780, 720, 600],
  SOYBEAN: [350, 450, 400, 330],
  COWPEA: [950, 1150, 1050, 900],
};

async function seedMarketPrices(refresh: boolean, idByCode: Map<string, string>): Promise<void> {
  const now = Date.now();
  const rows = Object.entries(PRICE_SEED).flatMap(([code, prices]) => {
    const commodityId = idByCode.get(code);
    if (commodityId === undefined) return [];
    return MARKETS.map(({ market, regionCode }, i) => ({ code, commodityId, market, regionCode, pricePerKg: prices[i]! }));
  });
  // The same placeholder joins the price history as a 'reference' — the lowest-trust
  // source, used only when nothing real exists, and it ages out like any other (D-053).
  const observations = db.insert(priceObservations).values(
    rows.map((r) => ({
      commodityId: r.commodityId,
      regionCode: r.regionCode,
      market: r.market,
      pricePerKg: r.pricePerKg,
      source: 'reference' as const,
      dataset: 'seed',
      refId: `seed:${r.code}:${r.market}`,
      observedAt: now,
    })),
  );
  if (refresh) {
    await observations.onConflictDoUpdate({
      target: [priceObservations.source, priceObservations.refId],
      set: { pricePerKg: excluded(priceObservations.pricePerKg), observedAt: now },
    });
  } else {
    await observations.onConflictDoNothing();
  }
  const current = db
    .insert(marketPrices)
    .values(rows.map((r) => ({ commodityId: r.commodityId, market: r.market, regionCode: r.regionCode, pricePerKg: r.pricePerKg, recordedAt: now })));
  if (refresh) {
    await current.onConflictDoUpdate({
      target: [marketPrices.commodityId, marketPrices.market],
      set: { pricePerKg: excluded(marketPrices.pricePerKg), recordedAt: now },
    });
  } else {
    await current.onConflictDoNothing(); // a price already there (or a real one later) is never overwritten
  }
}
