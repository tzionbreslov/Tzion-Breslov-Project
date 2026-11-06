#!/usr/bin/env node
// One-time Resend setup for the forms Worker, driven by the git-ignored
// .env.worker (see README → Launch checklist). Idempotent: re-running reuses
// what exists. NEVER prints a secret — only names, ids and statuses.
//
//   node scripts/setup-resend.mjs            # domain, topic, webhook, send-only key
//   node scripts/setup-resend.mjs --verify   # after the DNS records exist: verify + report status
//
// Writes into .env.worker: RESEND_NEWSLETTER_TOPIC_ID, RESEND_EVENTS_TOPIC_ID,
// RESEND_WEBHOOK_SECRET, RESEND_TRANSACTIONAL_API_KEY (a new send-only key
// restricted to the domain). A missing line for one of these is added; no other
// line is ever written (TURNSTILE_SECRET_KEY lives only in Cloudflare and must
// never be in .env.worker, or a --secrets-file upload would overwrite it).
// Writes the domain's PUBLIC DNS records to .tmp/resend-dns.json for Cloudflare.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.worker");
const DOMAIN = "tzionbreslov.org";
const WEBHOOK_URL = "https://api.tzionbreslov.org/webhooks/resend";
// Both topics default to opt_out: nobody is on a list until they confirm (cannot be changed later).
const TOPICS = [
  { name: "Newsletter", key: "RESEND_NEWSLETTER_TOPIC_ID", description: "Tzion Breslov classes, teachings and updates." },
  { name: "Event announcements", key: "RESEND_EVENTS_TOPIC_ID", description: "Tzion Breslov event announcements." }
];
// Deliverability/audit signals only (the Worker stores every event it receives for 90 days).
const WEBHOOK_EVENTS = ["email.bounced", "email.complained", "email.delivery_delayed", "email.failed", "email.suppressed", "contact.topics.updated", "contact.deleted", "suppression.added"];
// The only .env.worker lines this script writes: values it creates in Resend (or, for
// RESEND_CONTACTS_API_KEY, the owner's own key moved from RESEND_FULL_ACCESS_API_KEY).
const OWNED_KEYS = new Set(["RESEND_CONTACTS_API_KEY", "RESEND_TRANSACTIONAL_API_KEY", "RESEND_WEBHOOK_SECRET", ...TOPICS.map((topic) => topic.key)]);

