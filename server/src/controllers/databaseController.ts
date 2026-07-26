import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { HostedApp } from '../models/HostedApp.js';
import { DbConnection, type DbConnectionDoc } from '../models/DbConnection.js';
import { StoreInstalledApp } from '../models/StoreInstalledApp.js';
import { ApiError } from '../middleware/error.js';
import { encrypt } from '../utils/crypto.js';
import { resolveDriver, SUPPORTED_ENGINES } from '../db-drivers/index.js';
import { DriverError, type DatabaseDriver, type ConnectionConfig } from '../db-drivers/types.js';
import { configFromManual, configFromStored, DEFAULT_PORTS } from '../services/connectionResolver.js';
import { detectDbFromEnv, redactDetected, type DetectedConnection } from '../services/deployDbDetect.js';

// ----------------------------- validation schemas -----------------------------

const engineSchema = z.enum(['postgresql', 'mysql', 'mongodb', 'sqlite', 'redis']);

/** Manual connection payload for both "test" and "save". */
export const connectionInputSchema = z.object({
  type: engineSchema,
  host: z.string().min(1).max(255).trim(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  user: z.string().max(255).trim().optional().default(''),
  password: z.string().max(2048).optional().default(''),
  database: z.string().max(255).trim().optional().default(''),
  sslMode: z.enum(['disable', 'require']).optional().default('disable'),
});
type ConnectionInput = z.infer<typeof connectionInputSchema>;

/** DELETE requires an explicit backend confirmation flag (defense in depth). */
export const deleteConnectionSchema = z.object({
  confirm: z.literal(true),
});

/** Confirm a detected connection: the password comes from the deploy env
 * (server-side), the admin only supplies the host reachable from Dashy. */
export const detectedSaveSchema = z.object({
  host: z.string().min(1).max(255).trim(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  user: z.string().max(255).trim().optional(),
  database: z.string().max(255).trim().optional(),
  sslMode: z.enum(['disable', 'require']).optional().default('disable'),
});

const rowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sortField: z.string().max(255).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  filterField: z.string().max(255).optional(),
  filterOp: z.enum(['eq', 'contains']).optional(),
  filterValue: z.string().max(1024).optional(),
});

// --------------------------------- helpers -----------------------------------

async function requireApp(appId: string): Promise<void> {
  if (!mongoose.isValidObjectId(appId)) throw new ApiError(400, 'Invalid app id');
  if (!(await HostedApp.exists({ _id: appId }))) throw new ApiError(404, 'App not found');
}

/** Load the stored connection + resolve its driver/config, or fail cleanly. */
async function requireConnection(
  appId: string,
): Promise<{ doc: DbConnectionDoc; driver: DatabaseDriver; config: ConnectionConfig }> {
  await requireApp(appId);
  const doc = await DbConnection.findOne({ appId });
  if (!doc) throw new ApiError(404, 'No database connection configured');
  const driver = resolveDriver(doc.type);
  if (!driver) throw new ApiError(501, `Engine "${doc.type}" is not supported yet`);
  return { doc, driver, config: configFromStored(doc) };
}

/** Detect a DB connection from the env vars of the app's Store deploy, if any. */
async function detectForApp(appId: string): Promise<DetectedConnection | null> {
  const installed = await StoreInstalledApp.findOne({ hostedApp: appId, type: 'deploy' });
  if (!installed) return null;
  const env = Object.fromEntries(installed.deployEnv ?? new Map()) as Record<string, string>;
  return detectDbFromEnv(env);
}

/** Run a driver call, mapping expected DB failures to a 502 (bad upstream). */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DriverError) throw new ApiError(502, err.message);
    throw err;
  }
}

// --------------------------------- handlers ----------------------------------

/** GET /connection — status + non-sensitive metadata (never a secret). */
export async function getConnection(req: Request, res: Response): Promise<void> {
  await requireApp(req.params.appId);
  const doc = await DbConnection.findOne({ appId: req.params.appId });
  if (doc) {
    res.json({
      status: 'configured',
      connection: doc.toJSON(),
      engineSupported: SUPPORTED_ENGINES.includes(doc.type),
    });
    return;
  }
  // No stored connection: offer a detection from the app's own deploy env, but
  // only for an engine we can actually use, and never leak the password.
  const detected = await detectForApp(req.params.appId);
  if (detected && resolveDriver(detected.type)) {
    res.json({ status: 'detected', detected: redactDetected(detected) });
    return;
  }
  res.json({ status: 'none' });
}

