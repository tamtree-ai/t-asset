/** Time ↔ frame ↔ "m:ss.ff" (plan §5.3). fps is an exact rational (30000/1001), never 29.97. */

export type Fps = { num: number; den: number };

export const fpsValue = (f: Fps): number => f.num / f.den;

/** The frame shown at `t` seconds. A tiny epsilon keeps 1/30 s from rounding down to frame 0 through float error. */
export function timeToFrame(t: number, fps: Fps): number {
  return Math.max(0, Math.floor((t * fps.num) / fps.den + 1e-6));
}

/** The start time of a frame, which is where the video must seek to show it. */
export function frameToTime(frame: number, fps: Fps): number {
  return (Math.max(0, frame) * fps.den) / fps.num;
}

/** `1:05.12` (minutes, seconds, frame within the second); `1:02:03.00` past an hour. Without fps, centiseconds' worth is dropped: `1:05`. */
export function formatTimecode(t: number, fps?: Fps | null): string {
  const safe = Math.max(0, t);
  const whole = Math.floor(safe + 1e-6);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const head = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  if (!fps) return head;
  const inSecond = timeToFrame(safe, fps) - timeToFrame(whole, fps);
  const width = String(Math.ceil(fpsValue(fps))).length;
  return `${head}.${String(Math.max(0, inSecond)).padStart(width, "0")}`;
}

/** "1:05" or "1:05.12" or "65" back to seconds; null when it is not a time. */
export function parseTimecode(text: string, fps?: Fps | null): number | null {
  const m = /^\s*(?:(\d+):)?(\d+):(\d{1,2})(?:\.(\d+))?\s*$/.exec(text) ?? /^\s*()()(\d+(?:\.\d+)?)()\s*$/.exec(text);
  if (!m) return null;
  if (m[2] === "") return Number(m[3]);
  const h = m[1] ? Number(m[1]) : 0;
  const secs = h * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if (m[4] === undefined) return secs;
  return fps ? secs + frameToTime(Number(m[4]), fps) : secs + Number(`0.${m[4]}`);
}
