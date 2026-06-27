import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Prisma, PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);
const sqlitePath = process.env.SQLITE_DATABASE_PATH ?? "prisma/dev.db";
const prisma = new PrismaClient();

type SqliteRow = Record<string, unknown>;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function modelFieldTypes(): Map<string, Map<string, string>> {
  const models = new Map<string, Map<string, string>>();

  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = new Map<string, string>();
    for (const field of model.fields) {
      fields.set(field.dbName ?? field.name, field.type);
    }
    models.set(model.dbName ?? model.name, fields);
  }

  return models;
}

async function listSqliteTables(): Promise<string[]> {
  const { stdout } = await execFileAsync("sqlite3", [
    "-json",
    sqlitePath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name",
  ]);
  const rows = JSON.parse(stdout || "[]") as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

async function readTable(table: string): Promise<SqliteRow[]> {
  const { stdout } = await execFileAsync("sqlite3", [
    "-json",
    sqlitePath,
    `SELECT * FROM ${quoteIdentifier(table)}`,
  ], {
    maxBuffer: 1024 * 1024 * 100,
  });

  return JSON.parse(stdout || "[]") as SqliteRow[];
}

function normalizeValue(value: unknown, prismaType: string | undefined): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (prismaType === "Boolean") {
    return value === true || value === 1 || value === "1";
  }

  if (prismaType === "Json" && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function normalizeRow(table: string, row: SqliteRow): SqliteRow {
  if (table !== "ScheduledPost" || typeof row.idempotencyKey === "string" && row.idempotencyKey.trim().length > 0) {
    return row;
  }

  return {
    ...row,
    idempotencyKey: [
      row.id,
      row.platform,
      typeof row.scheduledFor === "string" && row.scheduledFor ? row.scheduledFor : "manual",
    ].filter(Boolean).join(":"),
  };
}

async function insertRows(table: string, rows: SqliteRow[], fieldTypes: Map<string, string> | undefined): Promise<number> {
  let inserted = 0;

  for (const rawRow of rows) {
    const row = normalizeRow(table, rawRow);
    const entries = Object.entries(row).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      continue;
    }

    const columns = entries.map(([column]) => quoteIdentifier(column)).join(", ");
    const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
    const values = entries.map(([column, value]) => normalizeValue(value, fieldTypes?.get(column)));

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      ...values,
    );
    inserted += 1;
  }

  return inserted;
}

async function main(): Promise<void> {
  const tables = await listSqliteTables();
  const fieldTypesByModel = modelFieldTypes();

  for (const table of tables) {
    const rows = await readTable(table);
    const inserted = await insertRows(table, rows, fieldTypesByModel.get(table));
    console.log(`${table}: imported ${inserted}/${rows.length}`);
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
