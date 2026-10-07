/** Reading ffprobe's output and planning the proxy. Pure, so it is tested without ffmpeg. No imports. */

export type VideoInfo = {
  width: number;
  height: number;
  durationS: number | null;
  /** Exact: 30000/1001 stays that. */
  fpsNum: number;
  fpsDen: number;
  hasAudio: boolean;
};

type Stream = { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] };
type Probe = { streams?: Stream[]; format?: { duration?: string } };

const rational = (s: string | undefined): [number, number] | null => {
  const m = s?.match(/^(\d+)\/(\d+)$/);
  if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) return null;
  return [Number(m[1]), Number(m[2])];
};

/** Reads the first video stream. Throws a plain-English message for a file with none. */
export function parseProbe(json: Probe): VideoInfo {
  const v = json.streams?.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new Error("This file has no video in it. Export it as an MP4 or MOV and upload it again.");
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180 === 90;
  const [fpsNum, fpsDen] = rational(v.avg_frame_rate) ?? rational(v.r_frame_rate) ?? [30, 1];
  const dur = Number(json.format?.duration ?? v.duration);
  return {
    // ffmpeg turns a rotated phone clip upright, so the proxy is the other way round.
    width: rot ? v.height : v.width,
    height: rot ? v.width : v.height,
    durationS: Number.isFinite(dur) && dur > 0 ? dur : null,
    fpsNum,
    fpsDen,
    hasAudio: !!json.streams?.some((s) => s.codec_type === "audio"),
  };
}

/** The proxy's size: fits 1280×720 (or 720×1280 for portrait), never upscaled, both sides even for H.264. 720p keeps the free 1 GB store and 10 GB of monthly transfer going (plan §5.3). */
export function proxySize(width: number, height: number): { width: number; height: number } {
  const [maxW, maxH] = width >= height ? [1280, 720] : [720, 1280];
  const k = Math.min(1, maxW / width, maxH / height);
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}
