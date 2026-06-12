#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "HERMES_OWNER_EMAIL", "HERMES_OWNER_PASSWORD"];

function requiredValue(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function validatePassword(password) {
  const missing = [];
  if (password.length < 24) missing.push("at least 24 characters");
  if (!/[a-z]/u.test(password)) missing.push("a lowercase letter");
  if (!/[A-Z]/u.test(password)) missing.push("an uppercase letter");
  if (!/[0-9]/u.test(password)) missing.push("a number");
  if (!/[^A-Za-z0-9]/u.test(password)) missing.push("a symbol");
  if (/password|123456|qwerty|letmein|welcome|admin|test-password/iu.test(password)) {
    missing.push("no common password words or obvious test placeholders");
  }
  if (missing.length > 0) {
    throw new Error(`HERMES_OWNER_PASSWORD must include ${missing.join(", ")}.`);
  }
}

async function findUserByEmail(supabase, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) return undefined;
  }
  return undefined;
}

async function main() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }

  const email = requiredValue("HERMES_OWNER_EMAIL").toLowerCase();
  const password = requiredValue("HERMES_OWNER_PASSWORD");
  validatePassword(password);

  const supabase = createClient(requiredValue("NEXT_PUBLIC_SUPABASE_URL"), requiredValue("SUPABASE_SECRET_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const existing = await findUserByEmail(supabase, email);
  const userResult = existing
    ? await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { display_name: "newmeta Hermes Owner" }
      })
    : await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: "newmeta Hermes Owner" }
      });

  if (userResult.error) throw userResult.error;
  const user = userResult.data.user;
  if (!user) throw new Error("Supabase owner user was not returned.");

  const { error: profileError } = await supabase.from("users").upsert({
    id: user.id,
    email,
    display_name: "newmeta Hermes Owner",
    updated_at: new Date().toISOString()
  });
  if (profileError) throw profileError;

  const tenantName = process.env.HERMES_OWNER_TENANT_NAME?.trim() || "newmeta Hermes";
  const { data: existingTenant, error: tenantReadError } = await supabase
    .from("tenants")
    .select("id")
    .eq("name", tenantName)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (tenantReadError) throw tenantReadError;

  let tenantId = existingTenant?.id;
  if (!tenantId) {
    const { data: insertedTenant, error: tenantInsertError } = await supabase
      .from("tenants")
      .insert({
        name: tenantName,
        is_internal: false,
        cross_tenant_learning_opt_in: false
      })
      .select("id")
      .single();
    if (tenantInsertError) throw tenantInsertError;
    tenantId = insertedTenant.id;
  }

  const { error: roleError } = await supabase.from("user_roles").upsert(
    {
      tenant_id: tenantId,
      user_id: user.id,
      role: "owner"
    },
    { onConflict: "tenant_id,user_id" }
  );
  if (roleError) throw roleError;

  console.log(`[provision-owner] owner=${user.id} tenant=${tenantId} role=owner`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[provision-owner] failed: ${message}`);
  process.exit(1);
});
