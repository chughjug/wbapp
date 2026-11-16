/**
 * {@link SyncBackend} implemented against a real Supabase project.
 *
 * Layout (see `supabase/schema.sql`):
 *
 * ```
 *   table   documents                         one row per notebook
 *   bucket  scenes / <uid>/<docId>/scene.json elements + appState + file ids
 *   bucket  files  / <uid>/<fileId>.json      one imported image or PDF page
 * ```
 *
 * Files are content-addressed (Excalidraw derives a file id from the bytes),
 * so they are uploaded once and never rewritten. That is what keeps a stroke
 * on a notebook with a 20 MB imported PDF a ~40 kB upload instead of a 20 MB
 * one.
 *
 * Every path begins with the user's own id, which is exactly what the
 * storage policies key on: `(storage.foldername(name))[1] = auth.uid()::text`.
 */

import { hasUploadedFile, markFileUploaded } from "./state";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BinaryFile,
  CommitInput,
  CommitResult,
  SyncBackend,
} from "./backend";

import type { RemoteDocRow, RemoteMeta, ScenePayload } from "./types";

export const SCENES_BUCKET = "scenes";
export const FILES_BUCKET = "files";

/** Row shape as Postgres returns it. */
interface DocumentsRow {
  id: string;
  title: string | null;
  course: string | null;
  due_date: string | null;
  tags: string[] | null;
  page_count: number | null;
  default_template: string | null;
  default_page_size: string | null;
  default_landscape: boolean | null;
  default_image_fit: string | null;
  thumbnail: string | null;
  scene_path: string | null;
  content_hash: string | null;
  version: number | null;
  device: string | null;
  deleted_at: string | null;
  client_created_at: string | null;
  client_updated_at: string | null;
}

const toMillis = (value: string | null): number | null =>
  value ? new Date(value).getTime() : null;

const toIso = (value: number | null): string | null =>
  value === null ? null : new Date(value).toISOString();

const rowToRemote = (row: DocumentsRow): RemoteDocRow => ({
  id: row.id,
  version: row.version ?? 1,
  contentHash: row.content_hash ?? "",
  device: row.device,
  deletedAt: toMillis(row.deleted_at),
  scenePath: row.scene_path,
  title: row.title ?? "Untitled notebook",
  course: row.course,
  dueDate: toMillis(row.due_date),
  tags: row.tags ?? [],
  pageCount: row.page_count ?? 1,
  defaultTemplate:
    (row.default_template as RemoteMeta["defaultTemplate"]) ?? "blank",
  defaultPageSize:
    (row.default_page_size as RemoteMeta["defaultPageSize"]) ?? "LETTER",
  ...(row.default_landscape === null
    ? {}
    : { defaultLandscape: row.default_landscape }),
  ...(row.default_image_fit === null
    ? {}
    : {
        defaultImageFit: row.default_image_fit as RemoteMeta["defaultImageFit"],
      }),
  thumbnail: row.thumbnail,
  createdAt: toMillis(row.client_created_at) ?? Date.now(),
  updatedAt: toMillis(row.client_updated_at) ?? Date.now(),
});

const metaToColumns = (input: CommitInput, userId: string) => ({
  id: input.id,
  user_id: userId,
  title: input.meta.title,
  course: input.meta.course,
  due_date: toIso(input.meta.dueDate),
  tags: input.meta.tags,
  page_count: input.meta.pageCount,
  default_template: input.meta.defaultTemplate,
  default_page_size: input.meta.defaultPageSize,
  default_landscape: input.meta.defaultLandscape ?? null,
  default_image_fit: input.meta.defaultImageFit ?? null,
  thumbnail: input.meta.thumbnail,
  scene_path: input.scenePath,
  content_hash: input.contentHash,
  device: input.device,
  client_created_at: toIso(input.meta.createdAt),
  client_updated_at: toIso(input.meta.updatedAt),
});

/**
 * Supabase surfaces a failed `.eq("version", n)` guard as "no rows", not as
 * an error, so an empty result is the conflict signal.
 */
const CONFLICT: CommitResult = { ok: false, reason: "conflict" };

/** Postgres unique-violation — the row already exists, so this was a race. */
const UNIQUE_VIOLATION = "23505";

