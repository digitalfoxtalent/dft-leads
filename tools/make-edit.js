// Make blueprint editing helpers (Claude, 23 Oct 2026). Loaded into a us2.make.com scenario editor tab to change
// scenarios without anyone copying blueprint JSON by hand: Make's own "Copy blueprint" / "Paste blueprint" menu
// items are routed through this page's memory (nothing downloaded, real clipboard untouched), the edit is done by
// code below, and the result is checked before saving. Holds no secrets. Public on purpose so a Make tab can load it.
(function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__cap = null; window.__pasteText = null;
  const cb = navigator.clipboard;
  try { Object.defineProperty(cb, 'writeText', { configurable: true, value: async t => { window.__cap = String(t); } }); } catch (e) { cb.writeText = async t => { window.__cap = String(t); }; }
  try { Object.defineProperty(cb, 'readText', { configurable: true, value: async () => window.__pasteText || '' }); } catch (e) { cb.readText = async () => window.__pasteText || ''; }
  window.__sleep = sleep;
  window.__menu = async text => {
    const opts = [...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') || '') === 'Options' && b.offsetParent);
    const btn = opts[opts.length - 1]; if (!btn) return 'no options button';
    btn.click(); await sleep(700);
    const item = [...document.querySelectorAll('[role=menuitem]')].find(e => e.offsetParent && e.textContent.trim() === text);
    if (!item) { document.body.click(); return 'no item ' + text; }
    item.click(); await sleep(1500); return 'clicked ' + text;
  };
  window.__edit = async () => { const b = [...document.querySelectorAll('button')].find(e => e.offsetParent && /^\s*Edit\s*$/.test(e.textContent)); if (b) { b.click(); await sleep(3500); return 'edit opened'; } return 'already editing'; };
  window.__copyOut = async () => { window.__cap = null; await window.__menu('Copy blueprint to clipboard'); return window.__cap; };
  window.__pasteIn = async json => { window.__pasteText = json; return window.__menu('Paste blueprint from clipboard'); };
  window.__strip = b => { const out = []; const walk = l => { for (const m of l) { out.push({ id: m.id, module: m.module, version: m.version, parameters: m.parameters, mapper: m.mapper, filter: m.filter || null }); for (const r of (m.routes || [])) walk(r.flow); } }; walk(b.flow); return JSON.stringify(out); };
  window.__save = async () => { const b = [...document.querySelectorAll('button, [role=button], div')].find(e => e.offsetParent && e.textContent.trim() === 'Save' && e.closest && !e.closest('[role=dialog]')); if (!b) return 'no save'; b.click(); await sleep(2500); return /saved/i.test(document.body.innerText) ? 'saved' : 'clicked save'; };
window.__PACK = "// Packs this module's inputs for the Ecosystem job (Claude, 23 Oct 2026).\nreturn { body: JSON.stringify({ input }) };\n";
window.__UNPACK = "// Unpacks the Ecosystem job's answer so later modules see the same result as before (Claude, 23 Oct 2026).\nlet r = input.resp;\nif (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { throw new Error('Ecosystem job answer was not JSON: ' + String(r).slice(0, 200)); } }\nif (!r || r.ok !== true) throw new Error('Ecosystem job failed: ' + String((r && r.error) || JSON.stringify(r)).slice(0, 300));\nreturn r.result;\n";
window.__KEYQ = /\s*(?:keys:\s*)?items\(ids:\s*\[[\d,\s]+\]\)\s*\{\s*id\s+column_values\(ids:\s*\[\s*"text_mm5bcxe7"\s*\]\)\s*\{\s*text\s*\}\s*\}/;
window.__toJobs = function (bp, ECO_KID) {
  const flow = bp.flow, report = [];
  const ids = flow.map(m => m.id); let next = Math.max(...ids) + 1;
  const codeMods = flow.filter(m => m.module === 'code:ExecuteCode' && /^\{\{(\d+)\.payload\}\}$/.test(String(m.mapper.codeStringJavascript || '')));
  for (const c of codeMods) {
    const g = flow.find(m => m.id === Number(c.mapper.codeStringJavascript.match(/\{\{(\d+)\./)[1]));
    if (!g || g.module !== 'datastore:GetRecord') { report.push('skip ' + c.id + ': no code record'); continue; }
    const job = g.mapper.key;
    if (!['code-A', 'code-B', 'code-C', 'code-E', 'code-F', 'code-H'].includes(job)) { report.push('skip ' + c.id + ': ' + job + ' needs no keys'); continue; }
    const inputs = c.mapper.input.filter(i => i.name !== 'src');
    const P = { id: next++, module: 'code:ExecuteCode', version: c.version, mapper: { input: inputs, language: 'javascript', inputFormat: 'string', codeStringJavascript: window.__PACK }, metadata: { designer: { x: 0, y: 0 } } };
    const H = { id: next++, module: 'http:ActionSendDataAPIKeyAuth', version: 3, parameters: { auth: ECO_KID, handleErrors: true, useNewZLibDeCompress: true },
      mapper: { url: 'https://ecosystem.digitalfoxtalent.com/api/v1/jobs/' + job, method: 'post', headers: [], qs: [], bodyType: 'raw', contentType: 'application/json', data: '{{' + P.id + '.result.body}}',
        parseResponse: true, timeout: 300, serializeUrl: false, shareCookies: false, rejectUnauthorized: true, followRedirect: false, useQuerystring: false, gzip: true, useMtls: false }, metadata: { designer: { x: 0, y: 0 } } };
    if (c.filter) { P.filter = c.filter; delete c.filter; }
    c.mapper = { input: [{ name: 'resp', value: '{{' + H.id + '.data}}' }], language: 'javascript', inputFormat: 'string', codeStringJavascript: window.__UNPACK };
    flow.splice(flow.indexOf(c), 0, P, H);
    // the code record is no longer read, unless something else uses it
    const uses = JSON.stringify(flow.filter(m => m !== g)).split('{{' + g.id + '.').length - 1;
    if (uses === 0) { flow.splice(flow.indexOf(g), 1); report.push('removed record read ' + g.id); }
    report.push(job + ': code ' + c.id + ' -> pack ' + P.id + ', job ' + H.id + ', unpack ' + c.id);
  }
  // monday no longer needs to hand over the keys
  for (const m of flow) if (m.module === 'monday:ExecuteGraphQLQueryV2' && window.__KEYQ.test(m.mapper.queryBody || '')) {
    m.mapper.queryBody = m.mapper.queryBody.replace(window.__KEYQ, ''); report.push('keys query removed from ' + m.id);
  }
  flow.forEach((m, i) => { m.metadata = m.metadata || {}; m.metadata.designer = Object.assign({}, m.metadata.designer || {}, { x: i * 300, y: 0 }); });
  if (/18422548864|text_mm5bcxe7|12562178538|13142175799|12561999483|12562117402/.test(JSON.stringify(flow))) report.push('WARNING: still mentions the API Keys board');
  return { bp, report };
};

// Group 1: HTTP modules that called Claude, Apify or YouTube with a key -> the same call through the Ecosystem relay.
window.__RELAY = 'https://ecosystem.digitalfoxtalent.com/api/v1/relay/';
window.__KEYITEMS = /12562178538|13142175799|12561999483|12562117402|12634208127/;
window.__toRelay = function (bp, ECO_KID, opts = {}) {
  const report = [];
  const all = []; const walk = list => { for (const m of list) { all.push(m); for (const r of (m.routes || [])) walk(r.flow); } }; walk(bp.flow);
  const keyMods = all.filter(m => m.module === 'monday:ExecuteGraphQLQueryV2' && window.__KEYITEMS.test(m.mapper.queryBody || '') && /text_mm5bcxe7/.test(m.mapper.queryBody || ''));
  const keyRef = new RegExp('\\{\\{[^}]*\\b(' + keyMods.map(m => m.id).join('|') + ')\\.body[^}]*\\}\\}');
  const svcOf = host => ({ 'api.anthropic.com': 'anthropic', 'api.apify.com': 'apify', 'www.googleapis.com': 'youtube' })[host];
  for (const m of all) {
    const isV3 = m.module === 'http:ActionSendData', isV4 = m.module === 'http:MakeRequest';
    if (!isV3 && !isV4) continue;
    const url = String(m.mapper.url || '');
    const hm = /^https:\/\/([^/?]+)\/([^?]*)(\?.*)?$/.exec(url);
    if (!hm || !svcOf(hm[1])) continue;
    const svc = svcOf(hm[1]);
    const headers = (isV3 ? m.mapper.headers : m.mapper.headers) || [];
    const carriesKey = keyRef.test(url) || headers.some(h => /^(x-api-key|authorization)$/i.test(h.name)) || (m.mapper.qs || m.mapper.queryParameters || []).some(q => /^(key|token)$/i.test(q.key || q.name || ''));
    if (!carriesKey) { report.push('left ' + m.id + ' (no key)'); continue; }
    let rest = hm[2], query = (hm[3] || '').replace(/^\?/, '');
    query = query.split('&').filter(p => p && !/^(key|token)=/i.test(p)).join('&');
    const newUrl = window.__RELAY + svc + '/' + (svc === 'youtube' ? rest : rest) + (query ? '?' + query : '');
    const keepHeaders = headers.filter(h => !/^(x-api-key|authorization)$/i.test(h.name));
    if (isV3) {
      m.module = 'http:ActionSendDataAPIKeyAuth';
      m.parameters = { auth: ECO_KID, handleErrors: !!(m.parameters || {}).handleErrors, useNewZLibDeCompress: true };
      m.mapper.url = newUrl; m.mapper.headers = keepHeaders;
      if (m.mapper.qs) m.mapper.qs = m.mapper.qs.filter(q => !/^(key|token)$/i.test(q.key || q.name || ''));
      m.mapper.followRedirect = false;
    } else {
      m.parameters = Object.assign({}, m.parameters, { authenticationType: 'apiKey', apiKeyKeychain: ECO_KID });
      m.mapper.url = newUrl; m.mapper.headers = keepHeaders;
      if (m.mapper.queryParameters) m.mapper.queryParameters = m.mapper.queryParameters.filter(q => !/^(key|token)$/i.test(q.name || ''));
    }
    // contracts: pass the file by its monday link instead of inlining it
    if (opts.pdfUrl && /__PDF_B64__/.test(String(m.mapper.data || ''))) {
      const before = m.mapper.data;
      m.mapper.data = before.replace(/^\{\{replace\((.*); "__PDF_B64__"; base64\(\d+\.data\)\)(.*)\}\}$/, (all, inner, tail) => '{{' + inner + tail + '}}');
      if (m.mapper.data === before) throw new Error('could not find the PDF placeholder pattern in ' + m.id);
      m.mapper.headers.push({ name: 'x-eco-pdf-url', value: opts.pdfUrl });
      report.push('contract file passed by link on ' + m.id);
    }
    report.push(svc + ': ' + m.id + ' -> relay ' + newUrl.replace(/\{\{[^}]*\}\}/g, '{..}'));
  }
  // modules that only read the API Keys board are no longer needed
  const text = JSON.stringify(bp.flow);
  for (const km of keyMods) {
    const used = text.split('{{' + km.id + '.').length - 1;
    const onlyKeys = /^query \{ items\(ids:\[[\d,]+\]\) \{ (id )?column_values\(ids:\["text_mm5bcxe7"\]\) \{ text \} \} \}$/.test(km.mapper.queryBody.trim());
    if (used === 0 && onlyKeys) {
      const drop = list => { const i = list.indexOf(km); if (i >= 0) { list.splice(i, 1); return true; } return list.some(x => (x.routes || []).some(r => drop(r.flow))); };
      drop(bp.flow); report.push('removed key read ' + km.id);
    } else report.push('kept ' + km.id + ' (used ' + used + ', onlyKeys ' + onlyKeys + ')');
  }
  // the downloaded contract file is no longer needed if nothing maps it
  if (opts.dropModule) {
    const t2 = JSON.stringify(bp.flow);
    if (t2.split('{{' + opts.dropModule + '.').length - 1 === 0) {
      const drop = list => { const i = list.findIndex(x => x.id === opts.dropModule); if (i >= 0) { list.splice(i, 1); return true; } return list.some(x => (x.routes || []).some(r => drop(r.flow))); };
      if (drop(bp.flow)) report.push('removed file download ' + opts.dropModule);
    }
  }
  if (window.__KEYITEMS.test(JSON.stringify(bp.flow))) report.push('WARNING: still mentions a key item');
  return { bp, report };
};
  window.__fixFilters = function (beforeJson, bp) {
    const before = JSON.parse(beforeJson), out = [];
    const flows = b => { const res = []; const walk = list => { res.push(list); for (const m of list) for (const r of (m.routes || [])) walk(r.flow); }; walk(b.flow); return res; };
    const afterIds = new Set(); flows(bp).forEach(l => l.forEach(m => afterIds.add(m.id)));
    const find = (b, id) => { for (const l of flows(b)) { const m = l.find(x => x.id === id); if (m) return m; } return null; };
    for (const list of flows(before)) list.forEach((m, i) => {
      if (afterIds.has(m.id) || !m.filter) return;
      let j = i + 1; while (j < list.length && !afterIds.has(list[j].id)) j++;
      const nxt = j < list.length ? find(bp, list[j].id) : null;
      if (!nxt) { out.push('LOST filter of ' + m.id); return; }
      if (!nxt.filter) nxt.filter = JSON.parse(JSON.stringify(m.filter));
      else { const a = m.filter.conditions, b = nxt.filter.conditions; const merged = []; for (const x of a) for (const y of b) merged.push(x.concat(y)); nxt.filter = { name: m.filter.name + ' + ' + nxt.filter.name, conditions: merged }; }
      out.push('moved filter "' + m.filter.name + '" from ' + m.id + ' to ' + nxt.id);
    });
    return out;
  };
  window.__ready = 'make-edit tools ready';
})();
