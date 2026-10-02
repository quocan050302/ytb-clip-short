import fs from 'fs';
import path from 'path';
import { ClipCandidate, ClipEditPlan, MomentEvent, PublishStatus, ThumbnailFrame, ThumbnailLayout, TranscriptSegment } from './types';
import { runSpawn, runSpawnBinary } from './util';

export interface ShortsCopy {
  publishTitle: string;
  publishTitleOptions: string[];
  thumbnailHook: string;
  hashtags: string[];
  publishStatus: PublishStatus;
  publishWarning?: string;
}

export interface PublishMetadata {
  title: string;
  titleOptions: string[];
  thumbnailHook: string;
  hashtags: string[];
  selectedFrameId?: string;
  selectedFrameTimestamp?: number;
  layout: ThumbnailLayout;
  thumbnailPath: string;
  frames: Array<{
    id: string;
    timestamp: number;
    path: string;
    score: number;
    reason: string;
  }>;
  status: PublishStatus;
  warning?: string;
}

const PEOPLE: Array<[RegExp, string, string]> = [
  [/\bkai\s+cenat\b/i, 'Kai Cenat', '#KaiCenat'],
  [/\brayquan\b|\bray\s*asian\s*boy\b/i, 'Rayquan', '#Rayquan'],
  [/\btota\b/i, 'Tota', '#Tota'],
  [/\bfanum\b/i, 'Fanum', '#Fanum'],
  [/\bduke\s+dennis\b/i, 'Duke Dennis', '#DukeDennis'],
  [/\brakai\b|\bra\s*kai\b/i, 'Rakai', '#Rakai'],
  [/\bamp\b/i, 'AMP', '#AMP'],
];

const REACTIONS: Array<[RegExp, string]> = [
  [/\b(no way|ain't no way)\b/i, 'NO WAY'],
  [/\b(what just happened|what happened)\b/i, 'WHAT HAPPENED?'],
  [/\b(are you serious|you serious)\b/i, 'YOU SERIOUS?'],
  [/\b(oh my god|omg)\b/i, 'OH MY GOD'],
  [/\bhe lost\b/i, 'HE LOST'],
  [/\bshe lost\b/i, 'SHE LOST'],
  [/\bi lost\b/i, 'I LOST'],
];

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

function getSystemFontPath(): string | null {
  const fontPaths = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial.ttf',
  ];
  for (const fp of fontPaths) {
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

/**
 * 1. Build frame timestamps
 * - 7–9 evenly spaced points between 8% and 90% of probed MP4 duration.
 * - Key moments from candidate.editPlan.moments (hook, surprise, punchline, fail or confidence > 0.6).
 * - Moments timestamps are RELATIVE to clip (0 to clip duration). DO NOT add candidate.start!
 * - Include ±0.4s offsets around moments.
 * - Clamped to [0, duration), deduped (min 0.45s apart), capped at ~15 points.
 */
export function buildFrameTimestamps(
  duration: number,
  candidate: ClipCandidate,
  editPlan?: ClipEditPlan
): number[] {
  if (duration <= 0) return [0];

  const points: number[] = [];

  // 1. Evenly distributed 8 points across 8% to 90%
  const stepCount = 8;
  const startRatio = 0.08;
  const endRatio = 0.90;
  for (let i = 0; i < stepCount; i++) {
    const ratio = startRatio + (endRatio - startRatio) * (i / (stepCount - 1));
    points.push(duration * ratio);
  }

  // 2. Add moments (relative to clip start)
  const moments: MomentEvent[] = (editPlan?.moments || candidate.editPlan?.moments || []);
  const keyMomentTypes = new Set(['hook', 'surprise', 'punchline', 'fail']);

  for (const m of moments) {
    const isKeyType = keyMomentTypes.has(m.momentType);
    const hasHighConf = (m.confidence ?? 0) >= 0.6;
    if (isKeyType || hasHighConf) {
      const relTs = m.timestamp; // MomentEvent.timestamp is already relative to clip
      points.push(relTs);
      points.push(relTs - 0.4);
      points.push(relTs + 0.4);
    }
  }

  // 3. Clamp into [0, duration - 0.05]
  const maxTime = Math.max(0, duration - 0.05);
  const clamped = points.map(t => Math.max(0, Math.min(maxTime, t)));

  // 4. Sort and deduplicate if closer than 0.45s
  clamped.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const t of clamped) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1] >= 0.45) {
      deduped.push(Number(t.toFixed(2)));
    }
  }

  // 5. Cap at 15 points
  if (deduped.length <= 15) {
    return deduped;
  }

  // Select evenly from deduped array to fit max 15
  const result: number[] = [];
  const stride = (deduped.length - 1) / 14;
  for (let i = 0; i < 15; i++) {
    const idx = Math.min(deduped.length - 1, Math.round(i * stride));
    if (!result.includes(deduped[idx])) {
      result.push(deduped[idx]);
    }
  }
  return result;
}

