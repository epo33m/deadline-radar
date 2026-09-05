import { createDb, type Database } from "@deadline-radar/db";

import { env } from "../env";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = createDb(env.databaseUrl());
  }
  return db;
}
