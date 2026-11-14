// Sample listings for demos and screenshots — this script lives only on the
// `demo-data` branch, so main never ships fake farmers or fake listings.
// Run it against a LOCAL database only: npx tsx apps/server/scripts/dev-lots.ts
// (WAL — safe beside the dev server). The phone numbers are made up.
import { config, db, registerFarmer, registerLot, schema } from '@ftm/core';
import { eq } from 'drizzle-orm';

if (!config.simulatorEnabled) {
  console.error('Refusing: SIMULATOR_ENABLED is off, so this looks like a real database.');
  process.exit(1);
}

const DAY = 86_400_000;
const GHS = 100; // pesewas

function farmerFor(phone: string, name: string, regionCode: string, district: string) {
  const existing = db.select().from(schema.farmers).where(eq(schema.farmers.phone, phone)).get();
  if (existing) return existing;
  return registerFarmer({ phone, name, regionCode, district });
}

const asante = farmerFor('+233209110001', 'Asante Farms Ltd', 'BONO_EAST', 'Techiman');
const kofi = farmerFor('+233209110002', 'Kofi Mensah Co-op', 'BONO', 'Sunyani');
const northern = farmerFor('+233209110003', 'Northern Grains Collective', 'NORTHERN', 'Tamale');
const ada = farmerFor('+233209110004', 'Ada Estuary Growers', 'GREATER_ACCRA', 'Ada');
const bawku = farmerFor('+233209110005', 'Bawku Legume Growers', 'UPPER_EAST', 'Bawku');
const volta = farmerFor('+233209110006', 'Kpando Cassava Women', 'VOLTA', 'Kpando');

const lots: Array<Parameters<typeof registerLot>[0]> = [
  { farmerId: asante.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 1, declaredBand: 'A', askingPricePerUnit: 1100 * GHS, community: 'Tuobodom', harvestedAt: Date.now() - 4 * DAY },
  { farmerId: kofi.id, commodityCode: 'TOMATO', unitCode: 'CRATE', unitQty: 40, declaredBand: 'B', askingPricePerUnit: 380 * GHS, community: 'Abesim', harvestedAt: Date.now() - DAY },
  { farmerId: northern.id, commodityCode: 'MAIZE', unitCode: 'BAG_50KG', unitQty: 60, declaredBand: 'A', readyDate: Date.now() + 5 * DAY, community: 'Savelugu', landmark: 'Beside the district assembly' },
  { farmerId: ada.id, commodityCode: 'PEPPER', unitCode: 'SACK', unitQty: 25, declaredBand: 'B', askingPricePerUnit: 420 * GHS, community: 'Big Ada' },
  { farmerId: northern.id, commodityCode: 'GROUNDNUT', unitCode: 'BAG_50KG', unitQty: 30, declaredBand: 'A', readyDate: Date.now() + 9 * DAY, askingPricePerUnit: 650 * GHS },
  { farmerId: northern.id, commodityCode: 'SORGHUM', unitCode: 'BAG_100KG', unitQty: 20, declaredBand: 'B', askingPricePerUnit: 690 * GHS, community: 'Tolon' },
  { farmerId: bawku.id, commodityCode: 'COWPEA', unitCode: 'BAG_100KG', unitQty: 15, declaredBand: 'A', askingPricePerUnit: 1000 * GHS, community: 'Zebilla', harvestedAt: Date.now() - 20 * DAY },
  { farmerId: bawku.id, commodityCode: 'MILLET', unitCode: 'BAG_100KG', unitQty: 12, declaredBand: 'B', community: 'Garu' },
  { farmerId: northern.id, commodityCode: 'SOYBEAN', unitCode: 'BAG_100KG', unitQty: 40, declaredBand: 'B', askingPricePerUnit: 360 * GHS, community: 'Yendi' },
  { farmerId: volta.id, commodityCode: 'CASSAVA', unitCode: 'SACK', unitQty: 18, declaredBand: 'A', askingPricePerUnit: 330 * GHS, community: 'Kpando Torkor', harvestedAt: Date.now() },
];

for (const l of lots) {
  try {
    const lot = registerLot({ channel: 'web', ...l });
    console.log('registered', lot.lotCode, l.commodityCode, `${lot.quantityKg}kg`);
  } catch (err) {
    console.log('skip', l.commodityCode, (err as Error).message);
  }
}
