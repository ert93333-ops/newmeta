#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_AUTH_SMOKE_EMAIL",
  "SUPABASE_AUTH_SMOKE_PASSWORD"
];

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
  if (/password|123456|qwerty|letmein|welcome|admin|smoke-password|test-password/iu.test(password)) {
    missing.push("no common password words or obvious test placeholders");
  }
  if (missing.length > 0) {
    throw new Error(`SUPABASE_AUTH_SMOKE_PASSWORD must include ${missing.join(", ")}.`);
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

  const password = requiredValue("SUPABASE_AUTH_SMOKE_PASSWORD");
  validatePassword(password);

  const supabase = createClient(requiredValue("NEXT_PUBLIC_SUPABASE_URL"), requiredValue("SUPABASE_SECRET_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const email = requiredValue("SUPABASE_AUTH_SMOKE_EMAIL");
  const user = await findUserByEmail(supabase, email);
  if (!user) {
    throw new Error("Supabase auth smoke user was not found.");
  }

  const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (error) throw error;

  console.log(`[rotate-auth-smoke] updated user ${user.id}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[rotate-auth-smoke] failed: ${message}`);
  process.exit(1);
});
