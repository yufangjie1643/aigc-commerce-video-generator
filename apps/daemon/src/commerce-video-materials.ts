import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  CommerceVideoFileRef,
  CommerceVideoProductMaterial,
  CommerceVideoProductMaterialInput,
  CommerceVideoProductMaterialSourceKind,
  CommerceVideoProductMaterialStatus
} from "@open-design/contracts";
import { COMMERCE_VIDEO_MATERIALS_DB_FILE } from "@open-design/contracts";

type Db = Database.Database;
type Row = Record<string, any>;

const MATERIAL_COLS = `
  id,
  title,
  subject,
  category,
  source_kind AS sourceKind,
  status,
  files_json AS filesJson,
  product_json AS productJson,
  analysis_json AS analysisJson,
  metadata_json AS metadataJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export function resolveCommerceVideoMaterialsDbPath(projectRoot: string): string {
  return path.join(projectRoot, ...COMMERCE_VIDEO_MATERIALS_DB_FILE.split("/"));
}

export function upsertProjectProductMaterials(
  projectRoot: string,
  inputs: CommerceVideoProductMaterialInput[],
  randomId: () => string
): CommerceVideoProductMaterial[] {
  if (inputs.length === 0) return [];
  return withProjectMaterialsDb(projectRoot, (db) => {
    const now = Date.now();
    const upsert = db.prepare(`
      INSERT INTO product_materials
        (id, title, subject, category, source_kind, status, files_json,
         product_json, analysis_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        subject = excluded.subject,
        category = excluded.category,
        source_kind = excluded.source_kind,
        status = excluded.status,
        files_json = excluded.files_json,
        product_json = excluded.product_json,
        analysis_json = excluded.analysis_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const saved: CommerceVideoProductMaterial[] = [];
    const tx = db.transaction(() => {
      for (const input of inputs) {
        const material = normalizeMaterialInput(input, randomId, now);
        const existing = getProductMaterialRow(db, material.id);
        const createdAt = existing ? Number(existing.createdAt) : material.createdAt;
        upsert.run(
          material.id,
          material.title,
          material.subject,
          material.category,
          material.sourceKind,
          material.status,
          JSON.stringify(material.files),
          JSON.stringify(material.product),
          jsonOrNull(material.analysis),
          jsonOrNull(material.metadata),
          createdAt,
          material.updatedAt
        );
        const row = getProductMaterialRow(db, material.id);
        if (!row) throw new Error(`failed to store commerce video product material ${material.id}`);
        saved.push(normalizeProductMaterialRow(row));
      }
    });
    tx();
    return saved;
  });
}

export function listProjectProductMaterials(projectRoot: string, ids: string[] = []): CommerceVideoProductMaterial[] {
  const dbPath = resolveCommerceVideoMaterialsDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return [];
  return withProjectMaterialsDb(projectRoot, (db) => {
    if (ids.length === 0) {
      const rows = db.prepare(`SELECT ${MATERIAL_COLS} FROM product_materials ORDER BY updated_at DESC`).all() as Row[];
      return rows.map(normalizeProductMaterialRow);
    }
    const uniqueIds = uniqueStrings(ids);
    const rows = uniqueIds.map((id) => getProductMaterialRow(db, id)).filter((row): row is Row => Boolean(row));
    return rows.map(normalizeProductMaterialRow);
  });
}

function withProjectMaterialsDb<T>(projectRoot: string, fn: (db: Db) => T): T {
  const dbPath = resolveCommerceVideoMaterialsDbPath(projectRoot);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrateProjectMaterialsDb(db);
    return fn(db);
  } finally {
    db.close();
  }
}

