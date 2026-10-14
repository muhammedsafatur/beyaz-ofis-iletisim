import { timestamp } from "drizzle-orm/pg-core";

// Tüm zaman alanları timestamptz, UTC
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Spec'teki "zaman damgaları"
export const timestamps = {
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
};

export const deletedAt = tstz("deleted_at");
