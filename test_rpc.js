import { createClient } from '@insforge/sdk';

const client = createClient({
    baseUrl: 'https://7wsi38g7.us-east.insforge.app',
    anonKey: 'ik_e46b631c373568bc5aa278c0eb0085e2b690567d93569ff5b997c803f70ed76d'
});

async function run() {
    const { data, error } = await client.database.rpc('consume_invite_key', {
        key_code_param: 'SPLIT-ELPNDN',
        target_user_id: '12345678-1234-1234-1234-123456789012'
    });
    console.log("RPC Data:", data);
    console.log("RPC Error:", error);
}
run();
