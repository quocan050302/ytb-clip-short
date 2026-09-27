/**
 * RenderEngine – Advanced FFmpeg composition layer
 *
 * Replaces the raw FFmpeg code inside HypitAdapter.renderClip.
 * Reads a ClipEditPlan and builds:
 *   - Complex video filter graph (reframe, captions, visual overlays, effects)
 *   - Multi-track audio mix (speech + ducked BGM + beat-sync SFX)
 *
 * Rules:
 * - Logs must specify "hypit" or "ffmpeg-fallback" as render engine.
 * - Word-level captions are ONLY emitted when hasWordTiming = true.
 * - ASS subtitle burn-in uses DrawText path for word-highlight style.
 * - Completed = outputPath exists AND ffprobe reads it OK.
 */

import fs from 'fs';
import path from 'path';
import { runSpawn } from './util';
import {
  ClipEditPlan,
  ClipCandidate,
  JobSettings,
  TranscriptSegment,
  EffectPlan,
  TextOverlayPlan,
  VisualOverlayPlan,
  AudioEventPlan,
} from './types';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RenderOptions {
  clipId: string;
  projectDir: string;
  candidate: ClipCandidate;
  settings: JobSettings;
  cutVideoPath: string;        // already-cut A-roll segment
  outputPath: string;
  editPlan: ClipEditPlan;
  relevantSegments: TranscriptSegment[];
  ffmpegPath: string;
  ffprobePath: string;
  onProgress: (percent: number, phase: string) => void;
  onLog: (msg: string) => void;
}

export interface RenderResult {
  outputPath: string;
  engine: 'hypit' | 'ffmpeg-fallback';
  duration: number;
}

/**
 * Main render function. Builds the FFmpeg filter_complex and executes.
 * Returns RenderResult only if the output file passes ffprobe validation.
 */