/**
 * 2. Extract frame candidates using FFmpeg with sub-second precision
 */
export async function extractFrameCandidates(
  videoPath: string,
  timestamps: number[],
  outputDir: string,
  ffmpegPath: string
): Promise<ThumbnailFrame[]> {
  fs.mkdirSync(outputDir, { recursive: true });
  const frames: ThumbnailFrame[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const frameId = `frame_${i}`;
    const frameName = `${frameId}_${ts.toFixed(2).replace('.', '_')}s.jpg`;
    const framePath = path.join(outputDir, frameName);

    try {
      const { promise } = runSpawn(ffmpegPath, [
        '-ss', ts.toFixed(2),
        '-i', videoPath,
        '-frames:v', '1',
        '-q:v', '2',
        framePath,
        '-y',
      ], { timeoutMs: 15000 });

      const result = await promise;
      if (result.code === 0 && fs.existsSync(framePath) && fs.statSync(framePath).size > 0) {
        frames.push({
          id: frameId,
          timestamp: ts,
          path: framePath,
          score: 50,
          reason: 'Khung hình hợp lệ',
        });
      }
    } catch {
      // Continue with other frames
    }
  }

  return frames;
}

/**
 * 3. Score frame candidates using 32x32 raw grayscale pixels & Node math.
 * - Calculates luminance, contrast, and relative sharpness.
 * - Heavily penalizes black, overexposed, or blurry frames.
 * - Proximity bonus for key moments (only if base quality is decent).
 * - Pixel difference comparison for diversity to pick 3 distinct frames.
 */