function migrateProjectMaterialsDb(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_materials (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      files_json TEXT NOT NULL DEFAULT '[]',
      product_json TEXT NOT NULL DEFAULT '{}',
      analysis_json TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_commerce_video_product_materials_updated
      ON product_materials(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_commerce_video_product_materials_category
      ON product_materials(category, updated_at DESC);
  `);
}

function getProductMaterialRow(db: Db, id: string): Row | undefined {
  return db.prepare(`SELECT ${MATERIAL_COLS} FROM product_materials WHERE id = ?`).get(id) as Row | undefined;
}

function normalizeMaterialInput(
  input: CommerceVideoProductMaterialInput,
  randomId: () => string,
  now: number
): CommerceVideoProductMaterial {
  const title = stringOrUndefined(input.title);
  if (!title) throw new Error("productMaterials[].title is required");
  const files = Array.isArray(input.files)
    ? input.files
        .map((file) => normalizeFileRef(file))
        .filter((file): file is CommerceVideoFileRef => Boolean(file.path))
    : [];
  const product = isRecord(input.product) ? input.product : {};
  const summary = stringOrUndefined(product.summary);
  const embedding = isRecord(product.embedding) ? product.embedding : undefined;
  const analysis = isRecord(input.analysis) ? input.analysis : undefined;
  const metadata = isRecord(input.metadata) ? input.metadata : undefined;
  return {
    id: stringOrUndefined(input.id) ?? `material_${randomId().replace(/-/g, "").slice(0, 16)}`,
    title,
    subject: stringOrUndefined(input.subject) ?? "",
    category: stringOrUndefined(input.category) ?? "",
    sourceKind: normalizeSourceKind(input.sourceKind, files.length > 0 ? "upload" : "manual"),
    status: normalizeMaterialStatus(input.status),
    files,
    product: {
      sellingPoints: stringArray(product.sellingPoints),
      constraints: stringArray(product.constraints),
      suggestedAngles: stringArray(product.suggestedAngles),
      ...(summary ? { summary } : {}),
      ...(embedding ? { embedding } : {})
    },
    ...(analysis ? { analysis } : {}),
    ...(metadata ? { metadata } : {}),
    createdAt: now,
    updatedAt: now
  };
}

function normalizeProductMaterialRow(row: Row): CommerceVideoProductMaterial {
  const product = parseRecord(row.productJson);
  const summary = stringOrUndefined(product.summary);
  const embedding = isRecord(product.embedding) ? product.embedding : undefined;
  const analysis = parseRecordOrUndefined(row.analysisJson);
  const metadata = parseRecordOrUndefined(row.metadataJson);
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    subject: String(row.subject ?? ""),
    category: String(row.category ?? ""),
    sourceKind: normalizeSourceKind(row.sourceKind),
    status: normalizeMaterialStatus(row.status),
    files: parseArray(row.filesJson)
      .map(normalizeFileRef)
      .filter((file) => file.path),
    product: {
      sellingPoints: stringArray(product.sellingPoints),
      constraints: stringArray(product.constraints),
      suggestedAngles: stringArray(product.suggestedAngles),
      ...(summary ? { summary } : {}),
      ...(embedding ? { embedding } : {})
    },
    ...(analysis ? { analysis } : {}),
    ...(metadata ? { metadata } : {}),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  };
}

function normalizeFileRef(raw: unknown): CommerceVideoFileRef {
  const value = isRecord(raw) ? raw : {};
  const next: CommerceVideoFileRef = { path: stringOrUndefined(value.path ?? value.name) ?? "" };
  const name = stringOrUndefined(value.name);
  const mime = stringOrUndefined(value.mime);
  const size = typeof value.size === "number" && Number.isFinite(value.size) ? value.size : undefined;
  if (name) next.name = name;
  if (mime) next.mime = mime;
  if (size !== undefined) next.size = size;
  return next;
}

function normalizeSourceKind(
  value: unknown,
  fallback: CommerceVideoProductMaterialSourceKind = "manual"
): CommerceVideoProductMaterialSourceKind {
  return value === "upload" || value === "crawler" || value === "manual" ? value : fallback;
}

function normalizeMaterialStatus(value: unknown): CommerceVideoProductMaterialStatus {
  return value === "processing" || value === "needs_model" || value === "needs_embedding_config" || value === "failed"
    ? value
    : "ready";
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): Record<string, any> {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return isRecord(parsed) ? parsed : {};
}

function parseRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  const record = parseRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function parseArray(value: unknown): unknown[] {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonOrNull(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}