export async function renderWithEditPlan(opts: RenderOptions): Promise<RenderResult> {
  const { clipId, projectDir, candidate, settings, cutVideoPath,
    outputPath, editPlan, relevantSegments, ffmpegPath, ffprobePath,
    onProgress, onLog } = opts;

  const reportProgress = onProgress || (() => {});
  const reportLog = onLog || (() => {});

  reportProgress(30, 'Xây dựng filter graph FFmpeg...');
  reportLog(`[RenderEngine][${clipId}] Bắt đầu render với FFmpeg (ffmpeg-fallback engine)`);

  const tempPath = path.join(projectDir, `re_tmp_${clipId}.mp4`);
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

  // ── Input list ─────────────────────────────────────────────────────────────
  const ffmpegArgs: string[] = ['-i', cutVideoPath];
  let nextInput = 1;

  // Visual overlay inputs (meme images / stickers)
  const visualInputs: Array<{ inputIdx: number; plan: VisualOverlayPlan }> = [];
  for (const vo of (editPlan.visualOverlays || [])) {
    if (vo.type === 'meme-image' || vo.type === 'sticker') {
      if (fs.existsSync(vo.assetPath)) {
        ffmpegArgs.push('-i', vo.assetPath);
        visualInputs.push({ inputIdx: nextInput++, plan: vo });
      } else {
        reportLog(`[RenderEngine] WARN: Visual overlay asset missing: ${vo.assetPath} – skipping`);
      }
    }
  }

  // BGM input
  let bgmInputIdx = -1;
  if (settings.bgm && editPlan.musicTrack && fs.existsSync(editPlan.musicTrack.filePath)) {
    ffmpegArgs.push('-stream_loop', '-1', '-i', editPlan.musicTrack.filePath);
    bgmInputIdx = nextInput++;
  }

  // SFX / audio event inputs
  const audioInputs: Array<{ inputIdx: number; plan: AudioEventPlan }> = [];
  for (const ae of (editPlan.audioEvents || [])) {
    if (ae.type === 'sfx' || ae.type === 'stinger') {
      if (fs.existsSync(ae.assetPath)) {
        ffmpegArgs.push('-i', ae.assetPath);
        audioInputs.push({ inputIdx: nextInput++, plan: ae });
      } else {
        reportLog(
          `[RenderEngine][${clipId}] LỖI: File SFX "${ae.assetPath}" cho sự kiện "${ae.id}" không tồn tại trên ổ đĩa – bỏ qua sự kiện này (không tự thay thế bằng âm thanh khác)`
        );
      }
    }
  }

  // ── Video filter graph ─────────────────────────────────────────────────────
  const vfChains: string[] = [];
  let currentVLabel = '0:v';

  // Step 1: Reframe / aspect ratio
  if (settings.aspectRatio === '9:16') {
    vfChains.push(
      `[${currentVLabel}]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920[v_reframe]`
    );
  } else {
    vfChains.push(
      `[${currentVLabel}]scale=1920:1080:force_original_aspect_ratio=decrease,` +
      `pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v_reframe]`
    );
  }
  currentVLabel = 'v_reframe';

  // Step 2: Effects (zoom-punch, shake, flash, vignette, color-grade)
  const sortedEffects = [...(editPlan.effects || [])].sort((a, b) => a.start - b.start);
  currentVLabel = applyEffects(vfChains, currentVLabel, sortedEffects, candidate.duration);

  // Step 3: Captions (ASS burn-in)
  if (settings.captions) {
    const realSegments = relevantSegments.filter(
      (s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text)
    );

    if (realSegments.length === 0) {
      onLog(`[RenderEngine][${clipId}] Không có transcript thật, captions đã được bỏ qua.`);
    } else {
      const assPath = path.join(projectDir, `captions_${clipId}.ass`);
      
      if (editPlan.hasWordTiming && settings.wordLevelCaptions) {
        generateWordLevelAss(assPath, editPlan.textOverlays, settings.preset);
        onLog(`[RenderEngine][${clipId}] Word-level captions (real timing) burned in`);
      } else {
        generateSegmentAss(assPath, realSegments, candidate.start, settings.preset);
        if (settings.wordLevelCaptions) {
          onLog(`[RenderEngine][${clipId}] WARN: wordLevelCaptions=true but hasWordTiming=false – using segment-level captions`);
        }
      }

      if (fs.existsSync(assPath)) {
        const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        vfChains.push(`[${currentVLabel}]subtitles=${escapedAss}[v_sub]`);
        currentVLabel = 'v_sub';
      }
    }
  }

  // Step 4: Visual overlays (meme images at beat timestamps)
  visualInputs.forEach(({ inputIdx, plan }, i) => {
    const outLabel = `v_overlay_${i}`;
    const x = Math.round(plan.xNorm * (settings.aspectRatio === '9:16' ? 1080 : 1920));
    const y = Math.round(plan.yNorm * (settings.aspectRatio === '9:16' ? 1920 : 1080));
    const w = Math.round(plan.widthNorm * (settings.aspectRatio === '9:16' ? 1080 : 1920));
    const h = Math.round(plan.heightNorm * (settings.aspectRatio === '9:16' ? 1920 : 1080));
    
    vfChains.push(
      `[${inputIdx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `format=rgba,colorchannelmixer=aa=${plan.opacity}[meme_s_${i}];` +
      `[${currentVLabel}][meme_s_${i}]overlay=x=${x}:y=${y}:` +
      `enable='between(t,${plan.start.toFixed(2)},${plan.end.toFixed(2)})'[${outLabel}]`
    );
    currentVLabel = outLabel;
  });

  // Step 5: Callout text (drawtext – if callouts enabled)
  if (settings.callouts) {
    const calloutPlans = editPlan.textOverlays.filter(
      (t) => (t.style === 'callout' || t.style === 'lower-third') && !/^\[Đoạn nói \d+\]/i.test(t.text)
    );
    calloutPlans.forEach((co, i) => {
      const outLabel = `v_callout_${i}`;
      const canvasW = settings.aspectRatio === '9:16' ? 1080 : 1920;
      const canvasH = settings.aspectRatio === '9:16' ? 1920 : 1080;
      const px = Math.round(co.xNorm * canvasW);
      const py = Math.round(co.yNorm * canvasH);
      const safeText = co.text.replace(/'/g, "\\'").replace(/:/g, '\\:');
      const hexColor = co.color.replace('#', '');
      
      vfChains.push(
        `[${currentVLabel}]drawtext=` +
        `text='${safeText}':` +
        `fontsize=${co.fontSize}:` +
        `fontcolor=0x${hexColor}:` +
        `x=${px}:y=${py}:` +
        `enable='between(t,${co.start.toFixed(2)},${co.end.toFixed(2)})'` +
        `[${outLabel}]`
      );
      currentVLabel = outLabel;
    });
  }

  // ── Audio filter graph ─────────────────────────────────────────────────────
  const afChains: string[] = [];
  const hasBaseAudio = await probeHasAudio(cutVideoPath, ffprobePath);
  let baseAudioLabel = '[0:a]';
  if (!hasBaseAudio) {
    onLog(`[RenderEngine][${clipId}] Video nguồn không có audio stream -> tạo silent audio base`);
    afChains.push(
      `aevalsrc=0:d=${candidate.duration.toFixed(2)}:s=44100:c=stereo[a_silent_base]`
    );
    baseAudioLabel = '[a_silent_base]';
  }
  const mixLabels: string[] = [baseAudioLabel];

  // BGM with ducking
  if (bgmInputIdx !== -1) {
    const { normalVolume, duckedVolume, fadeInDuration, fadeOutDuration } =
      editPlan.duckingSettings;
    const clipDur = candidate.duration;

    const speechIntervals = relevantSegments
      .map((s) => ({
        st: Math.max(0, s.start - candidate.start),
        et: Math.min(clipDur, s.end - candidate.start),
      }))
      .filter((iv) => iv.et > iv.st);

    let duckExpr = `${normalVolume}`;
    if (speechIntervals.length > 0) {
      const conds = speechIntervals
        .map((iv) => `between(t,${iv.st.toFixed(2)},${iv.et.toFixed(2)})`)
        .join('+');
      duckExpr = `if(${conds},${duckedVolume},${normalVolume})`;
    }

    const fadeOutStart = Math.max(0, clipDur - fadeOutDuration);
    afChains.push(
      `[${bgmInputIdx}:a]` +
      `volume=eval=frame:volume='${duckExpr}',` +
      `afade=t=in:st=0:d=${fadeInDuration},` +
      `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOutDuration}` +
      `[a_bgm]`
    );
    mixLabels.push('[a_bgm]');
  }

  // SFX events: probe real file duration, clamp fades, volume, internal afade then adelay
  for (let i = 0; i < audioInputs.length; i++) {
    const { inputIdx, plan } = audioInputs[i];
    const fileDur = await probeAudioDuration(plan.assetPath, ffprobePath);
    const clipDur = candidate.duration;
    const trig = Math.max(0, Math.min(clipDur - 0.05, plan.triggerAt));
    const maxPossibleDur = Math.max(0.1, clipDur - trig);
    const chosenDur = (plan.duration && plan.duration > 0) ? plan.duration : fileDur;
    const playDuration = Math.min(chosenDur, fileDur, maxPossibleDur);

    const clampedFadeIn = Math.min(Math.max(0, plan.fadeIn ?? 0.05), playDuration / 2);
    const clampedFadeOut = Math.min(Math.max(0, plan.fadeOut ?? 0.2), playDuration - clampedFadeIn);
    const fadeOutStart = Math.max(0, playDuration - clampedFadeOut);
    const clampedVolume = Math.max(0.05, Math.min(2.0, plan.volume ?? 0.85));
    const delayMs = Math.max(0, Math.round(trig * 1000));
    const label = `a_sfx_${i}`;

    afChains.push(
      `[${inputIdx}:a]atrim=end=${playDuration.toFixed(3)},` +
      `asetpts=PTS-STARTPTS,` +
      `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
      `volume=${clampedVolume.toFixed(2)},` +
      `afade=t=in:st=0:d=${clampedFadeIn.toFixed(3)},` +
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${clampedFadeOut.toFixed(3)},` +
      `adelay=${delayMs}|${delayMs}` +
      `[${label}]`
    );
    mixLabels.push(`[${label}]`);
  }

  // ── Assemble filter_complex ────────────────────────────────────────────────
  let filterComplex = '';
  if (vfChains.length > 0) {
    filterComplex += vfChains.join(';') + ';';
  }

  let finalALabel = hasBaseAudio ? '0:a' : 'a_silent_base';
  if (mixLabels.length > 1) {
    filterComplex += afChains.join(';') + ';';
    filterComplex += `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2,alimiter=limit=0.95:level=true:attack=5:release=50[a_out]`;
    finalALabel = 'a_out';
  } else if (!hasBaseAudio) {
    filterComplex += afChains.join(';') + ';';
    finalALabel = 'a_silent_base';
  }

  ffmpegArgs.push(
    '-filter_complex', filterComplex,
    '-map', `[${currentVLabel}]`,
    '-map', `[${finalALabel}]`,
    '-t', candidate.duration.toFixed(2),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    tempPath,
    '-y',
  );

  reportProgress(50, 'Đang render FFmpeg (ffmpeg-fallback)...');

  const { promise, cancel } = runSpawn(ffmpegPath, ffmpegArgs, {
    onStderr: (chunk) => {
      if (chunk.includes('time=')) {
        reportProgress(80, 'Encoding MP4...');
      }
    },
  });

  const res = await promise;

  if (res.code !== 0 || !fs.existsSync(tempPath)) {
    throw new Error(
      `[RenderEngine] FFmpeg failed (code ${res.code}): ${res.stderr.slice(-500)}`
    );
  }

  // ── ffprobe validation ─────────────────────────────────────────────────────
  reportProgress(90, 'Kiểm tra file output bằng ffprobe...');
  const probeRes = await runSpawn(ffprobePath, [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams', tempPath,
  ]).promise;

  if (probeRes.code !== 0) {
    fs.unlinkSync(tempPath);
    throw new Error(
      `[RenderEngine] ffprobe validation FAILED – output MP4 không đọc được. ` +
      `Xem log FFmpeg để tìm nguyên nhân.`
    );
  }

  const probeData = JSON.parse(probeRes.stdout);
  const duration = parseFloat(probeData.format?.duration ?? '0');

  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  fs.renameSync(tempPath, outputPath);

  reportLog(
    `[RenderEngine][${clipId}] ✅ Render xong (engine: ffmpeg-fallback). ` +
    `Output: ${outputPath} | Duration: ${duration.toFixed(2)}s`
  );
  reportProgress(100, 'Hoàn tất render');

  return { outputPath, engine: 'ffmpeg-fallback', duration };
}

// ─── Effects Builder ──────────────────────────────────────────────────────────

function applyEffects(
  vfChains: string[],
  currentLabel: string,
  effects: EffectPlan[],
  clipDuration: number
): string {
  if (effects.length === 0) return currentLabel;

  let label = currentLabel;

  effects.forEach((eff, i) => {
    const outLabel = `v_eff_${i}`;
    const st = eff.start.toFixed(2);
    const et = eff.end.toFixed(2);
    const intensity = Math.min(1, Math.max(0, eff.intensity));

    switch (eff.effect) {
      case 'zoom-punch': {
        // Scale up slightly at the moment then return
        const scale = 1 + intensity * 0.15;
        vfChains.push(
          `[${label}]zoompan=z='if(between(t,${st},${et}),${scale.toFixed(3)},1)':` +
          `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':` +
          `d=1:s=iw x ih[${outLabel}]`
        );
        break;
      }
      case 'shake': {
        const px = Math.round(intensity * 12);
        vfChains.push(
          `[${label}]crop=iw-${px * 2}:ih-${px * 2}:` +
          `x='if(between(t,${st},${et}),${px}+${px}*sin(t*30),0)':` +
          `y='if(between(t,${st},${et}),${px}+${px}*cos(t*30),0)'[${outLabel}]`
        );
        break;
      }
      case 'flash': {
        const bright = 1 + intensity * 2.5;
        vfChains.push(
          `[${label}]eq=brightness='if(between(t,${st},min(${st}+0.1,${et})),${bright.toFixed(2)},0)'[${outLabel}]`
        );
        break;
      }
      case 'vignette': {
        vfChains.push(
          `[${label}]vignette=angle=${(intensity * 0.8).toFixed(3)}:` +
          `mode=backward:eval=frame[${outLabel}]`
        );
        break;
      }
      case 'color-grade': {
        // Warm cinematic grade: slight saturation boost + contrast
        const sat = 1 + intensity * 0.4;
        const cont = 1 + intensity * 0.2;
        vfChains.push(
          `[${label}]eq=saturation=${sat.toFixed(2)}:contrast=${cont.toFixed(2)}:` +
          `gamma_r=1.05:gamma_b=0.95[${outLabel}]`
        );
        break;
      }
      case 'slow-mo': {
        // setpts to slow down (0.5x speed = 2x duration – use with trim)
        const factor = 1 + intensity; // 1.0 intensity → 2x slow
        vfChains.push(
          `[${label}]setpts=if(between(t,${st},${et}),PTS*${factor.toFixed(2)},PTS)[${outLabel}]`
        );
        break;
      }
      default:
        // Pass-through for unknown effects
        vfChains.push(`[${label}]copy[${outLabel}]`);
    }
    label = outLabel;
  });

  return label;
}

