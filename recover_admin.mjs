import { createClient } from '@insforge/sdk';

const client = createClient('https://7wsi38g7.us-east.insforge.app', 'ik_e46b631c373568bc5aa278c0eb0085e2b690567d93569ff5b997c803f70ed76d');

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
