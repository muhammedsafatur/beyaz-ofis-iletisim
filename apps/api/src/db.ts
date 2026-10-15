import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@beyaz-ofis/db-schema";
import { createDb } from "@beyaz-ofis/db-schema";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePgMigrator } from "drizzle-orm/node-postgres/migrator";

const { Pool } = pg;

// Üretimde node-postgres. Testte TEST_DATABASE_URL varsa gerçek PostgreSQL (her test dosyası kendi geçici
// veritabanını alır), yoksa PGlite (WASM PostgreSQL). Servis katmanı yalnızca bu tipi görür.
export type Db = PgDatabase<any, typeof schema>;

// Migration klasörü: API paketinin çalışma dizininden (apps/api) göreli.
export const MIGRATIONS_DIR = path.resolve(process.cwd(), "../../packages/db-schema/migrations");

export function connect(databaseUrl: string): Db {
  return createDb(databaseUrl) as unknown as Db;
}

export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db: db as unknown as Db, close: () => client.close() };
  }

  // Gerçek PostgreSQL: test dosyası için benzersiz veritabanı, bitince silinir.
  const name = `bo_test_${randomUUID().replace(/-/g, "")}`;
  const admin = new Pool({ connectionString: base, max: 1 });
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(base);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 5 });
  const db = drizzlePg(pool, { schema });
  await migratePgMigrator(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    db: db as unknown as Db,
    close: async () => {
      await pool.end();
      const cleanup = new Pool({ connectionString: base, max: 1 });
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await cleanup.end();
    },
  };
}
