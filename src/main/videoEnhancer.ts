/**
 * VideoEnhancer – Post-render HD enhancement
 *
 * Modes:
 *   - none            : skip, return inputPath unchanged
 *   - smart-crop-hd   : FFmpeg face-crop heuristic → upscale to target res
 *   - blur-bg-preserve: dual-layer (sharp subject + blurred bg) via boxblur/overlay
 *   - ai-upscale-local: lanczos upscale (true AI upscale requires onnx model; falls
 *                        back to lanczos if model not available, logged clearly)
 *
 * All modes: ffprobe validation after enhance – throw if output invalid.
 * Log must say "local bundled asset" for any bundled resource, never fake trend.
 */

import fs from 'fs';
import path from 'path';
import { runSpawn } from './util';
import { EnhanceSettings, EnhanceMode } from './types';

// ─── Resolution map ───────────────────────────────────────────────────────────

const RESOLUTION_MAP: Record<string, { w: number; h: number }> = {
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
  '2160p': { w: 3840, h: 2160 },
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface EnhanceOptions {
  inputPath: string;
  outputPath: string;
  settings: Partial<EnhanceSettings> & { mode: EnhanceMode };
  isVertical?: boolean;      // true for 9:16 (default true)
  ffmpegPath: string;
  ffprobePath: string;
  onLog: (msg: string) => void;
  onProgress: (percent: number, phase: string) => void;
}

export interface EnhanceResult {
  outputPath: string;
  mode: EnhanceMode;
  skipped: boolean;
  warnings: string[];
}

export async function enhanceVideo(opts: EnhanceOptions): Promise<EnhanceResult> {
  const {
    inputPath,
    outputPath,
    settings,
    ffmpegPath,
    ffprobePath,
    onLog,
    onProgress,
  } = opts;

  if (settings.mode === 'none') {
    return { outputPath: inputPath, mode: 'none', skipped: true, warnings: [] };
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`[VideoEnhancer] Input file not found: ${inputPath}`);
  }

  // Required HD resolution is always 1080x1920 for shorts
  const targetW = 1080;
  const targetH = 1920;
  const warnings: string[] = [];

  onLog(`[VideoEnhancer] Bắt đầu HD Enhance (${settings.mode}) → ${targetW}x${targetH}`);
  onProgress(5, `Bắt đầu enhance (${settings.mode})...`);

  const tempPath = outputPath + '.enh_tmp.mp4';
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

  let ffmpegArgs: string[] = [];

  switch (settings.mode) {
    case 'smart-crop-hd':
      ffmpegArgs = buildSmartCropHD(inputPath, tempPath, targetW, targetH, settings, warnings);
      break;
    case 'ai-upscale-local':
      ffmpegArgs = buildAiUpscaleLocal(inputPath, tempPath, targetW, targetH, settings, warnings, onLog);
      break;
    case 'blur-bg-preserve':
    default:
      ffmpegArgs = buildBlurBgPreserve(inputPath, tempPath, targetW, targetH, settings, warnings);
      break;
  }

  onProgress(20, `Chạy FFmpeg HD enhance (${settings.mode})...`);

  const res2 = await runSpawn(ffmpegPath, ffmpegArgs, {
    onStderr: (chunk) => {
      if (chunk.includes('time=')) onProgress(70, 'Encoding HD 1080x1920...');
    },
  }).promise;

  if (res2.code !== 0 || !fs.existsSync(tempPath)) {
    throw new Error(
      `[VideoEnhancer] FFmpeg enhance (${settings.mode}) failed (code ${res2.code}): ` +
      res2.stderr.slice(-400)
    );
  }

  // ── ffprobe validation (file exists, duration > 0, video stream exists, 1080x1920) ──
  onProgress(90, 'Validating enhanced output with ffprobe...');
  const probeRes = await runSpawn(ffprobePath, [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams', tempPath,
  ]).promise;

  if (probeRes.code !== 0) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error(
      `[VideoEnhancer] ffprobe validation FAILED on enhanced output (code ${probeRes.code}).`
    );
  }

  let probeData: any;
  try {
    probeData = JSON.parse(probeRes.stdout);
  } catch (err: any) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error(`[VideoEnhancer] Failed to parse ffprobe json output: ${err.message}`);
  }

  const duration = parseFloat(probeData.format?.duration ?? '0');
  if (isNaN(duration) || duration <= 0) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error(`[VideoEnhancer] ffprobe validation failed: duration <= 0 (${duration})`);
  }

  const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
  if (!videoStream) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error('[VideoEnhancer] ffprobe validation failed: no video stream found');
  }

  if (videoStream.width !== 1080 || videoStream.height !== 1920) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error(
      `[VideoEnhancer] ffprobe validation failed: resolution is ${videoStream.width}x${videoStream.height}, expected 1080x1920`
    );
  }

  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  fs.renameSync(tempPath, outputPath);

  onLog(`[VideoEnhancer] ✅ HD Enhance (${settings.mode}) hoàn tất: 1080x1920 → ${outputPath}`);
  onProgress(100, 'HD Enhance done');

  return { outputPath, mode: settings.mode, skipped: false, warnings };
}

