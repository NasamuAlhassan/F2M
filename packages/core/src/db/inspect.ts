import { db } from './client';
import { buyers, commodities, regions, rubrics, units } from './schema';
import { t } from '../i18n';
import { clockConfigSchema, rubricDocSchema } from '../domain/types';

const allCommodities = db.select().from(commodities).all();
console.log(`Commodities (${allCommodities.length}):`);
for (const c of allCommodities) {
  const clock = clockConfigSchema.parse(JSON.parse(c.clockConfig));
  console.log(
    `  ${c.code} — ${t('en', c.nameKey)} | ${c.category}/${c.clockType} | offer TTL ${clock.offerTtlMinutes}m, decay ${clock.distanceDecayKm}km, forward=${clock.allowsForward}`,
  );
  const commodityUnits = db.select().from(units).all().filter((u) => u.commodityId === c.id);
  for (const u of commodityUnits) {
    console.log(`     unit ${u.code} = ${u.kgPerUnit}kg${u.isInformal ? ' (informal)' : ''}`);
  }
  const commodityRubrics = db.select().from(rubrics).all().filter((r) => r.commodityId === c.id);
  for (const r of commodityRubrics) {
    const doc = rubricDocSchema.parse(JSON.parse(r.doc));
    console.log(`     rubric v${r.version}: ${doc.criteria.map((cr) => cr.key).join(', ')}`);
  }
}

console.log(`Regions: ${db.select().from(regions).all().length}`);
console.log(`Buyers: ${db.select().from(buyers).all().map((b) => b.email).join(', ')}`);
