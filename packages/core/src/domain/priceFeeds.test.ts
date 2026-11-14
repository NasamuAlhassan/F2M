import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { priceObservations } from '../db/schema';
import { ingestFeed, importWfpCsv, parseCsvLine } from './priceFeeds';
import { getCommodityByCode } from './registries';

const HEADER =
  'date,admin1,admin2,market,market_id,latitude,longitude,category,commodity,commodity_id,unit,priceflag,pricetype,currency,price,usdprice';

describe('parseCsvLine', () => {
  it('keeps a quoted field with commas in one piece', () => {
    expect(parseCsvLine('a,"meat, fish and eggs",c')).toEqual(['a', 'meat, fish and eggs', 'c']);
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(['a', 'say "hi"', 'c']);
  });
});

describe('importWfpCsv', () => {
  const csv = [
    HEADER,
    '#date,#adm1+name,#adm2+name,#loc+market+name,#loc+market+code,#geo+lat,#geo+lon,#item+type,#item+name,#item+code,#item+unit,#item+price+flag,#item+price+type,#currency,#value,#value+usd',
    '2021-03-15,NORTHERN,TAMALE,Tamale,1,9.4,-0.8,cereals and tubers,Maize,51,100 KG,actual,Wholesale,GHS,320,55', // 320 GHS / 100 kg → 320 p/kg
    '2021-03-15,ASHANTI,KMA,Kumasi,2,6.7,-1.6,vegetables and fruits,Tomatoes (local),346,52 KG,actual,Wholesale,GHS,260,45', // 260 GHS / 52 kg → 500 p/kg
    '2021-03-15,ASHANTI,KMA,Kumasi,2,6.7,-1.6,cereals and tubers,Maize,51,KG,actual,Retail,GHS,4.1,0.7', // retail — not ours
    '2021-03-15,ASHANTI,KMA,Kumasi,2,6.7,-1.6,"meat, fish and eggs",Fish (fresh),9,KG,actual,Wholesale,GHS,20,3', // not a crop we trade
    '2021-03-15,BRONG AHAFO,TECHIMAN,Techiman,3,7.6,-1.9,vegetables and fruits,Plantains (apem),12,Bunch,actual,Wholesale,GHS,30,5', // a bunch is 12 kg → 250 p/kg
    '2021-03-15,BRONG AHAFO,TECHIMAN,Techiman,3,7.6,-1.9,cereals and tubers,Cassava,68,91 KG,actual,Wholesale,USD,10,10', // wrong currency
  ].join('\n');

  const rows = (code: string) =>
    db.select().from(priceObservations).where(and(eq(priceObservations.commodityId, getCommodityByCode(code).id), eq(priceObservations.dataset, 'wfp'))).all();

  it('keeps only wholesale cedi prices of our crops and converts them to pesewas per kg', () => {
    const result = importWfpCsv(csv);
    expect(result).toMatchObject({ read: 6, imported: 3, newest: '2021-03-15' });
    expect(rows('MAIZE').map((r) => r.pricePerKg)).toEqual([320]);
    expect(rows('TOMATO').map((r) => r.pricePerKg)).toEqual([500]);
    expect(rows('PLANTAIN').map((r) => r.pricePerKg)).toEqual([250]);
    expect(rows('CASSAVA')).toHaveLength(0);
  });

  it('puts each market in its modern region', () => {
    expect(rows('MAIZE')[0]!.regionCode).toBe('NORTHERN');
    expect(rows('PLANTAIN')[0]!.regionCode).toBe('BONO_EAST'); // Techiman is in Bono East, not "Brong Ahafo"
    expect(rows('MAIZE')[0]!.source).toBe('market');
  });

  it('adds nothing when the same file is loaded again', () => {
    importWfpCsv(csv);
    expect(rows('MAIZE')).toHaveLength(1);
  });

  it('refuses a file that is not WFP’s', () => {
    expect(() => importWfpCsv('a,b,c\n1,2,3')).toThrow(/WFP/);
  });
});

describe('ingestFeed', () => {
  const today = new Date().toISOString();

  it('accepts cedis per kg or per unit, and says which rows it could not use', () => {
    const result = ingestFeed({
      dataset: 'test-collector',
      observations: [
        { commodity: 'onion', market: 'Techiman', regionCode: 'BONO_EAST', ghsPerKg: 6.5, observedAt: today },
        { commodity: 'ONION', market: 'Tamale', regionCode: 'NORTHERN', ghsPerUnit: 300, unitKg: 50, observedAt: today },
        { commodity: 'UNOBTAINIUM', ghsPerKg: 5 },
        { commodity: 'ONION', regionCode: 'ATLANTIS', ghsPerKg: 5 },
        { commodity: 'ONION', ghsPerKg: 5, observedAt: '2999-01-01' },
        { commodity: 'ONION', ghsPerKg: 5000 },
      ],
    });
    expect(result.accepted).toBe(2);
    expect(result.rejected.map((r) => r.index)).toEqual([2, 3, 4, 5]);
    const onion = db
      .select()
      .from(priceObservations)
      .where(and(eq(priceObservations.commodityId, getCommodityByCode('ONION').id), eq(priceObservations.dataset, 'test-collector')))
      .all()
      .map((r) => r.pricePerKg)
      .sort();
    expect(onion).toEqual([600, 650]);
  });

  it('is repeatable: the same report on the same day is one row', () => {
    const feed = { dataset: 'test-repeat', observations: [{ commodity: 'RICE', market: 'Wa', ghsPerKg: 9, observedAt: today }] };
    ingestFeed(feed);
    ingestFeed({ ...feed, observations: [{ ...feed.observations[0]!, ghsPerKg: 9.5 }] });
    const rice = db.select().from(priceObservations).where(eq(priceObservations.dataset, 'test-repeat')).all();
    expect(rice).toHaveLength(1);
    expect(rice[0]!.pricePerKg).toBe(950);
  });

  it('rejects a malformed feed outright', () => {
    expect(() => ingestFeed({ dataset: 'x', observations: [] })).toThrow();
    expect(() => ingestFeed({ dataset: 'bad name!', observations: [{ commodity: 'MAIZE', ghsPerKg: 4 }] })).toThrow();
    expect(() => ingestFeed({ dataset: 'x', observations: [{ commodity: 'MAIZE' }] })).toThrow();
  });
});
