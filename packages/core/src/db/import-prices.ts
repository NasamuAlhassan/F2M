// `npm run prices:import -w @ftm/core [-- path/to/wfp.csv]`
// Loads WFP's Ghana food-price history (2006-2023, CC BY-IGO) into the price
// history: from a file you give it, else downloaded from HDX. Safe to repeat.
import fs from 'node:fs';
import { runMigrations } from './migrate';

runMigrations();
const { seed } = await import('./seed');
await seed({ refresh: false }); // crops must exist before prices can point at them
const { fetchAndImportWfp, importWfpCsv } = await import('../domain/priceFeeds');

const file = process.argv[2];
const result = file ? importWfpCsv(fs.readFileSync(file, 'utf8')) : await fetchAndImportWfp();
console.log(`Read ${result.read} rows, imported ${result.imported}, skipped ${result.skipped}. Newest reading: ${result.newest ?? 'none'}.`);
