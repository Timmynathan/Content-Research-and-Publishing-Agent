// One-off local script: creates Supabase Auth users and their matching
// `staff` rows from scripts/seed-staff.config.json (gitignored — never
// commit real credentials). Safe to re-run: existing users are reused,
// staff rows are upserted.
//
// Usage:
//   1. Fill in .env at the project root with SUPABASE_URL and
//      SUPABASE_SERVICE_ROLE_KEY (Project Settings > API in Supabase).
//   2. Copy scripts/seed-staff.config.example.json to
//      scripts/seed-staff.config.json and fill in real emails/passwords.
//   3. node scripts/seed-staff.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocket as NodeWebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";

// supabase-js unconditionally constructs a realtime client (which needs
// a WebSocket constructor) as soon as createClient() runs. Node < 22 has
// no native global WebSocket, so without this the script throws on
// startup. No-op on Node >= 22.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = NodeWebSocket;
}

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(rootDir, ".env"));
loadEnvFile(join(rootDir, ".env.local"));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to a .env file at the project root first.",
  );
  process.exit(1);
}

const configPath = join(rootDir, "scripts", "seed-staff.config.json");
if (!existsSync(configPath)) {
  console.error(
    `Missing ${configPath}.\nCopy scripts/seed-staff.config.example.json to scripts/seed-staff.config.json and fill in real emails/passwords/roles first.`,
  );
  process.exit(1);
}

const entries = JSON.parse(readFileSync(configPath, "utf8"));

if (!Array.isArray(entries) || entries.length === 0) {
  console.error("seed-staff.config.json must be a non-empty array.");
  process.exit(1);
}

for (const entry of entries) {
  if (!entry.email || !entry.password || !["manager", "reviewer"].includes(entry.role)) {
    console.error(`Invalid entry (needs email, password, role of 'manager' or 'reviewer'): ${JSON.stringify({ ...entry, password: "***" })}`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  // Admin API has no direct "get by email"; page through listUsers.
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function main() {
  for (const entry of entries) {
    const { email, password, role, displayName } = entry;
    console.log(`\n--- ${email} (${role}) ---`);

    let user = await findUserByEmail(email);

    if (user) {
      console.log(`Auth user already exists (id ${user.id}); leaving password as-is.`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: displayName ? { display_name: displayName } : undefined,
      });
      if (error) {
        console.error(`Failed to create auth user: ${error.message}`);
        continue;
      }
      user = data.user;
      console.log(`Created auth user (id ${user.id}).`);
    }

    const { error: staffError } = await supabase
      .from("staff")
      .upsert(
        { user_id: user.id, role, display_name: displayName ?? null },
        { onConflict: "user_id" },
      );

    if (staffError) {
      console.error(`Failed to upsert staff row: ${staffError.message}`);
      continue;
    }
    console.log(`staff row set: role=${role}${displayName ? `, display_name=${displayName}` : ""}`);
  }

  console.log("\nDone. Passwords were never printed — use what you put in seed-staff.config.json to sign in.");
  console.log("Consider deleting scripts/seed-staff.config.json now that the accounts exist (it's gitignored either way).");
}

main().catch((err) => {
  console.error("Unexpected failure:", err);
  process.exit(1);
});
