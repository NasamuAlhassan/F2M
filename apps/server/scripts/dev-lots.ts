// Dev-only: put a few browsable lots on the marketplace (WAL — safe beside the dev server).
import { db, registerFarmer, registerLot, schema } from '@ftm/core';
import { eq } from 'drizzle-orm';

function farmerFor(phone: string, name: string, regionCode: string, district: string) {
  const existing = db.select().from(schema.farmers).where(eq(schema.farmers.phone, phone)).get();
  if (existing) return existing;
  return registerFarmer({ phone, name, regionCode, district });
}

const asante = farmerFor('+233209110001', 'Asante Farms Ltd', 'BONO_EAST', 'Techiman');
const kofi = farmerFor('+233209110002', 'Kofi Mensah Co-op', 'BONO', 'Sunyani');
const northern = farmerFor('+233209110003', 'Northern Grains Collective', 'NORTHERN', 'Tamale');
const ada = farmerFor('+233209110004', 'Ada Estuary Growers', 'GREATER_ACCRA', 'Ada');

const lots = [
  { farmerId: asante.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 1, declaredBand: 'A' },
  { farmerId: kofi.id, commodityCode: 'TOMATO', unitCode: 'CRATE', unitQty: 40, declaredBand: 'B' },
  { farmerId: northern.id, commodityCode: 'MAIZE', unitCode: 'BAG_50KG', unitQty: 60, declaredBand: 'A', readyDate: Date.now() + 5 * 86400000 },
  { farmerId: ada.id, commodityCode: 'PEPPER', unitCode: 'SACK', unitQty: 25, declaredBand: 'B' },
  { farmerId: northern.id, commodityCode: 'GROUNDNUT', unitCode: 'BAG_50KG', unitQty: 30, declaredBand: 'A', readyDate: Date.now() + 9 * 86400000 },
];

for (const l of lots) {
  try {
    const lot = registerLot(l as Parameters<typeof registerLot>[0]);
    console.log('registered', lot.lotCode, l.commodityCode, lot.quantityKg + 'kg');
  } catch (err) {
    console.log('skip', l.commodityCode, (err as Error).message);
  }
}
