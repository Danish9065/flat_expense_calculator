import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: 'https://7wsi38g7.us-east.insforge.app',
  anonKey: 'ik_e46b631c373568bc5aa278c0eb0085e2b690567d93569ff5b997c803f70ed76d'
});

async function run() {
  const { data, error } = await client.database.from('expenses').select('created_at').limit(1);
  console.log("Date string:", data?.[0]?.created_at);
}
run();