export async function scoreFrameCandidates(
  frames: ThumbnailFrame[],
  moments: MomentEvent[],
  ffmpegPath: string
): Promise<{ scoredFrames: ThumbnailFrame[]; topFrames: ThumbnailFrame[]; selectedFrame: ThumbnailFrame }> {
  if (frames.length === 0) {
    throw new Error('Không có khung hình nào được trích xuất từ video');
  }

  interface AnalyzedFrame {
    frame: ThumbnailFrame;
    pixels: Buffer | null;
    mean: number;
    contrast: number;
    sharpness: number;
    darkRatio: number;
    brightRatio: number;
    score: number;
    reason: string;
  }

  const analyzed: AnalyzedFrame[] = [];

  for (const frame of frames) {
    try {
      const { promise } = runSpawnBinary(ffmpegPath, [
        '-i', frame.path,
        '-vf', 'scale=32:32,format=gray',
        '-f', 'rawvideo',
        '-',
      ], { timeoutMs: 10000 });

      const res = await promise;
      if (res.code === 0 && res.stdout.length === 1024) {
        const buf = res.stdout;
        let sum = 0;
        let darkCount = 0;
        let brightCount = 0;

        for (let i = 0; i < 1024; i++) {
          const val = buf[i];
          sum += val;
          if (val < 25) darkCount++;
          if (val > 230) brightCount++;
        }

        const mean = sum / 1024;
        const darkRatio = darkCount / 1024;
        const brightRatio = brightCount / 1024;

        // Variance / Contrast
        let varSum = 0;
        for (let i = 0; i < 1024; i++) {
          const diff = buf[i] - mean;
          varSum += diff * diff;
        }
        const contrast = Math.sqrt(varSum / 1024);

        // Sharpness: average absolute difference between adjacent pixels in 32x32 grid
        let diffSum = 0;
        let diffCount = 0;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const idx = y * 32 + x;
            if (x < 31) {
              diffSum += Math.abs(buf[idx] - buf[idx + 1]);
              diffCount++;
            }
            if (y < 31) {
              diffSum += Math.abs(buf[idx] - buf[idx + 32]);
              diffCount++;
            }
          }
        }
        const sharpness = diffCount > 0 ? diffSum / diffCount : 0;

        // Base quality scoring
        let penalty = 0;
        let defectReason = '';
        if (darkRatio > 0.60 || mean < 25) {
          penalty += 65;
          defectReason = 'Ảnh quá tối hoặc gần đen';
        }
        if (brightRatio > 0.60 || mean > 230) {
          penalty += 65;
          defectReason = defectReason ? `${defectReason}, cháy sáng` : 'Ảnh bị cháy sáng';
        }
        if (contrast < 14) {
          penalty += 35;
          defectReason = defectReason ? `${defectReason}, tương phản kém` : 'Độ tương phản thấp';
        }
        if (sharpness < 4) {
          penalty += 35;
          defectReason = defectReason ? `${defectReason}, mờ chi tiết` : 'Ảnh mờ hoặc thiếu chi tiết';
        }

        const contrastScore = Math.min(38, contrast * 0.75);
        const sharpnessScore = Math.min(37, sharpness * 2.8);
        const lumScore = Math.max(0, 25 - Math.abs(mean - 128) * 0.25);
        const baseQuality = Math.max(5, Math.min(100, (contrastScore + sharpnessScore + lumScore) - penalty));

        // Moment proximity bonus (only if base quality is decent, so moments never rescue black/blurry frames)
        let momentBonus = 0;
        let matchedMoment: MomentEvent | null = null;
        if (baseQuality >= 35) {
          for (const m of moments) {
            const dist = Math.abs(frame.timestamp - m.timestamp);
            if (dist <= 0.6) {
              const bonus = (1 - dist / 0.6) * 16 * (m.confidence || 0.8);
              if (bonus > momentBonus) {
                momentBonus = bonus;
                matchedMoment = m;
              }
            }
          }
        }

        const finalScore = Math.round(Math.max(1, Math.min(100, baseQuality + momentBonus)));
        let reason = '';
        if (defectReason) {
          reason = defectReason;
        } else if (matchedMoment) {
          reason = `Gần khoảnh khắc ${matchedMoment.momentType} (${matchedMoment.timestamp.toFixed(1)}s), độ nét và tương phản tốt`;
        } else {
          reason = `Ánh sáng cân bằng, tương phản ${contrast.toFixed(0)}, độ nét rõ (${sharpness.toFixed(1)})`;
        }

        analyzed.push({
          frame,
          pixels: buf,
          mean,
          contrast,
          sharpness,
          darkRatio,
          brightRatio,
          score: finalScore,
          reason,
        });
      } else {
        analyzed.push({
          frame,
          pixels: null,
          mean: 0,
          contrast: 0,
          sharpness: 0,
          darkRatio: 1,
          brightRatio: 0,
          score: 10,
          reason: 'Không phân tích được pixel',
        });
      }
    } catch {
      analyzed.push({
        frame,
        pixels: null,
        mean: 0,
        contrast: 0,
        sharpness: 0,
        darkRatio: 1,
        brightRatio: 0,
        score: 10,
        reason: 'Lỗi phân tích khung hình',
      });
    }
  }

  // Update original frames with scores and reasons
  const scoredFrames: ThumbnailFrame[] = analyzed.map(a => ({
    ...a.frame,
    score: a.score,
    reason: a.reason,
  }));

  // Sort by score descending
  const sorted = [...analyzed].sort((a, b) => b.score - a.score);

  // Helper to compute mean absolute pixel difference between two 32x32 frames
  function getPixelDiff(p1: Buffer | null, p2: Buffer | null): number {
    if (!p1 || !p2 || p1.length !== 1024 || p2.length !== 1024) return 999;
    let diff = 0;
    for (let i = 0; i < 1024; i++) {
      diff += Math.abs(p1[i] - p2[i]);
    }
    return diff / 1024;
  }

  // Select 3 distinct frames
  const selected: AnalyzedFrame[] = [];
  if (sorted.length > 0) {
    selected.push(sorted[0]);
  }

  // Find 2nd frame distinct from 1st
  for (let i = 1; i < sorted.length; i++) {
    const cand = sorted[i];
    const diff1 = getPixelDiff(selected[0].pixels, cand.pixels);
    const timeDiff = Math.abs(selected[0].frame.timestamp - cand.frame.timestamp);
    if (diff1 >= 11 && timeDiff >= 0.8) {
      selected.push(cand);
      break;
    }
  }

  // Find 3rd frame distinct from 1st and 2nd
  if (selected.length === 2) {
    for (let i = 1; i < sorted.length; i++) {
      const cand = sorted[i];
      if (cand.frame.id === selected[0].frame.id || cand.frame.id === selected[1].frame.id) continue;
      const diff1 = getPixelDiff(selected[0].pixels, cand.pixels);
      const diff2 = getPixelDiff(selected[1].pixels, cand.pixels);
      const timeDiff1 = Math.abs(selected[0].frame.timestamp - cand.frame.timestamp);
      const timeDiff2 = Math.abs(selected[1].frame.timestamp - cand.frame.timestamp);
      if (diff1 >= 11 && diff2 >= 11 && timeDiff1 >= 0.8 && timeDiff2 >= 0.8) {
        selected.push(cand);
        break;
      }
    }
  }

  // Fallback: if video is short or static and strict difference isn't met, pick top distinct timestamps
  if (selected.length < 3) {
    for (const cand of sorted) {
      if (selected.some(s => s.frame.id === cand.frame.id)) continue;
      const timeDiffs = selected.map(s => Math.abs(s.frame.timestamp - cand.frame.timestamp));
      if (Math.min(...timeDiffs) >= 0.5) {
        selected.push(cand);
        if (selected.length >= 3) break;
      }
    }
  }

  // If still fewer than 3, fill with remaining sorted frames
  if (selected.length < 3) {
    for (const cand of sorted) {
      if (!selected.some(s => s.frame.id === cand.frame.id)) {
        selected.push(cand);
        if (selected.length >= 3) break;
      }
    }
  }

  const topFrames: ThumbnailFrame[] = selected.slice(0, 3).map(s => ({
    ...s.frame,
    score: s.score,
    reason: s.reason,
  }));

  const selectedFrame = topFrames[0] || scoredFrames[0];

  return {
    scoredFrames,
    topFrames,
    selectedFrame,
  };
}

