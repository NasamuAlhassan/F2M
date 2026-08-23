/**
 * One-time MTN MoMo sandbox provisioning: creates the API user + key that
 * every token request authenticates with. Run AFTER subscribing to the
 * Collections product at momodeveloper.mtn.com (the Collections primary key
 * authorizes this call).
 *
 *   npm run momo:provision
 *
 * Prints MOMO_API_USER / MOMO_API_KEY for your .env.
 */
import { config } from '@ftm/core';

const subKey = config.MOMO_SUB_KEY_COLLECTIONS;
if (!subKey) {
  console.error('Set MOMO_SUB_KEY_COLLECTIONS in .env first (Collections product primary key).');
  process.exit(1);
}

const apiUser = crypto.randomUUID();
const base = config.MOMO_BASE_URL;
const callbackHost = new URL(config.PUBLIC_BASE_URL).host;

const createUser = await fetch(`${base}/v1_0/apiuser`, {
  method: 'POST',
  headers: {
    'X-Reference-Id': apiUser,
    'Ocp-Apim-Subscription-Key': subKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ providerCallbackHost: callbackHost }),
});
if (createUser.status !== 201) {
  console.error(`apiuser creation failed: ${createUser.status} ${await createUser.text()}`);
  process.exit(1);
}

const createKey = await fetch(`${base}/v1_0/apiuser/${apiUser}/apikey`, {
  method: 'POST',
  headers: { 'Ocp-Apim-Subscription-Key': subKey },
});
if (createKey.status !== 201) {
  console.error(`apikey creation failed: ${createKey.status} ${await createKey.text()}`);
  process.exit(1);
}
const { apiKey } = (await createKey.json()) as { apiKey: string };

console.log('MoMo sandbox API user provisioned. Add to your .env:');
console.log(`MOMO_API_USER=${apiUser}`);
console.log(`MOMO_API_KEY=${apiKey}`);
console.log(`(callback host registered: ${callbackHost})`);
