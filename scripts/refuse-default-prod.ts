#!/usr/bin/env bun
/**
 * Fail-closed stub for bare local commands (#63).
 *
 * The root `.env.local` points at production, so any package.json command
 * that loads it implicitly is a default path from local tooling to
 * production. Those commands now route here and refuse, naming the explicit
 * `:staging` command to run instead.
 *
 * Usage in package.json: `"db:migrate": "bun run scripts/refuse-default-prod.ts db:migrate:staging"`
 */

const use = process.argv[2] ?? "dev:staging";

console.error("");
console.error("✗ Refusing: this command would load .env.local, which points at production.");
console.error("");
console.error("  Local tooling never resolves a target on its own. Name the one you want:");
console.error("");
console.error(`    bun run ${use}`);
console.error("");
console.error("  Production is reachable only by naming it explicitly and deliberately");
console.error("  (an explicit env file plus --allow-production on the script itself).");
console.error("");
process.exit(1);
