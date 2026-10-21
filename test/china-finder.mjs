// Replays one China finder run with monday and Claude mocked: checks dedupe, date windows, the Chinese-name rule and
// the exact column values written. Run: node test/china-finder.mjs
import assert from 'node:assert/strict';
const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
const inDays = n => iso(new Date(today.getTime() + n * 86400000));
const writes = [];
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  if (String(url).includes('monday.com')) {
    if (/create_item/.test(body.query)) { writes.push(body.variables); return { json: async () => ({ data: { create_item: { id: String(100 + writes.length) } } }) }; }
    return { json: async () => ({ data: { boards: [{ items_page: { cursor: null, items: [{ name: 'Arknights: Endfield', column_values: [{ text: 'Game release' }] }] } }] } }) };
  }
  const arr = [
    { name: 'Arknights: Endfield (Global)', company_en: 'Hypergryph', company_cn: '鹰角网络', company_domain: 'https://www.hypergryph.com/', key_date: inDays(20), date_confidence: 'firm', budget_tier: 'High', niche: 'Gaming / RPG', why: 'Big Western launch.', source_url: 'https://example.com/a' },
    { name: 'Wuthering Waves 3.0', company_en: 'Kuro Games', company_cn: 'Kuro', company_domain: 'kurogame.com', key_date: inDays(40), date_confidence: 'approximate', budget_tier: 'Mega', niche: 'Gaming / Action RPG', why: 'Major update.', source_url: 'https://example.com/b' },
    { name: 'Too Far Out', company_en: 'NetEase', key_date: inDays(400) },
    { name: 'No Company', key_date: inDays(10) },
    { name: 'Wuthering Waves 3.0', company_en: 'Kuro Games', key_date: inDays(41) }
  ];
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(arr) }] }) };
};
process.env.MONDAY_API_KEY = 'x'; process.env.ANTHROPIC_API_KEY = 'y'; process.env.CRON_SECRET = 'z';
const mod = await import('../api/china-finder.js');
let out;
await mod.default({ headers: { 'user-agent': 'vercel-cron/1.0' }, query: { type: 'game' } }, { status() { return this; }, json(o) { out = o; return o; } });
console.log(JSON.stringify({ added: out.added, skipped: out.skipped }, null, 1));
// Two search windows return the same list, so the first copy of each valid entry is added once.
assert.equal(out.added.length, 1, 'only Wuthering Waves is new (Arknights is a duplicate of the existing row)');
assert.equal(writes.length, 1);
const v = JSON.parse(writes[0].v), C = mod.COL;
assert.equal(writes[0].n, 'Wuthering Waves 3.0');
assert.deepEqual(v[C.type], { label: 'Game release' });
assert.deepEqual(v[C.status], { label: 'Not started' });
assert.equal(v[C.domain], 'kurogame.com');
assert.equal(v[C.cn], undefined, 'a Chinese name without Chinese characters is not written');
assert.equal(v[C.budget], undefined, 'an unknown budget label is not written');
assert.match(v[C.notes].text, /^Date approximate/);
assert.ok(out.skipped.some(s => /Arknights.*already on the board/.test(s)));
assert.ok(out.skipped.some(s => /Too Far Out: outside window/.test(s)));
assert.ok(out.skipped.some(s => /No Company: no company/.test(s)));
// Brand spend only takes recent past dates.
const r = mod.toRow({ name: 'Anker', company_en: 'Anker Innovations', key_date: inDays(-10) }, 'spend', today);
assert.ok(!r.skip); assert.deepEqual(r.cols[C.type], { label: 'Brand spend' });
assert.ok(mod.toRow({ name: 'Old', company_en: 'X', key_date: inDays(-200) }, 'spend', today).skip);
assert.ok(mod.toRow({ name: 'Future', company_en: 'X', key_date: inDays(5) }, 'spend', today).skip);
const h = mod.toRow({ name: 'Arknights: Endfield (Global)', company_en: 'Hypergryph', company_cn: '鹰角网络', company_domain: 'https://www.hypergryph.com/', key_date: inDays(20) }, 'game', today);
assert.equal(h.cols[C.cn], '鹰角网络'); assert.equal(h.cols[C.domain], 'hypergryph.com');
console.log('china-finder: all checks passed');
