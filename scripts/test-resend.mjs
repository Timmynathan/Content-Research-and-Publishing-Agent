// One-off diagnostic: sends a single test email via Resend using the
// current .env values, completely outside the app's queue/pipeline
// logic. Isolates "does Resend actually deliver with this config" from
// everything else. Safe to delete after use.
//
// Usage: node scripts/test-resend.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resend } from "resend";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(rootDir, ".env"));
loadEnvFile(join(rootDir, ".env.local"));

const { RESEND_API_KEY, RESEND_FROM, RESEND_TEST_RECIPIENT } = process.env;

for (const [name, value] of [
  ["RESEND_API_KEY", RESEND_API_KEY],
  ["RESEND_FROM", RESEND_FROM],
  ["RESEND_TEST_RECIPIENT", RESEND_TEST_RECIPIENT],
]) {
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
}

console.log(`Sending from ${RESEND_FROM} to ${RESEND_TEST_RECIPIENT}...`);

const resend = new Resend(RESEND_API_KEY);
const result = await resend.emails.send({
  from: RESEND_FROM,
  to: RESEND_TEST_RECIPIENT,
  subject: "Resend config test",
  text: `This is a standalone test send, sent directly at ${new Date().toISOString()}, bypassing the app entirely.`,
});

if (result.error) {
  console.error("Resend returned an error:");
  console.error(result.error);
  process.exit(1);
}

console.log("Success. Message id:", result.data?.id);
console.log("Search for this exact id in the Resend dashboard's Emails log.");
