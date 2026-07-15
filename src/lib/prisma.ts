import { PrismaClient } from "@prisma/client";

import {
  applyOwnershipWhere,
  shouldRestrictToOwnData,
  getDataAccessScope,
} from "@/lib/data-access-scope";

// PrismaClient is attached to the `globalThis` object in development to prevent
// exhausting your database connection limit.
//
// Learn more:
// https://pris.ly/d/help/next-js-best-practices

declare global {
  // allow global `var` declarations
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const UNIQUE_READ_ACTION_MAP = {
  findUnique: "findFirst",
  findUniqueOrThrow: "findFirstOrThrow",
} as const;

const SCOPED_ACTIONS = new Set([
  "aggregate",
  "count",
  "deleteMany",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "groupBy",
  "updateMany",
]);

function createPrismaClient() {
  const client = new PrismaClient({
    // log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  });

  client.$use(async (params, next) => {
    const scope = getDataAccessScope();
    if (shouldRestrictToOwnData(scope) && params.model) {
      const scopedAction =
        UNIQUE_READ_ACTION_MAP[
          params.action as keyof typeof UNIQUE_READ_ACTION_MAP
        ] ?? params.action;

      if (SCOPED_ACTIONS.has(scopedAction)) {
        const nextArgs = params.args ?? {};
        const scopedWhere = applyOwnershipWhere(params.model, nextArgs.where);

        params.action = scopedAction;
        params.args =
          typeof scopedWhere === "undefined"
            ? nextArgs
            : { ...nextArgs, where: scopedWhere };
      }
    }

    return next(params);
  });

  return client;
}

export const prisma = globalThis.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
