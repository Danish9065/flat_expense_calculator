import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: process.env.INSFORGE_URL,
  anonKey: process.env.INSFORGE_API_KEY,
});

async function run() {
  const { data, error } = await client.auth.signUp({
    email: `test_${Date.now()}@example.com`,
    password: 'Password123!'
  });
  console.log("Auth Data:", data);
  console.log("Auth Error:", error);
}
run();
