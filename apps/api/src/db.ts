import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@beyaz-ofis/db-schema";
import { createDb } from "@beyaz-ofis/db-schema";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

// Üretimde node-postgres, testte PGlite (gerçek PostgreSQL motoru, WASM). Servis katmanı yalnızca bu tipi görür.
export type Db = PgDatabase<any, typeof schema>;

// Migration klasörü: API paketinin çalışma dizininden (apps/api) göreli.
export const MIGRATIONS_DIR = path.resolve(process.cwd(), "../../packages/db-schema/migrations");

export function connect(databaseUrl: string): Db {
  return createDb(databaseUrl) as unknown as Db;
}

export async function createTestDb(): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Db, client };
}
