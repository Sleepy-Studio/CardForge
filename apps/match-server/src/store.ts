import {
  MemoryCardForgeStore,
  PostgresCardForgeStore,
  type CardForgeStore,
} from "@cardforge/persistence";

export function createConfiguredStore(): CardForgeStore {
  const databaseUrl = process.env.DATABASE_URL;
  return databaseUrl
    ? new PostgresCardForgeStore(databaseUrl)
    : new MemoryCardForgeStore();
}

export const cardForgeStore = createConfiguredStore();
