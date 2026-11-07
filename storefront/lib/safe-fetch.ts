import "server-only";
import { lookup } from "node:dns";
import https from "node:https";
import net from "node:net";
import type { IncomingMessage } from "node:http";

// SSRF guard for admin URL ingest: https only, no credentials, public addresses only (checked at connect
// time, so DNS rebinding can't swap in a private IP), redirects re-validated hop by hop, hard timeout.

function ipv4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (/^f[cd]/.test(v)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(v)) return true; // fe80::/10 link-local
  if (/^ff/.test(v)) return true; // multicast
  if (/^(64:ff9b|2001:db8|2001:0?:)/.test(v)) return true; // NAT64, documentation, Teredo
  return !net.isIPv6(v);
}

export class IngestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function checkUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new IngestError("url must be a valid URL");
  }
  if (u.protocol !== "https:") throw new IngestError("url must be https");
  if (u.username || u.password) throw new IngestError("url must not contain credentials");
  if (u.port && u.port !== "443") throw new IngestError("url must use the default https port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new IngestError("url host is not allowed");
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new IngestError("url host is a private address");
  return u;
}

const guardedLookup: typeof lookup = ((hostname: string, options: object, cb: (...a: unknown[]) => void) => {
  lookup(hostname, { ...(options as object), all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as unknown as { address: string; family: number }[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return cb(new IngestError("url host resolves to a private address"));
    const wantAll = (options as { all?: boolean }).all;
    if (wantAll) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}) as typeof lookup;

function get(u: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.get(u, { lookup: guardedLookup, signal, headers: { "user-agent": "hallucinated-store-ingest/1" } }, resolve);
    req.on("error", reject);
  });
}

// Returns the response stream for a public https URL, following at most 3 validated redirects.
export async function safeGet(raw: string, signal: AbortSignal): Promise<{ res: IncomingMessage; url: URL }> {
  let u = checkUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await get(u, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      u = checkUrl(new URL(res.headers.location, u));
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new IngestError(`source answered ${status}`, 502);
    }
    return { res, url: u };
  }
  throw new IngestError("too many redirects", 502);
}
