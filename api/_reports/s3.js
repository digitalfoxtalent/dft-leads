// Minimal read-only S3 client (AWS Signature Version 4), so the server needs no AWS SDK.
// Used for the Megaphone Metrics Export bucket. Only GET: list objects and read one object.

import crypto from "node:crypto";

const hmac = (key, s) => crypto.createHmac("sha256", key).update(s, "utf8").digest();
const sha256hex = s => crypto.createHash("sha256").update(s).digest("hex");
// RFC 3986: everything except A-Z a-z 0-9 - _ . ~ is percent-encoded (AWS's rule for SigV4).
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = p => p.split("/").map(enc).join("/");

// Returns the headers to send. headers: extra headers to sign (lower-case names), e.g. { range: "bytes=0-9" }.
export function signV4({ method = "GET", host, path = "/", query = {}, headers = {}, region, service = "s3", keyId, secret, now = new Date(), payloadHash = sha256hex("") }) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const h = Object.assign({}, headers, { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate });
  const names = Object.keys(h).map(k => k.toLowerCase()).sort();
  const lower = {}; for (const k of Object.keys(h)) lower[k.toLowerCase()] = String(h[k]).trim().replace(/\s+/g, " ");
  const canonicalHeaders = names.map(n => n + ":" + lower[n] + "\n").join("");
  const signedHeaders = names.join(";");
  const canonicalQuery = Object.keys(query).sort().map(k => enc(k) + "=" + enc(String(query[k]))).join("&");
  const canonicalRequest = [method, encPath(path), canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = date + "/" + region + "/" + service + "/aws4_request";
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + secret, date), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  const out = {}; for (const n of names) if (n !== "host") out[n] = lower[n];
  out.authorization = "AWS4-HMAC-SHA256 Credential=" + keyId + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  return { headers: out, signature, canonicalQuery };
}

export function s3Client({ bucket, region, keyId, secret, timeoutMs = 20000 }) {
  const host = bucket + ".s3." + region + ".amazonaws.com";
  const get = async (path, query = {}) => {
    const { headers, canonicalQuery } = signV4({ host, path, query, region, keyId, secret });
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch("https://" + host + encPath(path) + (canonicalQuery ? "?" + canonicalQuery : ""), { headers, signal: ctl.signal });
      if (!r.ok) throw new Error("S3 " + r.status + " " + (await r.text()).replace(/\s+/g, " ").slice(0, 200));
      return r;
    } finally { clearTimeout(t); }
  };
  return {
    // All keys under a prefix (ListObjectsV2, paged).
    async list(prefix) {
      const keys = []; let token = "", guard = 0;
      do {
        const q = { "list-type": "2", prefix }; if (token) q["continuation-token"] = token;
        const xml = await (await get("/", q)).text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, "&"));
        token = (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] || "";
      } while (token && guard++ < 50);
      return keys;
    },
    async getBuffer(key) { return Buffer.from(await (await get("/" + key)).arrayBuffer()); },
  };
}