/**
 * 4. Render 9:16 Shorts thumbnail (2160x3840) with safe zone hook text.
 * - Does NOT burn hook into MP4.
 * - Throws descriptive error if FFmpeg drawtext fails (MP4 remains intact).
 */
export async function renderShortsThumbnail(
  selectedFramePath: string,
  outputPath: string,
  hook: string,
  layout: ThumbnailLayout = { textPosition: 'top' },
  ffmpegPath: string
): Promise<void> {
  if (!fs.existsSync(selectedFramePath)) {
    throw new Error(`Khung hình nguồn không tồn tại: ${selectedFramePath}`);
  }

  const cleanHook = hook.trim().replace(/[\r\n]+/g, ' ').slice(0, 32);
  const words = cleanHook.split(/\s+/).filter(Boolean);

  // Wrap into max 2 lines for 2–5 words readability
  let wrappedText = cleanHook;
  if (words.length >= 3 && cleanHook.length > 14) {
    const mid = Math.ceil(words.length / 2);
    wrappedText = `${words.slice(0, mid).join(' ')}\n${words.slice(mid).join(' ')}`;
  }

  const textPath = outputPath + '.txt';
  fs.writeFileSync(textPath, wrappedText, 'utf8');

  // Font size calibrated for 2160x3840
  const isMultiLine = wrappedText.includes('\n');
  const fontSize = cleanHook.length > 24 ? 100 : cleanHook.length > 16 ? 120 : (isMultiLine ? 130 : 155);

  // Safe zone y position
  let yExpr = '460';
  let scrimY = '0';
  let scrimH = '860';

  if (layout.textPosition === 'middle') {
    yExpr = '(3840-text_h)/2';
    scrimY = '1400';
    scrimH = '1040';
  } else if (layout.textPosition === 'bottom') {
    // 2650 is safely above YouTube Shorts bottom UI (which occupies ~800px from bottom 3840)
    yExpr = '2650';
    scrimY = '2450';
    scrimH = '900';
  }

  const fontPath = getSystemFontPath();
  const fontArg = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';

  const filter = [
    'scale=2160:3840:force_original_aspect_ratio=increase',
    'crop=2160:3840',
    `drawbox=x=0:y=${scrimY}:w=iw:h=${scrimH}:color=black@0.32:t=fill`,
    `drawtext=textfile='${escapeFilterPath(textPath)}'${fontArg}:fontcolor=white:fontsize=${fontSize}` +
      `:x=(w-text_w)/2:y=${yExpr}:box=1:boxcolor=black@0.78:boxborderw=38`,
  ].join(',');

  try {
    const { promise } = runSpawn(ffmpegPath, [
      '-i', selectedFramePath,
      '-vf', filter,
      '-frames:v', '1',
      '-update', '1',
      outputPath,
      '-y',
    ], { timeoutMs: 60000 });

    const result = await promise;
    if (result.code !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error(result.stderr.slice(-400) || 'FFmpeg không tạo được file thumbnail PNG');
    }
  } finally {
    fs.rmSync(textPath, { force: true });
  }
}

/**
 * 5. Suggest copy based strictly on evidence from real transcript segments.
 * - Only reads real TranscriptSegment intersecting [candidate.start, candidate.end].
 * - Never invents streamer names without transcript mention.
 * - Returns 2–3 grounded title options and verified hashtags.
 */
