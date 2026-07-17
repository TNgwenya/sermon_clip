import { PrismaClient } from "@prisma/client";

import { transformPortableMediaPathValues } from "@/server/media/portableStoragePath";

function createPrismaClient() {
  return new PrismaClient({
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

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
