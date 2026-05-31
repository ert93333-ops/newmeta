import { Client } from "pg";

const databaseUrl = process.env.SUPABASE_DB_URL;
const workerName = process.env.HERMES_WORKER_NAME ?? "hermes-worker";

if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required for the worker.");
}

async function main() {
  const client = new Client({
    connectionString: databaseUrl
  });

  await client.connect();
  try {
    const { rows } = await client.query("select * from private.claim_creative_job($1)", [workerName]);
    if (rows.length === 0 || !rows[0]?.id) {
      console.log("No queued creative jobs.");
      return;
    }
    console.log(`Claimed creative job ${rows[0].id}.`);
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
