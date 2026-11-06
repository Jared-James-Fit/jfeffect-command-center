// Runs the real app (local vite dev) as a made-up athlete, with every Supabase call and the
// server functions a screen needs answered from fixtures. Nothing touches the real database.
const { chromium } = require('playwright');
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync(require('path').join(process.cwd(), '.env'),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]}));
const SB = env.VITE_SUPABASE_URL.replace(/\/$/,'');
const REF = new URL(SB).hostname.split('.')[0];
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now()/1000) + 3600*24;
const jwt = `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:USER_ID,role:'authenticated',aud:'authenticated',exp,email:'demo.athlete@example.com'})}.sig`;
const user = { id: USER_ID, aud:'authenticated', role:'authenticated', email:'demo.athlete@example.com', email_confirmed_at:'2026-01-01T00:00:00Z', created_at:'2025-06-01T00:00:00Z', app_metadata:{provider:'email'}, user_metadata:{ first_name:'Alex' } };
const session = { access_token: jwt, refresh_token:'demo-refresh', token_type:'bearer', expires_in: 3600*24, expires_at: exp, user };

module.exports.run = async function run({ initScript, serverFnMocks = {}, files = {}, path, fixtures = {}, rpc = {}, width = 390, height = 844, scale = 1, out, waitFor, before, theme = 'dark', log = true, afterLoad }) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: true, hasTouch: true, timezoneId: 'America/Winnipeg', colorScheme: theme, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(([key, s, extra]) => {
    try { localStorage.setItem(key, JSON.stringify(s)); for (const [k,v] of Object.entries(extra||{})) localStorage.setItem(k, v); } catch {}
  }, [`sb-${REF}-auth-token`, session, before || {}]);
  if (initScript) await ctx.addInitScript(initScript);
  const seen = new Map();
  await ctx.route(u => u.href.startsWith(SB), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const accept = req.headers()['accept'] || '';
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p.startsWith('/auth/v1/user')) return json(user);
    if (p.startsWith('/auth/v1/token')) return json(session);
    if (p.startsWith('/auth/v1')) return json({});
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      const key = 'rpc:' + fn; seen.set(key, (seen.get(key)||0)+1);
      let v = rpc[fn];
      if (typeof v === 'function') v = v(url, req.postDataJSON?.() ?? null);
      return json(v === undefined ? null : v);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      const key = req.method() + ' ' + table; seen.set(key, (seen.get(key)||0)+1);
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return json([], 201);
      let rows = fixtures[table];
      if (typeof rows === 'function') rows = rows(url);
      rows = [...(rows ?? [])];
      const ord = url.searchParams.get('order');
      if (ord) { const [col, dir] = ord.split(',')[0].split('.'); rows.sort((a, b) => { const x = a[col], y = b[col]; if (x === y) return 0; const r = x > y ? 1 : -1; return dir === 'desc' ? -r : r; }); }
      const lim = Number(url.searchParams.get('limit')); if (lim) rows = rows.slice(0, lim);
      const range = `0-${Math.max(rows.length-1,0)}/${rows.length}`;
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': range, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
      if (accept.includes('vnd.pgrst.object')) return rows.length ? json(rows[0]) : json({ code:'PGRST116', message:'0 rows' }, 406);
      return json(rows, 200, { 'content-range': range });
    }
    if (p.startsWith('/storage/v1/object/sign')) { return json({ signedURL: '/storage/v1/object/public/x/demo.jpg', signedUrl: SB + '/storage/v1/object/public/x/demo.jpg' }); }
    if (p.startsWith('/storage/v1')) { seen.set('storage ' + p, 1); return route.fulfill({ status: 404, body: '' }); }
    if (p.startsWith('/functions/v1')) { seen.set('fn ' + p, 1); return json({}); }
    seen.set('other ' + p, 1);
    return json({});
  });
  await ctx.route('https://demo.local/**', (route) => { const f = files[new URL(route.request().url()).pathname]; return f ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: '' }); });
  await ctx.route('**/_serverFn/**', (route) => {
    const id = route.request().url().split('?')[0].split('/').pop();
    let d = ''; try { d = Buffer.from(decodeURIComponent(id), 'base64').toString(); } catch {}
    const name = Object.keys(serverFnMocks).find(k => d.includes('"' + k + '_createServerFn'));
    if (!name) return route.continue();
    let v = serverFnMocks[name]; if (typeof v === 'function') v = v(route.request());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: v, context: {} }) });
  });
  const serverFns = [];
  const page = await ctx.newPage();
  page.on('request', r => { if (r.url().includes('/_serverFn/')) { const id = r.url().split('?')[0].split('/').pop(); let d = id; try { d = Buffer.from(decodeURIComponent(id), 'base64').toString(); } catch {} serverFns.push(d.slice(0,140)); }; });
  page.on('pageerror', e => log && console.log('PAGEERROR', e.message.slice(0, 300)));
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (waitFor) { try { await page.waitForSelector(waitFor, { timeout: 60000 }); } catch (e) { console.log('waitFor timeout', waitFor); } }
  await page.waitForTimeout(Number(process.env.WAIT||4000));
  if (afterLoad) await afterLoad(page);
  if (out) await page.screenshot({ path: out });
  if (log) { console.log('REQUESTS:'); for (const [k, n] of [...seen.entries()].sort()) console.log('  ', k, n); console.log('SERVERFNS', serverFns.length, [...new Set(serverFns)].join(',')); }
  const text = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  await b.close();
  return { text };
};
