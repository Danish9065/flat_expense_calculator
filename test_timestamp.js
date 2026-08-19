import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: process.env.INSFORGE_URL,
  anonKey: process.env.INSFORGE_API_KEY,
});

async function run() {
  const { data, error } = await client.database.from('expenses').select('created_at').limit(1);
  console.log("Date string:", data?.[0]?.created_at);
}
run();
