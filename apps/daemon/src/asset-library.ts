import type Database from 'better-sqlite3';
import type {
  AssetLibraryJob,
  AssetLibraryJobKind,
  AssetLibraryJobStatus,
  AssetLibrarySection,
  AssetLibraryStatus,
  CommerceVideoAsset,
  CommerceVideoSlice,
  ProductAsset,
  ProjectAssetLibraryContextRef,
} from '@open-design/contracts';

type Db = Database.Database;
type Row = Record<string, any>;

const PRODUCT_COLS = `
  id,
  title,
  subject,
  category,
  source_kind AS sourceKind,
  status,
  files_json AS filesJson,
  product_json AS productJson,
  metadata_json AS metadataJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const VIDEO_COLS = `
  id,
  title,
  source_kind AS sourceKind,
  source_connector_id AS sourceConnectorId,
  source_url AS sourceUrl,
  source_video_id AS sourceVideoId,
  file_path AS filePath,
  original_file_name AS originalFileName,
  mime,
  size,
  sha256,
  status,
  product_json AS productJson,
  video_json AS videoJson,
  methodology_json AS methodologyJson,
  metadata_json AS metadataJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const SLICE_COLS = `
  id,
  video_asset_id AS assetId,
  start_ms AS startMs,
  end_ms AS endMs,
  file_path AS filePath,
  thumbnail_path AS thumbnailPath,
  features_json AS featuresJson,
  embedding_json AS embeddingJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const JOB_COLS = `
  id,
  asset_kind AS assetKind,
  asset_id AS assetId,
  kind,
  status,
  progress_json AS progressJson,
  error_json AS errorJson,
  started_at AS startedAt,
  ended_at AS endedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export function migrateAssetLibrary(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_library_products (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      files_json TEXT NOT NULL DEFAULT '[]',
      product_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_asset_library_products_updated
      ON asset_library_products(updated_at DESC);

    CREATE TABLE IF NOT EXISTS asset_library_commerce_videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_connector_id TEXT,
      source_url TEXT,
      source_video_id TEXT,
      file_path TEXT,
      original_file_name TEXT,
      mime TEXT,
      size INTEGER,
      sha256 TEXT,
      status TEXT NOT NULL,
      product_json TEXT NOT NULL DEFAULT '{}',
      video_json TEXT NOT NULL DEFAULT '{}',
      methodology_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_library_commerce_videos_sha
      ON asset_library_commerce_videos(sha256)
      WHERE sha256 IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_asset_library_commerce_videos_updated
      ON asset_library_commerce_videos(updated_at DESC);

    CREATE TABLE IF NOT EXISTS asset_library_slices (
      id TEXT PRIMARY KEY,
      video_asset_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      file_path TEXT,
      thumbnail_path TEXT,
      features_json TEXT NOT NULL DEFAULT '{}',
      embedding_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(video_asset_id) REFERENCES asset_library_commerce_videos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_asset_library_slices_video
      ON asset_library_slices(video_asset_id, start_ms ASC);

    CREATE TABLE IF NOT EXISTS asset_library_jobs (
      id TEXT PRIMARY KEY,
      asset_kind TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_json TEXT NOT NULL DEFAULT '[]',
      error_json TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_asset_library_jobs_asset
      ON asset_library_jobs(asset_kind, asset_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS asset_library_project_context (
      project_id TEXT NOT NULL,
      product_asset_id TEXT,
      commerce_video_asset_id TEXT,
      slice_id TEXT,
      purpose TEXT,
      note TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_asset_library_project_context_project
      ON asset_library_project_context(project_id, created_at DESC);
  `);
}

export function insertProductAsset(db: Db, input: {
  id: string;
  title: string;
  subject?: string;
  category?: string;
  sourceKind?: string;
  status?: AssetLibraryStatus;
  files?: unknown[];
  product?: unknown;
  metadata?: unknown;
  now?: number;
}): ProductAsset {
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO asset_library_products
      (id, title, subject, category, source_kind, status, files_json,
       product_json, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.subject ?? '',
    input.category ?? '',
    input.sourceKind ?? 'manual',
    input.status ?? 'ready',
    JSON.stringify(input.files ?? []),
    JSON.stringify(input.product ?? {}),
    jsonOrNull(input.metadata),
    now,
    now,
  );
  const row = getProductAsset(db, input.id);
  if (!row) throw new Error(`failed to insert product asset ${input.id}`);
  return row;
}

export function listProductAssets(db: Db, options: { query?: string; limit?: number } = {}): ProductAsset[] {
  const limit = clampLimit(options.limit);
  const query = options.query?.trim();
  const rows = query
    ? db.prepare(
        `SELECT ${PRODUCT_COLS}
           FROM asset_library_products
          WHERE title LIKE ? OR subject LIKE ? OR category LIKE ?
          ORDER BY updated_at DESC
          LIMIT ?`,
      ).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as Row[]
    : db.prepare(
        `SELECT ${PRODUCT_COLS}
           FROM asset_library_products
          ORDER BY updated_at DESC
          LIMIT ?`,
      ).all(limit) as Row[];
  return rows.map(normalizeProduct);
}

export function getProductAsset(db: Db, id: string): ProductAsset | null {
  const row = db.prepare(`SELECT ${PRODUCT_COLS} FROM asset_library_products WHERE id = ?`).get(id) as Row | undefined;
  return row ? normalizeProduct(row) : null;
}

export function updateProductAsset(db: Db, id: string, patch: Partial<ProductAsset> & { product?: unknown; metadata?: unknown }): ProductAsset | null {
  const existing = getProductAsset(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    product: 'product' in patch ? patch.product : existing.product,
    metadata: 'metadata' in patch ? patch.metadata : existing.metadata,
    updatedAt: Date.now(),
  };
  db.prepare(
    `UPDATE asset_library_products
        SET title = ?,
            subject = ?,
            category = ?,
            source_kind = ?,
            status = ?,
            files_json = ?,
            product_json = ?,
            metadata_json = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    merged.title,
    merged.subject,
    merged.category,
    merged.sourceKind,
    merged.status,
    JSON.stringify(merged.files ?? []),
    JSON.stringify(merged.product ?? {}),
    jsonOrNull(merged.metadata),
    merged.updatedAt,
    id,
  );
  return getProductAsset(db, id);
}

export function deleteProductAsset(db: Db, id: string): ProductAsset | null {
  const existing = getProductAsset(db, id);
  if (!existing) return null;
  db.transaction(() => {
    db.prepare('DELETE FROM asset_library_project_context WHERE product_asset_id = ?').run(id);
    db.prepare('DELETE FROM asset_library_jobs WHERE asset_kind = ? AND asset_id = ?').run('products', id);
    db.prepare('DELETE FROM asset_library_products WHERE id = ?').run(id);
  })();
  return existing;
}

export function insertCommerceVideoAsset(db: Db, input: {
  id: string;
  title: string;
  sourceKind: string;
  sourceConnectorId?: string | null;
  sourceUrl?: string | null;
  sourceVideoId?: string | null;
  filePath?: string | null;
  originalFileName?: string | null;
  mime?: string | null;
  size?: number | null;
  sha256?: string | null;
  status?: AssetLibraryStatus;
  product?: unknown;
  video?: unknown;
  methodology?: unknown;
  metadata?: unknown;
  now?: number;
}): CommerceVideoAsset {
  const existing = input.sha256 ? getCommerceVideoAssetBySha(db, input.sha256) : null;
  if (existing) return existing;
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO asset_library_commerce_videos
      (id, title, source_kind, source_connector_id, source_url, source_video_id,
       file_path, original_file_name, mime, size, sha256, status, product_json,
       video_json, methodology_json, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.sourceKind,
    input.sourceConnectorId ?? null,
    input.sourceUrl ?? null,
    input.sourceVideoId ?? null,
    input.filePath ?? null,
    input.originalFileName ?? null,
    input.mime ?? null,
    input.size ?? null,
    input.sha256 ?? null,
    input.status ?? 'ready',
    JSON.stringify(input.product ?? {}),
    JSON.stringify(input.video ?? {}),
    JSON.stringify(input.methodology ?? {}),
    jsonOrNull(input.metadata),
    now,
    now,
  );
  const row = getCommerceVideoAsset(db, input.id);
  if (!row) throw new Error(`failed to insert commerce video asset ${input.id}`);
  return row;
}

export function listCommerceVideoAssets(db: Db, options: { query?: string; limit?: number } = {}): CommerceVideoAsset[] {
  const limit = clampLimit(options.limit);
  const query = options.query?.trim();
  const rows = query
    ? db.prepare(
        `SELECT ${VIDEO_COLS}
           FROM asset_library_commerce_videos
          WHERE title LIKE ? OR source_url LIKE ? OR source_video_id LIKE ?
          ORDER BY updated_at DESC
          LIMIT ?`,
      ).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as Row[]
    : db.prepare(
        `SELECT ${VIDEO_COLS}
           FROM asset_library_commerce_videos
          ORDER BY updated_at DESC
          LIMIT ?`,
      ).all(limit) as Row[];
  return rows.map(normalizeVideo);
}

export function getCommerceVideoAsset(db: Db, id: string): CommerceVideoAsset | null {
  const row = db.prepare(`SELECT ${VIDEO_COLS} FROM asset_library_commerce_videos WHERE id = ?`).get(id) as Row | undefined;
  return row ? normalizeVideo(row) : null;
}

export function getCommerceVideoAssetBySha(db: Db, sha256: string): CommerceVideoAsset | null {
  const row = db.prepare(`SELECT ${VIDEO_COLS} FROM asset_library_commerce_videos WHERE sha256 = ?`).get(sha256) as Row | undefined;
  return row ? normalizeVideo(row) : null;
}

export function getCommerceVideoAssetBySource(
  db: Db,
  input: { sourceConnectorId?: string; sourceVideoId?: string; sourceUrl?: string },
): CommerceVideoAsset | null {
  const connectorId = input.sourceConnectorId?.trim();
  const videoId = input.sourceVideoId?.trim();
  if (connectorId && videoId) {
    const row = db.prepare(
      `SELECT ${VIDEO_COLS}
         FROM asset_library_commerce_videos
        WHERE source_connector_id = ?
          AND source_video_id = ?
        LIMIT 1`,
    ).get(connectorId, videoId) as Row | undefined;
    if (row) return normalizeVideo(row);
  }
  const sourceUrl = input.sourceUrl?.trim();
  if (sourceUrl) {
    const row = db.prepare(
      `SELECT ${VIDEO_COLS}
         FROM asset_library_commerce_videos
        WHERE source_url = ?
        LIMIT 1`,
    ).get(sourceUrl) as Row | undefined;
    if (row) return normalizeVideo(row);
  }
  return null;
}

export function updateCommerceVideoAsset(
  db: Db,
  id: string,
  patch: Partial<CommerceVideoAsset> & { product?: unknown; video?: unknown; methodology?: unknown; metadata?: unknown },
): CommerceVideoAsset | null {
  const existing = getCommerceVideoAsset(db, id);
  if (!existing) return null;
  const file = patch.file ?? existing.file;
  const merged = {
    ...existing,
    ...patch,
    file,
    product: patch.product ?? existing.product,
    video: patch.video ?? existing.video,
    methodology: patch.methodology ?? existing.methodology,
    metadata: patch.metadata ?? existing.metadata,
    updatedAt: Date.now(),
  };
  db.prepare(
    `UPDATE asset_library_commerce_videos
        SET title = ?,
            source_kind = ?,
            source_connector_id = ?,
            source_url = ?,
            source_video_id = ?,
            file_path = ?,
            original_file_name = ?,
            mime = ?,
            size = ?,
            sha256 = ?,
            status = ?,
            product_json = ?,
            video_json = ?,
            methodology_json = ?,
            metadata_json = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    merged.title,
    merged.sourceKind,
    merged.sourceConnectorId ?? null,
    merged.sourceUrl ?? null,
    merged.sourceVideoId ?? null,
    merged.file?.path ?? null,
    merged.file?.name ?? existing.file?.name ?? null,
    merged.file?.mime ?? null,
    merged.file?.size ?? null,
    merged.sha256 ?? null,
    merged.status,
    JSON.stringify(merged.product ?? {}),
    JSON.stringify(merged.video ?? {}),
    JSON.stringify(merged.methodology ?? {}),
    jsonOrNull(merged.metadata),
    merged.updatedAt,
    id,
  );
  return getCommerceVideoAsset(db, id);
}

export function deleteCommerceVideoAsset(db: Db, id: string): CommerceVideoAsset | null {
  const existing = getCommerceVideoAsset(db, id);
  if (!existing) return null;
  db.transaction(() => {
    db.prepare(
      `DELETE FROM asset_library_project_context
        WHERE commerce_video_asset_id = ?
           OR slice_id IN (SELECT id FROM asset_library_slices WHERE video_asset_id = ?)`,
    ).run(id, id);
    db.prepare('DELETE FROM asset_library_jobs WHERE asset_kind = ? AND asset_id = ?').run('commerce-videos', id);
    db.prepare('DELETE FROM asset_library_slices WHERE video_asset_id = ?').run(id);
    db.prepare('DELETE FROM asset_library_commerce_videos WHERE id = ?').run(id);
  })();
  return existing;
}

export function replaceCommerceVideoSlices(db: Db, assetId: string, slices: Array<{
  id: string;
  startMs: number;
  endMs: number;
  filePath?: string | null;
  thumbnailPath?: string | null;
  features?: unknown;
  embedding?: unknown;
}>): CommerceVideoSlice[] {
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM asset_library_slices WHERE video_asset_id = ?`).run(assetId);
    const insert = db.prepare(
      `INSERT INTO asset_library_slices
        (id, video_asset_id, start_ms, end_ms, file_path, thumbnail_path,
         features_json, embedding_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const slice of slices) {
      insert.run(
        slice.id,
        assetId,
        slice.startMs,
        slice.endMs,
        slice.filePath ?? null,
        slice.thumbnailPath ?? null,
        JSON.stringify(slice.features ?? {}),
        jsonOrNull(slice.embedding),
        now,
        now,
      );
    }
  });
  tx();
  return listCommerceVideoSlices(db, assetId);
}

export function listCommerceVideoSlices(db: Db, assetId: string): CommerceVideoSlice[] {
  const rows = db
    .prepare(`SELECT ${SLICE_COLS} FROM asset_library_slices WHERE video_asset_id = ? ORDER BY start_ms ASC`)
    .all(assetId) as Row[];
  return rows.map(normalizeSlice);
}

export function getCommerceVideoSlice(db: Db, id: string): CommerceVideoSlice | null {
  const row = db.prepare(`SELECT ${SLICE_COLS} FROM asset_library_slices WHERE id = ?`).get(id) as Row | undefined;
  return row ? normalizeSlice(row) : null;
}

export function updateCommerceVideoSliceEmbedding(db: Db, id: string, embedding: unknown): CommerceVideoSlice | null {
  const existing = getCommerceVideoSlice(db, id);
  if (!existing) return null;
  db.prepare(
    `UPDATE asset_library_slices
        SET embedding_json = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(jsonOrNull(embedding), Date.now(), id);
  return getCommerceVideoSlice(db, id);
}

export function insertAssetLibraryJob(db: Db, input: {
  id: string;
  assetKind: AssetLibrarySection;
  assetId: string;
  kind: AssetLibraryJobKind;
  status?: AssetLibraryJobStatus;
  progress?: string[];
}): AssetLibraryJob {
  const now = Date.now();
  db.prepare(
    `INSERT INTO asset_library_jobs
      (id, asset_kind, asset_id, kind, status, progress_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.assetKind,
    input.assetId,
    input.kind,
    input.status ?? 'queued',
    JSON.stringify(input.progress ?? []),
    now,
    now,
  );
  const job = getAssetLibraryJob(db, input.id);
  if (!job) throw new Error(`failed to insert asset library job ${input.id}`);
  return job;
}

export function updateAssetLibraryJob(db: Db, id: string, patch: Partial<AssetLibraryJob>): AssetLibraryJob | null {
  const existing = getAssetLibraryJob(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    progress: patch.progress ?? existing.progress,
    error: patch.error ?? existing.error,
    updatedAt: Date.now(),
  };
  db.prepare(
    `UPDATE asset_library_jobs
        SET asset_kind = ?,
            asset_id = ?,
            kind = ?,
            status = ?,
            progress_json = ?,
            error_json = ?,
            started_at = ?,
            ended_at = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    merged.assetKind,
    merged.assetId,
    merged.kind,
    merged.status,
    JSON.stringify(merged.progress ?? []),
    jsonOrNull(merged.error),
    merged.startedAt ?? null,
    merged.endedAt ?? null,
    merged.updatedAt,
    id,
  );
  return getAssetLibraryJob(db, id);
}

export function appendAssetLibraryJobProgress(db: Db, id: string, line: string): AssetLibraryJob | null {
  const job = getAssetLibraryJob(db, id);
  if (!job) return null;
  return updateAssetLibraryJob(db, id, {
    progress: [...job.progress, line].slice(-200),
  });
}

export function getAssetLibraryJob(db: Db, id: string): AssetLibraryJob | null {
  const row = db.prepare(`SELECT ${JOB_COLS} FROM asset_library_jobs WHERE id = ?`).get(id) as Row | undefined;
  return row ? normalizeJob(row) : null;
}

export function setProjectAssetLibraryContext(db: Db, projectId: string, refs: ProjectAssetLibraryContextRef[]): ProjectAssetLibraryContextRef[] {
  const now = Date.now();
  const clean = refs.map(normalizeContextRef).filter(Boolean) as ProjectAssetLibraryContextRef[];
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM asset_library_project_context WHERE project_id = ?`).run(projectId);
    const insert = db.prepare(
      `INSERT INTO asset_library_project_context
        (project_id, product_asset_id, commerce_video_asset_id, slice_id, purpose, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const ref of clean) {
      insert.run(
        projectId,
        ref.productAssetId ?? null,
        ref.commerceVideoAssetId ?? null,
        ref.sliceId ?? null,
        ref.purpose ?? null,
        ref.note ?? null,
        now,
      );
    }
  });
  tx();
  return getProjectAssetLibraryContext(db, projectId);
}

export function getProjectAssetLibraryContext(db: Db, projectId: string): ProjectAssetLibraryContextRef[] {
  const rows = db
    .prepare(
      `SELECT product_asset_id AS productAssetId,
              commerce_video_asset_id AS commerceVideoAssetId,
              slice_id AS sliceId,
              purpose,
              note
         FROM asset_library_project_context
        WHERE project_id = ?
        ORDER BY created_at ASC`,
    )
    .all(projectId) as Row[];
  return rows.map(normalizeContextRef).filter(Boolean) as ProjectAssetLibraryContextRef[];
}

function normalizeProduct(row: Row): ProductAsset {
  const product = parseRecord(row.productJson);
  const metadata = parseRecordOrUndefined(row.metadataJson);
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    subject: String(row.subject ?? ''),
    category: String(row.category ?? ''),
    sourceKind: row.sourceKind === 'upload' || row.sourceKind === 'crawler' ? row.sourceKind : 'manual',
    status: normalizeStatus(row.status),
    files: parseArray(row.filesJson),
    product: {
      sellingPoints: stringArray(product.sellingPoints),
      constraints: stringArray(product.constraints),
      suggestedAngles: stringArray(product.suggestedAngles),
      ...(typeof product.summary === 'string' ? { summary: product.summary } : {}),
      ...(isRecord(product.embedding) ? { embedding: product.embedding as any } : {}),
    },
    ...(metadata ? { metadata } : {}),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function normalizeVideo(row: Row): CommerceVideoAsset {
  const file = row.filePath
    ? {
        path: String(row.filePath),
        ...(row.originalFileName ? { name: String(row.originalFileName) } : {}),
        ...(row.mime ? { mime: String(row.mime) } : {}),
        ...(Number.isFinite(row.size) ? { size: Number(row.size) } : {}),
      }
    : undefined;
  const product = parseRecord(row.productJson);
  const video = parseRecord(row.videoJson);
  const methodology = parseRecord(row.methodologyJson);
  const metadata = parseRecordOrUndefined(row.metadataJson);
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    sourceKind: row.sourceKind === 'upload' || row.sourceKind === 'crawler' ? row.sourceKind : 'manual',
    ...(row.sourceConnectorId ? { sourceConnectorId: String(row.sourceConnectorId) } : {}),
    ...(row.sourceUrl ? { sourceUrl: String(row.sourceUrl) } : {}),
    ...(row.sourceVideoId ? { sourceVideoId: String(row.sourceVideoId) } : {}),
    ...(file ? { file } : {}),
    ...(row.sha256 ? { sha256: String(row.sha256) } : {}),
    status: normalizeStatus(row.status),
    product: {
      ...(typeof product.subject === 'string' ? { subject: product.subject } : {}),
      ...(typeof product.category === 'string' ? { category: product.category } : {}),
    },
    video: {
      ...(typeof video.durationMs === 'number' ? { durationMs: video.durationMs } : {}),
      ...(typeof video.summary === 'string' ? { summary: video.summary } : {}),
      ...(isRecord(video.embedding) ? { embedding: video.embedding as any } : {}),
    },
    methodology: {
      hooks: stringArray(methodology.hooks),
      structure: stringArray(methodology.structure),
      sellingTriggers: stringArray(methodology.sellingTriggers),
      styleTags: stringArray(methodology.styleTags),
    },
    ...(metadata ? { metadata } : {}),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function normalizeSlice(row: Row): CommerceVideoSlice {
  const features = parseRecord(row.featuresJson);
  const file = row.filePath ? { path: String(row.filePath) } : undefined;
  const thumbnail = row.thumbnailPath ? { path: String(row.thumbnailPath), mime: 'image/jpeg' } : undefined;
  return {
    id: String(row.id),
    assetId: String(row.assetId),
    startMs: Number(row.startMs),
    endMs: Number(row.endMs),
    ...(file ? { file } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    features: {
      ...(typeof features.scene === 'string' ? { scene: features.scene } : {}),
      visualActions: stringArray(features.visualActions),
      spokenText: stringArray(features.spokenText),
      onScreenText: stringArray(features.onScreenText),
      productMentions: stringArray(features.productMentions),
      ...(typeof features.hook === 'string' ? { hook: features.hook } : {}),
      ...(typeof features.transition === 'string' ? { transition: features.transition } : {}),
      ...(typeof features.pace === 'string' ? { pace: features.pace } : {}),
      ...(typeof features.sellingPoint === 'string' ? { sellingPoint: features.sellingPoint } : {}),
      tags: stringArray(features.tags),
    },
    ...(row.embeddingJson ? { embedding: parseRecord(row.embeddingJson) as any } : {}),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function normalizeJob(row: Row): AssetLibraryJob {
  const startedAt = row.startedAt == null ? undefined : Number(row.startedAt);
  const endedAt = row.endedAt == null ? undefined : Number(row.endedAt);
  return {
    id: String(row.id),
    assetKind: row.assetKind === 'products' ? 'products' : 'commerce-videos',
    assetId: String(row.assetId),
    kind: normalizeJobKind(row.kind),
    status: normalizeJobStatus(row.status),
    progress: stringArray(parseJson(row.progressJson)),
    ...(row.errorJson ? { error: parseRecord(row.errorJson) as any } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function normalizeContextRef(row: Row): ProjectAssetLibraryContextRef | null {
  const ref: ProjectAssetLibraryContextRef = {};
  if (typeof row.productAssetId === 'string' && row.productAssetId.trim()) ref.productAssetId = row.productAssetId.trim();
  if (typeof row.commerceVideoAssetId === 'string' && row.commerceVideoAssetId.trim()) ref.commerceVideoAssetId = row.commerceVideoAssetId.trim();
  if (typeof row.sliceId === 'string' && row.sliceId.trim()) ref.sliceId = row.sliceId.trim();
  if (typeof row.purpose === 'string' && row.purpose.trim()) ref.purpose = row.purpose.trim();
  if (typeof row.note === 'string' && row.note.trim()) ref.note = row.note.trim();
  return ref.productAssetId || ref.commerceVideoAssetId || ref.sliceId ? ref : null;
}

function normalizeStatus(value: unknown): AssetLibraryStatus {
  return value === 'processing' ||
    value === 'needs_model' ||
    value === 'needs_video_file' ||
    value === 'needs_embedding_config' ||
    value === 'failed'
    ? value
    : 'ready';
}

function normalizeJobStatus(value: unknown): AssetLibraryJobStatus {
  return value === 'queued' ||
    value === 'running' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'interrupted'
    ? value
    : 'queued';
}

function normalizeJobKind(value: unknown): AssetLibraryJobKind {
  return value === 'ingest' ||
    value === 'slice' ||
    value === 'understand' ||
    value === 'embed' ||
    value === 'crawler-import' ||
    value === 'batch-process' ||
    value === 'methodology-summary'
    ? value
    : 'process';
}

function clampLimit(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(200, Math.max(1, Math.floor(n))) : 50;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): Record<string, any> {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  return isRecord(parsed) ? parsed : {};
}

function parseRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  const record = parseRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function parseArray(value: unknown): any[] {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonOrNull(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}
