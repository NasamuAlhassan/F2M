import { and, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { demands, lots } from '../db/schema';
import { t } from '../i18n';
import { listRegions } from './registries';

/**
 * Who has what, and where (D-055): for one crop, how much is on the market in
 * each region and how much buyers there are asking for. Totals only — no
 * names — so a farmer can see where her crop is scarce, and a buyer where it
 * is plentiful, without anyone's identity leaving the listing they chose to
 * publish.
 */
export interface RegionBalance {
  regionCode: string;
  regionName: string;
  supplyKg: number;
  sellers: number;
  demandKg: number;
  buyers: number;
  /** Over 1 there is more listed than wanted; under 1 buyers want more than is listed. Null with no demand. */
  balance: number | null;
}

export async function supplyDemandByRegion(commodityId: string, now = Date.now()): Promise<RegionBalance[]> {
  const supply = (await db
      .select()
      .from(lots)
      .where(and(eq(lots.commodityId, commodityId), inArray(lots.status, ['registered', 'matched']), gt(lots.remainingKg, 0))))
    .filter((l) => l.expiresAt === null || l.expiresAt > now);
  const wanted = (await db
      .select()
      .from(demands)
      .where(
        and(
          eq(demands.commodityId, commodityId),
          eq(demands.origin, 'request'),
          inArray(demands.status, ['open', 'partially_matched']),
          gt(demands.remainingKg, 0),
          gt(demands.windowEnd, now),
        ),
      ));

  return listRegions()
    .map((r) => {
      const mine = supply.filter((l) => l.regionCode === r.code);
      const asks = wanted.filter((d) => d.regionCode === r.code);
      const supplyKg = Math.round(mine.reduce((s, l) => s + l.remainingKg, 0));
      const demandKg = Math.round(asks.reduce((s, d) => s + d.remainingKg, 0));
      return {
        regionCode: r.code,
        regionName: t('en', r.nameKey),
        supplyKg,
        sellers: new Set(mine.map((l) => l.farmerId)).size,
        demandKg,
        buyers: new Set(asks.map((d) => d.buyerId)).size,
        balance: demandKg > 0 ? supplyKg / demandKg : null,
      };
    })
    .filter((r) => r.supplyKg > 0 || r.demandKg > 0)
    .sort((a, b) => b.supplyKg + b.demandKg - (a.supplyKg + a.demandKg));
}
