import { db } from './client';
import { buyers, commodities, regions, rubrics, units } from './schema';
import { t } from '../i18n';
import { clockConfigSchema, rubricDocSchema } from '../domain/types';

const allCommodities = (await db.select().from(commodities));
console.log(`Commodities (${allCommodities.length}):`);
for (const c of allCommodities) {
  const clock = clockConfigSchema.parse(JSON.parse(c.clockConfig));
  console.log(
    `  ${c.code} — ${t('en', c.nameKey)} | ${c.category}/${c.clockType} | offer TTL ${clock.offerTtlMinutes}m, decay ${clock.distanceDecayKm}km, forward=${clock.allowsForward}`,
  );
  const commodityUnits = (await db.select().from(units)).filter((u) => u.commodityId === c.id);
  for (const u of commodityUnits) {
    console.log(`     unit ${u.code} = ${u.kgPerUnit}kg${u.isInformal ? ' (informal)' : ''}`);
  }
  const commodityRubrics = (await db.select().from(rubrics)).filter((r) => r.commodityId === c.id);
  for (const r of commodityRubrics) {
    const doc = rubricDocSchema.parse(JSON.parse(r.doc));
    console.log(`     rubric v${r.version}: ${doc.criteria.map((cr) => cr.key).join(', ')}`);
  }
}

console.log(`Regions: ${(await db.select().from(regions)).length}`);
console.log(`Buyers: ${(await db.select().from(buyers)).map((b) => b.email).join(', ')}`);