export const createSupabaseBackend = (
  client: SupabaseClient,
  userId: string,
): SyncBackend => {
  const scenePathFor = (docId: string) => `${userId}/${docId}/scene.json`;
  const filePathFor = (fileId: string) => `${userId}/${fileId}.json`;

  return {
    listDocs: async () => {
      const { data, error } = await client
        .from("documents")
        .select(
          "id,title,course,due_date,tags,page_count,default_template,default_page_size,default_landscape,default_image_fit,thumbnail,scene_path,content_hash,version,device,deleted_at,client_created_at,client_updated_at",
        )
        .eq("user_id", userId);
      if (error) {
        throw new Error(error.message);
      }
      return ((data ?? []) as DocumentsRow[]).map(rowToRemote);
    },

    getScene: async (path: string) => {
      const { data, error } = await client.storage
        .from(SCENES_BUCKET)
        .download(path);
      if (error || !data) {
        return null;
      }
      try {
        return JSON.parse(await data.text()) as ScenePayload;
      } catch {
        return null;
      }
    },

    putScene: async (docId: string, payload: ScenePayload) => {
      const path = scenePathFor(docId);
      const { error } = await client.storage
        .from(SCENES_BUCKET)
        .upload(path, JSON.stringify(payload), {
          contentType: "application/json",
          upsert: true,
        });
      if (error) {
        throw new Error(error.message);
      }
      return path;
    },

    deleteScene: async (docId: string) => {
      // A missing object is not an error worth propagating: the end state
      // ("no scene on the server") is the one we asked for.
      await client.storage.from(SCENES_BUCKET).remove([scenePathFor(docId)]);
    },

    getFile: async (fileId: string) => {
      const { data, error } = await client.storage
        .from(FILES_BUCKET)
        .download(filePathFor(fileId));
      if (error || !data) {
        return null;
      }
      try {
        return JSON.parse(await data.text()) as BinaryFile;
      } catch {
        return null;
      }
    },

    putFile: async (file: BinaryFile) => {
      // Files are content-addressed, so an id this device has already
      // uploaded is byte-identical to what is on the server. Skipping the
      // call entirely matters: `upload(..., { upsert: false })` still sends
      // the body before the server answers 409, so without this memo every
      // stroke on a notebook with a 20 MB PDF would re-send 20 MB.
      if (await hasUploadedFile(file.id)) {
        return;
      }
      const { error } = await client.storage
        .from(FILES_BUCKET)
        .upload(filePathFor(file.id), JSON.stringify(file), {
          contentType: "application/json",
          upsert: false,
        });
      if (error && !/exists|duplicate|409/i.test(error.message)) {
        throw new Error(error.message);
      }
      await markFileUploaded(file.id);
    },

    commit: async (input: CommitInput): Promise<CommitResult> => {
      const columns = metaToColumns(input, userId);
      if (input.expectedVersion === 0) {
        const { data, error } = await client
          .from("documents")
          .insert({ ...columns, version: 1, deleted_at: null })
          .select()
          .maybeSingle();
        if (error) {
          // Somebody (another device, or an earlier pass whose response was
          // lost) inserted it first. Re-read on the next pass.
          if (error.code === UNIQUE_VIOLATION) {
            return CONFLICT;
          }
          throw new Error(error.message);
        }
        return data
          ? { ok: true, row: rowToRemote(data as DocumentsRow) }
          : CONFLICT;
      }

      const { data, error } = await client
        .from("documents")
        .update({
          ...columns,
          version: input.expectedVersion + 1,
          ...(input.undelete ? { deleted_at: null } : {}),
        })
        .eq("id", input.id)
        .eq("version", input.expectedVersion)
        .select()
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      return data
        ? { ok: true, row: rowToRemote(data as DocumentsRow) }
        : CONFLICT;
    },

    softDelete: async (
      docId: string,
      expectedVersion: number,
    ): Promise<CommitResult> => {
      const { data, error } = await client
        .from("documents")
        .update({
          deleted_at: new Date().toISOString(),
          version: expectedVersion + 1,
          scene_path: null,
        })
        .eq("id", docId)
        .eq("version", expectedVersion)
        .select()
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      return data
        ? { ok: true, row: rowToRemote(data as DocumentsRow) }
        : CONFLICT;
    },
  };
};
