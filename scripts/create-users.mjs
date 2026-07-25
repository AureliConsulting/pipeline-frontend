// Creates the two v1 users (Ali, Julian) via the Supabase Admin API.
// Run:  node scripts/create-users.mjs
// Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (server-side only; never ship
//       the service-role key to a browser or commit it).
// Passwords are read from ALI_PASSWORD / JULIAN_PASSWORD env vars, or prompted.
import { createInterface } from "node:readline/promises";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const users = [
  { email: process.env.ALI_EMAIL ?? "ali@aureliconsulting.com", name: "Ali", passwordEnv: "ALI_PASSWORD" },
  { email: process.env.JULIAN_EMAIL ?? "julian@aureliconsulting.com", name: "Julian", passwordEnv: "JULIAN_PASSWORD" },
];

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (const user of users) {
  let password = process.env[user.passwordEnv];
  if (!password) {
    password = await rl.question(`Password for ${user.email} (min 12 chars): `);
  }
  if (!password || password.length < 12) {
    console.error(`Skipping ${user.email}: password too short.`);
    continue;
  }
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: user.name },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`FAILED ${user.email}: ${body.msg ?? body.message ?? res.status}`);
  } else {
    console.log(`Created ${user.email} (${body.id})`);
  }
}
rl.close();
