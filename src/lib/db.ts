import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
});

export function setAuthToken(token: string | null) {
  // @ts-ignore - 'http' might be private in typescript definitions but works at runtime
  insforge.http.userToken = token;
}

async function executeWithRetry(queryFn: () => Promise<any>) {
  let result = await queryFn();

  if (result.error) {
    const errStr = JSON.stringify(result.error);
    // Intercept 401s, JWT expirations, or malformed UUIDs (22P02)
    if (errStr.includes('JWT expired') || errStr.includes('PGRST301') || errStr.includes('401') || errStr.includes('22P02')) {
      try {
        const saved = localStorage.getItem('splitmate-user');
        if (!saved) throw new Error('No saved session found');
        const parsed = JSON.parse(saved);
        const refreshToken = parsed.refreshToken;
        if (!refreshToken) throw new Error('No refresh token available');

        // Manually refresh token using the mobile client_type
        const res = await fetch(`${import.meta.env.VITE_INSFORGE_URL}/api/auth/refresh?client_type=mobile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_INSFORGE_ANON_KEY
          },
          body: JSON.stringify({ refreshToken })
        });

        const resData = await res.json();
        if (!res.ok) {
          throw new Error(resData.message || 'Session expired. Please log in again.');
        }

        if (resData.accessToken && resData.refreshToken) {
          const newToken = resData.accessToken;
          setAuthToken(newToken);

          // Update localStorage seamlessly so AuthContext stays in sync
          parsed.token = newToken;
          parsed.refreshToken = resData.refreshToken;
          localStorage.setItem('splitmate-user', JSON.stringify(parsed));

          // Retry the original query
          result = await queryFn();
        } else {
          throw new Error('Invalid refresh response');
        }
      } catch (e) {
        // If the refresh actually failed natively, wipe corrupted session and redirect
        localStorage.removeItem('splitmate-user');
        window.dispatchEvent(new Event('auth:logout'));
        window.location.replace('/login');
        throw e;
      }
    }
  }

  // Check if error still persists after retry
  if (result.error) {
    const finalErrStr = JSON.stringify(result.error);
    if (finalErrStr.includes('JWT expired') || finalErrStr.includes('PGRST301') || finalErrStr.includes('401') || finalErrStr.includes('22P02')) {
      localStorage.removeItem('splitmate-user');
      window.dispatchEvent(new Event('auth:logout'));
      window.location.replace('/login');
    }
    throw new Error(finalErrStr || 'Database error occurred');
  }

  return result.data;
}

function parseParams(params: string) {
  const filters: { key: string; op: string; val: string }[] = [];
  let selectVal = '*';
  let orderCol = '';
  let orderAsc = false;
  if (!params) return { filters, selectVal, orderCol, orderAsc };

  for (const part of params.split('&')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.substring(0, eqIdx);
    const val = part.substring(eqIdx + 1);
    if (key === 'select') {
      selectVal = val;
    } else if (key === 'order') {
      const [col, dir] = val.split('.');
      orderCol = col;
      orderAsc = dir !== 'desc';
    } else if (val.startsWith('eq.')) filters.push({ key, op: 'eq', val: val.substring(3) });
    else if (val.startsWith('neq.')) filters.push({ key, op: 'neq', val: val.substring(4) });
    else if (val.startsWith('gt.')) filters.push({ key, op: 'gt', val: val.substring(3) });
    else if (val.startsWith('lt.')) filters.push({ key, op: 'lt', val: val.substring(3) });
    else if (val.startsWith('like.')) filters.push({ key, op: 'like', val: val.substring(5) });
    else if (val.startsWith('in.')) filters.push({ key, op: 'in', val: val.substring(3) });
  }
  return { filters, selectVal, orderCol, orderAsc };
}

function applyFilters(query: any, filters: { key: string; op: string; val: string }[]) {
  for (const f of filters) {
    if (f.op === 'eq') query = query.eq(f.key, f.val);
    if (f.op === 'neq') query = query.neq(f.key, f.val);
    if (f.op === 'gt') query = query.gt(f.key, f.val);
    if (f.op === 'lt') query = query.lt(f.key, f.val);
    if (f.op === 'like') query = query.like(f.key, f.val);
    if (f.op === 'in') query = query.in(f.key, f.val.replace(/^\(|\)$/g, '').split(','));
  }
  return query;
}

export async function dbQuery(table: string, params = '') {
  return executeWithRetry(async () => {
    const { filters, selectVal, orderCol, orderAsc } = parseParams(params);
    let query = insforge.database.from(table).select(selectVal);
    query = applyFilters(query, filters);
    if (orderCol) query = query.order(orderCol, { ascending: orderAsc });
    return await query;
  });
}

export async function dbInsert(table: string, body: object) {
  return executeWithRetry(async () => {
    return await insforge.database.from(table).insert([body]).select('*');
  });
}

export async function dbUpdate(table: string, params: string, body: object) {
  return executeWithRetry(async () => {
    const { filters, selectVal } = parseParams(params);
    let query = insforge.database.from(table).update(body).select(selectVal);
    query = applyFilters(query, filters);
    return await query;
  });
}

export async function dbDelete(table: string, params: string) {
  return executeWithRetry(async () => {
    const { filters } = parseParams(params);
    let query = insforge.database.from(table).delete();
    query = applyFilters(query, filters);
    return await query;
  });
}

export default insforge;
