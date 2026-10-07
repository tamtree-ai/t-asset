export type { CommentView, ReviewApi, RoomAssetView, RoomVariationView, RoomVersionView, RoomFileView, VersionStatus } from "@/lib/studio/room-types";
export { fileUrl } from "@/lib/studio/room-types";

import type { Annotation } from "@/lib/studio/annotation";

/** What a stage lets the workspace do: read the clock and drive the video. Image stages implement the no-ops. */
export type StageHandle = {
  time(): number;
  seek(t: number): void;
  pause(): void;
  toggle(): void;
  /** Frames (video) or zoom steps (image). */
  step(n: number): void;
  speed(delta: number): void;
  /** Image: back to fit. */
  reset(): void;
  /** Image: zoom in on a spot of the picture (normalised). */
  focus(x: number, y: number): void;
};

export type Draft = Annotation;

/** A spot just placed on the work: the shape, and for video the moment it was placed. */
export type Placement = Pick<Annotation, "shape" | "x" | "y" | "w" | "h"> & { t?: number; frame?: number };
