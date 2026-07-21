import { PrismaClient, type Prisma } from "@prisma/client";

import { resolveRuntimeDatabaseUrl, usesRuntimeDatabasePool } from "@/lib/databaseUrl";
import { transformPortableMediaPathValues } from "@/server/media/portableStoragePath";

function createPrismaClient() {
  const datasourceUrl = resolveRuntimeDatabaseUrl();

  return new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends({
    name: "portable-sermon-storage-paths",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const result = await query(transformPortableMediaPathValues(args, "store"));
          return transformPortableMediaPathValues(result, "resolve");
        },
      },
    },
  });
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;

declare global {
  var prisma: AppPrismaClient | undefined;
}

export const prisma =
  global.prisma ??
  createPrismaClient();

type AwaitedTuple<T extends readonly unknown[]> = {
  -readonly [Index in keyof T]: Awaited<T[Index]>;
};

export async function databaseReadBatch<
  const Queries extends readonly Prisma.PrismaPromise<unknown>[],
>(queries: Queries): Promise<AwaitedTuple<Queries>> {
  if (usesRuntimeDatabasePool()) {
    return Promise.all(queries) as Promise<AwaitedTuple<Queries>>;
  }

  return prisma.$transaction([...queries]) as Promise<AwaitedTuple<Queries>>;
}

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
