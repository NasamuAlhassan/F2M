// `npm run ai:triage -w @ftm/core [-- --days=30]`
// Reads the voice listings that failed and says why, so the language models and
// the parser can be improved from real farmers' sentences (vision §5.3).
//
// Always prints a plain grouping of what went wrong. If the language-model assist
// is switched on, it also asks the model to name patterns and propose glossary
// entries and test sentences — for a human to review, never applied automatically.
// Transcripts are scrubbed of phone numbers before they are sent.
import { gte, eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { runMigrations } from './migrate';

runMigrations();
const { db } = await import('./client');
const { voiceListings } = await import('./schema');
const { askLlm, llmEnabled } = await import('../providers/llm/index');

const days = Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7) ?? 30);
const since = Date.now() - days * 24 * 60 * 60 * 1000;
const failed = db
  .select()
  .from(voiceListings)
  .where(and(eq(voiceListings.status, 'failed'), gte(voiceListings.createdAt, since)))
  .all();

console.log(`# Failed voice listings, last ${days} days: ${failed.length}\n`);
if (failed.length === 0) process.exit(0);

const byReason = new Map<string, typeof failed>();
for (const row of failed) {
  const reason = (row.error ?? 'unknown').split(':')[0]!;
  byReason.set(reason, [...(byReason.get(reason) ?? []), row]);
}
for (const [reason, rows] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${reason}: ${rows.length}`);
  for (const r of rows.slice(0, 8)) {
    console.log(`- [${r.locale}] heard: ${r.transcript ?? '(nothing)'}\n  English: ${r.translatedText ?? '(none)'}`);
  }
  console.log('');
}

if (!llmEnabled()) {
  console.log('(The language-model assist is off, so no pattern analysis. Set LLM_PROVIDER=anthropic to add one.)');
  process.exit(0);
}

const analysis = await askLlm({
  system: [
    'You review sentences that Ghanaian farmers said about produce they want to sell. Each was speech-recognised in a local language and machine-translated to English, and the listing parser could not use it.',
    'Name the recurring patterns, in plain words. For each, say what went wrong (a wrong translation of a farm word, a crop the platform does not carry, an unusual way of giving a quantity, and so on) and what would fix it.',
    'Propose glossary entries (a local-language word or a wrong English rendering, and what it should mean) only where the sentences show it clearly. Propose test sentences that capture each pattern.',
  ].join('\n'),
  user: failed
    .slice(0, 60)
    .map((r, i) => `${i + 1}. [${r.locale}] ${r.transcript ?? ''} => ${r.translatedText ?? ''} (${r.error ?? ''})`)
    .join('\n'),
  schema: z.object({
    patterns: z.array(z.object({ pattern: z.string(), whatWentWrong: z.string(), fix: z.string() })),
    glossary: z.array(z.object({ heard: z.string(), shouldMean: z.string() })),
    testSentences: z.array(z.string()),
  }),
  maxTokens: 3000,
});

if (!analysis) {
  console.log('(The model gave no usable analysis this time.)');
  process.exit(0);
}
console.log('# Patterns (for review)\n');
for (const p of analysis.patterns) console.log(`- **${p.pattern}**: ${p.whatWentWrong} Fix: ${p.fix}`);
console.log('\n# Suggested glossary entries (review before adding)\n');
for (const g of analysis.glossary) console.log(`- "${g.heard}" should mean "${g.shouldMean}"`);
console.log('\n# Suggested test sentences\n');
for (const s of analysis.testSentences) console.log(`- ${s}`);