// ─── ASS Caption Generators ───────────────────────────────────────────────────

function assHeader(preset: string): string {
  const isCinematic = preset === 'documentary';
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${isCinematic ? 'Montserrat' : 'Outfit'},${isCinematic ? '72' : '80'},&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,-1,0,0,0,100,100,0,0,1,${isCinematic ? '3' : '4'},${isCinematic ? '1' : '2'},2,60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

function secToAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Segment-level ASS (used when no word timing) */
function generateSegmentAss(
  outPath: string,
  segments: TranscriptSegment[],
  clipStartOffset: number,
  preset: string
): void {
  const validSegments = segments.filter(
    (s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text)
  );
  if (validSegments.length === 0) return;

  let content = assHeader(preset);
  for (const seg of validSegments) {
    const relStart = Math.max(0, seg.start - clipStartOffset);
    const relEnd = Math.max(relStart + 0.1, seg.end - clipStartOffset);
    // Clamp text – no placeholders
    const text = seg.text.replace(/\n/g, '\\N');
    if (!text.trim()) continue;
    content += `Dialogue: 0,${secToAssTime(relStart)},${secToAssTime(relEnd)},Caption,,0,0,0,,${text}\n`;
  }
  fs.writeFileSync(outPath, content, 'utf8');
}

/** Word-level ASS using TextOverlayPlan (word-highlight style) */
function generateWordLevelAss(
  outPath: string,
  textOverlays: TextOverlayPlan[],
  preset: string
): void {
  const wordOverlays = textOverlays.filter(
    (t) => (t.style === 'caption' || t.style === 'word-highlight') && !/^\[Đoạn nói \d+\]/i.test(t.text)
  );
  if (wordOverlays.length === 0) return;

  let content = assHeader(preset);
  for (const wo of wordOverlays) {
    const text = wo.text.replace(/\n/g, '\\N');
    if (!text.trim()) continue;
    content += `Dialogue: 0,${secToAssTime(wo.start)},${secToAssTime(wo.end)},Caption,,0,0,0,,${text}\n`;
  }
  fs.writeFileSync(outPath, content, 'utf8');
}

/**
 * Probe audio duration using ffprobe
 */
export async function probeAudioDuration(filePath: string, ffprobePath: string = 'ffprobe'): Promise<number> {
  try {
    const res = await runSpawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]).promise;
    if (res.code === 0 && res.stdout.trim()) {
      const dur = parseFloat(res.stdout.trim());
      if (!isNaN(dur) && dur > 0) return dur;
    }
  } catch {}
  return 1.5;
}

/**
 * Check if a media file contains an audio stream
 */
export async function probeHasAudio(filePath: string, ffprobePath: string = 'ffprobe'): Promise<boolean> {
  try {
    const res = await runSpawn(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]).promise;
    return res.code === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