const readEnv = () => fs.readFileSync(envFile, "utf8");
const getVar = (text, key) => (text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "").trim();
/** Sets KEY=value in .env.worker, adding the line when it is missing (owned keys only). */
function setVar(key, value) {
  if (!OWNED_KEYS.has(key)) throw new Error(`setup-resend never writes ${key} to .env.worker`);
  const text = readEnv();
  if (new RegExp(`^${key}=`, "m").test(text)) {
    fs.writeFileSync(envFile, text.replace(new RegExp(`^${key}=.*$`, "m"), () => `${key}=${value}`));
    return;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const separator = text === "" || text.endsWith("\n") ? "" : eol;
  fs.writeFileSync(envFile, `${text}${separator}${key}=${value}${eol}`);
  console.log(`added the missing ${key} line to .env.worker`);
}

// Accept the key under RESEND_FULL_ACCESS_API_KEY too: move it into the slot the
// Worker uses (Contacts API needs full access) and drop the extra line, so only
// the Worker's real secret names are ever uploaded.
{
  const text = readEnv();
  const full = getVar(text, "RESEND_FULL_ACCESS_API_KEY");
  if (full && !getVar(text, "RESEND_CONTACTS_API_KEY")) {
    setVar("RESEND_CONTACTS_API_KEY", full);
    fs.writeFileSync(envFile, readEnv().replace(/^RESEND_FULL_ACCESS_API_KEY=.*\r?\n?/m, ""));
    console.log("moved RESEND_FULL_ACCESS_API_KEY → RESEND_CONTACTS_API_KEY");
  }
}

const env = readEnv();
const adminKey = getVar(env, "RESEND_CONTACTS_API_KEY") || getVar(env, "RESEND_TRANSACTIONAL_API_KEY");
if (!adminKey) throw new Error("No Resend key in .env.worker (RESEND_CONTACTS_API_KEY).");
if (!adminKey.startsWith("re_")) throw new Error("The Resend key in .env.worker does not start with re_ — check the paste.");

async function api(method, p, body) {
  const res = await fetch(`https://api.resend.com${p}`, {
    method,
    headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", "User-Agent": "tzion-breslov-setup/1.0" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`${method} ${p} → HTTP ${res.status} ${data?.name ?? ""}: ${String(data?.message ?? "").slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
const list = async (p) => (await api("GET", p))?.data ?? [];

async function domainRecord() {
  const existing = (await list("/domains")).find((d) => d.name === DOMAIN);
  const id = existing?.id ?? (await api("POST", "/domains", { name: DOMAIN, region: "us-east-1" })).id;
  return api("GET", `/domains/${id}`);
}

async function main() {
  // A sending-only key cannot list domains: tell the owner instead of failing obscurely.
  try { await api("GET", "/domains"); } catch (error) {
    if (error.status === 401 || error.status === 403) {
      console.log("The key in .env.worker is a SENDING-ONLY key. Setup needs a FULL-ACCESS key (Resend → API Keys → Create → Full access) in RESEND_CONTACTS_API_KEY.");
      process.exit(2);
    }
    throw error;
  }

  if (process.argv.includes("--verify")) {
    const d = await domainRecord();
    await api("POST", `/domains/${d.id}/verify`);
    await new Promise((r) => setTimeout(r, 8_000));
    const after = await api("GET", `/domains/${d.id}`);
    console.log(`domain ${after.name}: ${after.status}`);
    for (const r of after.records ?? []) console.log(`  ${r.record.padEnd(6)} ${r.type.padEnd(5)} ${r.name.padEnd(20)} ${r.status}`);
    return;
  }

  // 1. Sending domain → public DNS records for Cloudflare.
  const d = await domainRecord();
  fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
  const records = (d.records ?? []).map(({ record, name, type, value, priority, ttl, status }) => ({ record, name, type, value, priority, ttl, status }));
  fs.writeFileSync(path.join(root, ".tmp", "resend-dns.json"), `${JSON.stringify({ domain: d.name, id: d.id, status: d.status, records }, null, 2)}\n`);
  console.log(`domain ${d.name}: ${d.status} (${records.length} DNS records → .tmp/resend-dns.json)`);

  // 2. The two topics (lists): "Newsletter" and "Event announcements". Default
  //    opt_out: nobody is subscribed until they confirm (cannot be changed later).
  const existingTopics = await list("/topics");
  for (const { name, key, description } of TOPICS) {
    let topic = existingTopics.find((t) => t.name === name);
    if (!topic) topic = await api("POST", "/topics", { name, default_subscription: "opt_out", description });
    setVar(key, topic.id);
    console.log(`topic "${name}": ${topic.id}`);
  }

  // 3. Webhook (its signing secret is only returned at creation).
  const hook = (await list("/webhooks")).find((w) => w.endpoint === WEBHOOK_URL);
  if (!hook) {
    const created = await api("POST", "/webhooks", { endpoint: WEBHOOK_URL, events: WEBHOOK_EVENTS });
    setVar("RESEND_WEBHOOK_SECRET", created.signing_secret);
    console.log(`webhook created (${created.id}); signing secret saved to .env.worker`);
  } else if (!getVar(readEnv(), "RESEND_WEBHOOK_SECRET")) {
    console.log(`webhook ${hook.id} already exists but its secret isn't in .env.worker — delete it in Resend (or ask Claude) and re-run.`);
  } else {
    console.log(`webhook ${hook.id} already exists; secret already saved`);
  }

  // 4. Least privilege: the Worker sends with a key that can only send, only from this domain.
  if (!getVar(readEnv(), "RESEND_TRANSACTIONAL_API_KEY")) {
    const key = await api("POST", "/api-keys", { name: "tzion-breslov-api send-only", permission: "sending_access", domain_id: d.id });
    setVar("RESEND_TRANSACTIONAL_API_KEY", key.token);
    console.log(`send-only key created (${key.id}); saved to .env.worker`);
  } else {
    console.log("RESEND_TRANSACTIONAL_API_KEY already set; left unchanged");
  }

  const final = readEnv();
  const filled = ["RESEND_CONTACTS_API_KEY", "RESEND_TRANSACTIONAL_API_KEY", "RESEND_FROM_EMAIL", "CONTACT_TO_EMAIL", "RESEND_NEWSLETTER_TOPIC_ID", "RESEND_EVENTS_TOPIC_ID", "RESEND_WEBHOOK_SECRET", "RATE_LIMIT_SALT"]
    .map((k) => `${k}=${getVar(final, k) ? "set" : "MISSING"}`);
  console.log(filled.join("  "));
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