/** POST /connection/test — try a manual config without persisting anything. */
export async function testConnection(req: Request, res: Response): Promise<void> {
  await requireApp(req.params.appId);
  const input = req.body as ConnectionInput;
  const driver = resolveDriver(input.type);
  if (!driver) throw new ApiError(501, `Engine "${input.type}" is not supported yet`);
  const result = await driver.testConnection(configFromManual(input));
  res.json(result);
}

/** POST /connection — save (encrypting the password), one per app (upsert). */
export async function saveConnection(req: Request, res: Response): Promise<void> {
  await requireApp(req.params.appId);
  const input = req.body as ConnectionInput;
  if (!resolveDriver(input.type)) throw new ApiError(501, `Engine "${input.type}" is not supported yet`);

  const port = input.port && input.port > 0 ? input.port : DEFAULT_PORTS[input.type];
  const doc = await DbConnection.findOneAndUpdate(
    { appId: req.params.appId },
    {
      appId: req.params.appId,
      type: input.type,
      source: 'manual',
      host: input.host,
      port,
      user: input.user,
      database: input.database,
      sslMode: input.sslMode,
      // Empty password clears it; otherwise store the ciphertext only.
      passwordEnc: input.password ? encrypt(input.password) : null,
      // The UI enforces a successful test before save, so record the moment.
      lastTestedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ status: 'configured', connection: doc!.toJSON() });
}

/**
 * POST /connection/detected — confirm & save an auto-detected connection. The
 * password stays server-side (read from the deploy env, never sent to/from the
 * browser); the admin only supplies the host reachable from Dashy. Tests before
 * persisting so a wrong host is caught up front.
 */
export async function saveDetectedConnection(req: Request, res: Response): Promise<void> {
  await requireApp(req.params.appId);
  const detected = await detectForApp(req.params.appId);
  if (!detected) throw new ApiError(404, 'No database credentials detected for this app');
  const driver = resolveDriver(detected.type);
  if (!driver) throw new ApiError(501, `Engine "${detected.type}" is not supported yet`);

  const body = req.body as z.infer<typeof detectedSaveSchema>;
  const config: ConnectionConfig = {
    type: detected.type,
    host: body.host,
    port: body.port && body.port > 0 ? body.port : detected.port || DEFAULT_PORTS[detected.type],
    user: body.user?.trim() || detected.user,
    password: detected.password,
    database: body.database?.trim() || detected.database,
    ssl: body.sslMode,
  };

  const test = await driver.testConnection(config);
  if (!test.ok) {
    res.json({ ok: false, error: test.error ?? 'Connection failed' });
    return;
  }

  const doc = await DbConnection.findOneAndUpdate(
    { appId: req.params.appId },
    {
      appId: req.params.appId,
      type: config.type,
      source: 'auto',
      host: config.host,
      port: config.port,
      user: config.user,
      database: config.database,
      sslMode: body.sslMode,
      passwordEnc: config.password ? encrypt(config.password) : null,
      lastTestedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ ok: true, status: 'configured', connection: doc!.toJSON() });
}

/** DELETE /connection — remove the stored connection (requires confirm:true). */
export async function deleteConnection(req: Request, res: Response): Promise<void> {
  await requireApp(req.params.appId);
  await DbConnection.deleteOne({ appId: req.params.appId });
  res.json({ status: 'none' });
}

/** GET /schemas */
export async function listSchemas(req: Request, res: Response): Promise<void> {
  const { driver, config } = await requireConnection(req.params.appId);
  const schemas = await run(() => driver.listSchemas(config));
  res.json({ schemas });
}

/** GET /schemas/:schema/collections */
export async function listCollections(req: Request, res: Response): Promise<void> {
  const { driver, config } = await requireConnection(req.params.appId);
  const collections = await run(() => driver.listCollections(config, req.params.schema));
  res.json({ collections });
}

/** GET /schemas/:schema/collections/:name/fields */
export async function getCollectionFields(req: Request, res: Response): Promise<void> {
  const { driver, config } = await requireConnection(req.params.appId);
  const fields = await run(() =>
    driver.getCollectionSchema(config, req.params.schema, req.params.name),
  );
  res.json({ fields });
}

/** GET /schemas/:schema/collections/:name/rows */
export async function listRows(req: Request, res: Response): Promise<void> {
  const { driver, config } = await requireConnection(req.params.appId);
  const q = rowsQuerySchema.parse(req.query);

  const result = await run(() =>
    driver.listRows(config, req.params.schema, req.params.name, {
      page: q.page,
      pageSize: q.pageSize,
      sort: q.sortField ? { field: q.sortField, dir: q.sortDir ?? 'asc' } : undefined,
      filter:
        q.filterField && q.filterValue !== undefined
          ? { field: q.filterField, op: q.filterOp ?? 'contains', value: q.filterValue }
          : undefined,
    }),
  );
  res.json(result);
}