export function suggestShortsCopy(
  candidate: ClipCandidate,
  transcript: TranscriptSegment[]
): ShortsCopy {
  const real = transcript.filter(s =>
    !s.isPlaceholder &&
    !/^\[Đoạn nói \d+\]/i.test(s.text) &&
    s.end >= candidate.start &&
    s.start <= candidate.end
  );

  const spoken = real.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  const people = PEOPLE.filter(([pattern]) => pattern.test(spoken));
  const peopleNames = people.slice(0, 2).map(([, name]) => name);
  const peoplePrefix = peopleNames.join(' & ');
  const peopleTags = people.slice(0, 2).map(([, , tag]) => tag);

  // Case 1: No transcript or empty
  if (!spoken || real.length === 0) {
    return {
      publishTitle: 'Khoảnh khắc reaction đáng chú ý | Short',
      publishTitleOptions: [
        'Khoảnh khắc reaction đáng chú ý | Short',
        'Tình huống bất ngờ không thể bỏ lỡ | Short',
        'Đoạn clip nổi bật trong video | Short',
      ],
      thumbnailHook: 'WATCH THIS',
      hashtags: ['#StreamerClips', '#Shorts'],
      publishStatus: 'needs_review',
      publishWarning: 'Thiếu transcript/ngữ cảnh: cần sửa title, hook và hashtag trước khi đăng',
    };
  }

  // Reaction matching from spoken text
  const reactionMatch = REACTIONS.find(([pattern]) => pattern.test(spoken));

  // Extract clean words from meaningful phrase
  const expressive = real.find(s => /[!?]|\b(no way|crazy|serious|shocked|lost|prank|omg)\b/i.test(s.text))?.text || real[0]?.text || '';
  const cleanPhrase = expressive.replace(/\[[^\]]+\]/g, '').replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
  const words = cleanPhrase.split(/\s+/).filter(Boolean);

  // Case 2: Very short spoken text (fewer than 3 words or just an exclamation like "no way")
  if (words.length < 3) {
    const hook = reactionMatch ? reactionMatch[1] : (words.length > 0 ? words.join(' ').toUpperCase() : 'NO WAY');
    const titleOpt1 = peoplePrefix ? `${peoplePrefix}: "${cleanPhrase}" 😳 | Short` : `"${cleanPhrase || 'Khoảnh khắc bất ngờ'}" 😳 | Short`;
    const titleOpt2 = peoplePrefix ? `${peoplePrefix} reaction cực gắt | Short` : 'Khoảnh khắc reaction cực gắt | Short';
    const titleOpt3 = 'Khoảnh khắc bất ngờ khó tin | Short';

    return {
      publishTitle: titleOpt1.slice(0, 90),
      publishTitleOptions: [titleOpt1.slice(0, 90), titleOpt2.slice(0, 90), titleOpt3.slice(0, 90)],
      thumbnailHook: hook.slice(0, 32),
      hashtags: [...peopleTags, '#Shorts'].slice(0, 3),
      publishStatus: peopleNames.length > 0 ? 'ready' : 'needs_review',
      publishWarning: peopleNames.length > 0 ? undefined : 'Thiếu transcript/ngữ cảnh: cần sửa title, hook và hashtag trước khi đăng',
    };
  }

  // Case 3: Transcript has sufficient speech
  const headline = words.slice(0, 8).join(' ').replace(/[,.!?;:]+$/, '');
  const opt1 = `${peoplePrefix ? `${peoplePrefix}: ` : ''}${headline}${words.length > 8 ? '…' : ''} 😳`;
  const opt2 = `Khoảnh khắc ${peoplePrefix ? `${peoplePrefix} ` : ''}"${words.slice(0, 6).join(' ')}" | Short`;
  const opt3 = `${peoplePrefix ? `${peoplePrefix} ` : ''}${headline.slice(0, 50)}?! | Short`;

  const thumbnailHook = reactionMatch?.[1] || (
    words.slice(0, 4).join(' ').replace(/[,.!?;:]+$/, '').toUpperCase()
  );

  const hashtags = [
    ...peopleTags,
    '#Shorts',
  ].slice(0, 3);

  return {
    publishTitle: opt1.slice(0, 90),
    publishTitleOptions: [opt1.slice(0, 90), opt2.slice(0, 90), opt3.slice(0, 90)],
    thumbnailHook: thumbnailHook.slice(0, 32),
    hashtags,
    publishStatus: 'ready',
    publishWarning: undefined,
  };
}

/**
 * 6. Write complete publish metadata JSON
 */
export function writeShortsMetadata(filePath: string, data: PublishMetadata): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}
