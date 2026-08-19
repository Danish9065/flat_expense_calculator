import { createClient } from '@insforge/sdk';

const baseUrl = process.env.INSFORGE_URL;
const apiKey = process.env.INSFORGE_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error('INSFORGE_URL and INSFORGE_API_KEY are required');
}

const client = createClient(baseUrl, apiKey);

async function main() {
  const { data, error } = await client.auth.signUp({
    email: 'danish90654@gmail.com',
    password: 'Danish99@',
  });
  if (error) {
    if (error.message.includes('already registered')) {
       console.log('Already registered. Please use raw SQL to verify instead.');
       process.exit(0);
    }
    console.error('ERROR SIGNING UP:', error);
    process.exit(1);
  }
  console.log('USER_ID:', data?.user?.id);
  process.exit(0);
}

main();
