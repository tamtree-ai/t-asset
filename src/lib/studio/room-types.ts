/** The shapes the room's client components share with the server (dates as ISO strings, so they cross the boundary). */
import type { CommentView } from "@/services/studio/comments";

export type { CommentView };

export type RoomFileView = { id: string; mime: string; width: number | null; height: number | null; durationS: number | null; fpsNum: number | null; fpsDen: number | null; processing: "uploading" | "pending" | "ready" | "failed"; bytes: number; originalName: string };

export type VersionStatus = "in_review" | "changes_requested" | "approved";

export type RoomVersionView = {
  id: string;
  number: number;
  status: VersionStatus;
  changeNote: string;
  createdAt: string;
  file: RoomFileView;
  /** The previews carry the watermark (the share has it on and the version isn't approved). */
  marked: boolean;
  canDownload: boolean;
  /** The newest of its option: the only one that can be approved. */
  latest: boolean;
  /** Last sign-off on this version, if any. */
  signoff: { decision: "approved" | "changes_requested"; name: string; at: string } | null;
};

export type RoomVariationView = { id: string; label: string; versions: RoomVersionView[] };
export type RoomAssetView = { id: string; title: string; kind: "image" | "video"; variations: RoomVariationView[] };

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string };
export type Res<T> = Ok<T> | Err;

/** What the room calls. The client room and the owner's asset page each bind these to their own server actions. */
export type ReviewApi = {
  threads(versionId: string): Promise<Res<CommentView[]>>;
  comment(versionId: string, input: { body: string; annotation?: unknown; internal?: boolean }): Promise<Res<CommentView[]>>;
  reply(versionId: string, input: { parentId: string; quoteId?: string | null; body: string; }): Promise<Res<CommentView[]>>;
  resolve(versionId: string, commentId: string, resolved: boolean): Promise<Res<CommentView[]>>;
  edit(versionId: string, commentId: string, body: string): Promise<Res<CommentView[]>>;
  remove(versionId: string, commentId: string): Promise<Res<CommentView[]>>;
  /** Owner only. */
  hide?(versionId: string, commentId: string): Promise<Res<CommentView[]>>;
  /** Client only. */
  decide?(input: { versionId: string; decision: "approved" | "changes_requested"; signedName?: string; confirm?: boolean; note?: string }): Promise<Res<{ status: VersionStatus }>>;
};

/** Where a file is served from, by audience. */
export function fileUrl(audience: "client" | "owner", token: string | null, fileId: string, rendition: "preview" | "poster" | "thumb" | "original", download = false): string {
  const base = audience === "client" ? `/review/${token}/file/${fileId}` : `/api/studio/files/${fileId}`;
  return `${base}?r=${rendition}${download ? "&download=1" : ""}`;
}
