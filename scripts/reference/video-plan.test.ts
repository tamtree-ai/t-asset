import { describe, expect, it } from "vitest";

import { parseProbe, proxySize } from "./video-plan";

describe("video plan", () => {
  it("keeps NTSC fps exact and finds audio", () => {
    const info = parseProbe({ streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30000/1001" }, { codec_type: "audio" }], format: { duration: "12.5" } });
    expect(info).toMatchObject({ width: 1920, height: 1080, fpsNum: 30000, fpsDen: 1001, durationS: 12.5, hasAudio: true });
  });
  it("falls back to r_frame_rate, then 30", () => {
    expect(parseProbe({ streams: [{ codec_type: "video", width: 10, height: 10, avg_frame_rate: "0/0", r_frame_rate: "25/1" }] })).toMatchObject({ fpsNum: 25, fpsDen: 1, hasAudio: false, durationS: null });
    expect(parseProbe({ streams: [{ codec_type: "video", width: 10, height: 10 }] })).toMatchObject({ fpsNum: 30, fpsDen: 1 });
  });
  it("swaps the sides of a clip rotated 90°", () => {
    expect(parseProbe({ streams: [{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] })).toMatchObject({ width: 1080, height: 1920 });
  });
  it("explains a file with no video", () => {
    expect(() => parseProbe({ streams: [{ codec_type: "audio" }] })).toThrow("no video");
  });
  it("sizes the proxy to 720p max, even, never upscaled", () => {
    expect(proxySize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(proxySize(2160, 3840)).toEqual({ width: 720, height: 1280 });
    expect(proxySize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(proxySize(641, 361)).toEqual({ width: 642, height: 362 });
  });
});