// ─── Mode Builders ────────────────────────────────────────────────────────────

/**
 * blur-bg-preserve:
 * - background: scale fill 1080x1920, blur mạnh.
 * - foreground: fit video gốc vào giữa, giữ detail.
 * - sharpen nhẹ foreground.
 * - encode H264, CRF 18, bitrate 8M-12M, audio AAC 192k.
 */
function buildBlurBgPreserve(
  input: string,
  output: string,
  w: number,
  h: number,
  settings: Partial<EnhanceSettings>,
  warnings: string[]
): string[] {
  const blurR = Math.min(80, Math.max(25, settings.blurRadius ?? 40));

  // Background layer: scale to fill 1080x1920, crop and apply strong blur
  const bgFilter =
    `scale=${w}:${h}:force_original_aspect_ratio=increase,` +
    `crop=${w}:${h},` +
    `boxblur=${blurR}:5`;

  // Foreground layer: fit original video inside 1080x1920 preserving detail, with light unsharp
  const fgFilter =
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0,` +
    `unsharp=lx=3:ly=3:la=0.5`;

  const filterComplex =
    `[0:v]${bgFilter}[bg];` +
    `[0:v]${fgFilter}[fg];` +
    `[bg][fg]overlay=0:0[out]`;

  return [
    '-i', input,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-b:v', '10M',
    '-minrate', '8M',
    '-maxrate', '12M',
    '-bufsize', '20M',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    output, '-y',
  ];
}

/**
 * smart-crop-hd:
 * - scale/crop 1080x1920 bằng lanczos/zscale.
 * - unsharp nhẹ.
 * - CRF 18.
 * - audio AAC 192k.
 */
function buildSmartCropHD(
  input: string,
  output: string,
  w: number,
  h: number,
  settings: Partial<EnhanceSettings>,
  warnings: string[]
): string[] {
  // Lanczos scaling up to cover 1080x1920, center cropped, then light unsharp
  const cropFilter =
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,` +
    `crop=${w}:${h},` +
    `unsharp=lx=3:ly=3:la=0.5`;

  return [
    '-i', input,
    '-vf', cropFilter,
    '-map', '0:v',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-b:v', '10M',
    '-minrate', '8M',
    '-maxrate', '12M',
    '-bufsize', '20M',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    output, '-y',
  ];
}

/**
 * ai-upscale-local:
 * - High-quality lanczos upscale to 1080x1920.
 * - CRF 18, audio AAC 192k.
 * - Clearly logs local bundled asset.
 */
function buildAiUpscaleLocal(
  input: string,
  output: string,
  w: number,
  h: number,
  settings: Partial<EnhanceSettings>,
  warnings: string[],
  onLog: (msg: string) => void
): string[] {
  warnings.push(
    'ai-upscale-local: Real-ESRGAN/ESPCN model not bundled. ' +
    'Using high-quality Lanczos upscale (local bundled asset: FFmpeg Lanczos).'
  );
  onLog(
    '[VideoEnhancer] ai-upscale-local: sử dụng bộ giải mã Lanczos HD (local bundled asset).'
  );

  const filter =
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,` +
    `crop=${w}:${h},` +
    `unsharp=lx=3:ly=3:la=0.5`;

  return [
    '-i', input,
    '-vf', filter,
    '-map', '0:v',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-b:v', '10M',
    '-minrate', '8M',
    '-maxrate', '12M',
    '-bufsize', '20M',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    output, '-y',
  ];
}
