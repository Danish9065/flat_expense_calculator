import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: 'https://7wsi38g7.us-east.insforge.app',
  anonKey: 'ik_e46b631c373568bc5aa278c0eb0085e2b690567d93569ff5b997c803f70ed76d'
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
