import fs from 'fs';
import path from 'path';
import { ClipCandidate, TranscriptSegment } from './types';
import { runSpawn } from './util';

export interface ShortsCopy {
  publishTitle: string;
  thumbnailHook: string;
  hashtags: string[];
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

/** Only use words heard inside this clip. Never attach a streamer name based on the source filename. */
export function suggestShortsCopy(candidate: ClipCandidate, transcript: TranscriptSegment[]): ShortsCopy {
  const real = transcript.filter(s => !s.isPlaceholder &&
    !/^\[Đoạn nói \d+\]/i.test(s.text) && s.end >= candidate.start && s.start <= candidate.end);
  const spoken = real.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  const people = PEOPLE.filter(([pattern]) => pattern.test(spoken));
  const prefix = people.slice(0, 2).map(([, name]) => name).join(' & ');
  const phrase = real.find(s => /[!?]|\b(no way|crazy|serious|shocked|lost|prank)\b/i.test(s.text))?.text || real[0]?.text || '';
  const clean = phrase.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
  const words = clean.replace(/[“”"']/g, '').split(/\s+/).filter(Boolean);
  const headline = words.slice(0, 10).join(' ').replace(/[,.!?;:]+$/, '');
  const publishTitle = spoken
    ? `${prefix ? `${prefix}: ` : ''}${headline}${words.length > 10 ? '…' : ''} 😳`.slice(0, 90)
    : 'Streamer reaction moment | Short';

  const reaction = REACTIONS.find(([pattern]) => pattern.test(spoken));
  const thumbnailHook = reaction?.[1] || (spoken
    ? words.slice(0, 4).join(' ').replace(/[,.!?;:]+$/, '').toUpperCase()
    : 'WATCH THIS');

  return {
    publishTitle,
    thumbnailHook: thumbnailHook.slice(0, 32),
    hashtags: [...people.slice(0, 2).map(([, , tag]) => tag), '#StreamerClips', '#Shorts'].slice(0, 4),
  };
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

/** Standalone 9:16 upload thumbnail. No thumbnail text is inserted into the MP4. */
export async function renderShortsThumbnail(
  videoPath: string,
  imagePath: string,
  hook: string,
  duration: number,
  ffmpegPath: string
): Promise<void> {
  const textPath = imagePath + '.txt';
  fs.writeFileSync(textPath, hook.replace(/[\r\n]/g, ' ').slice(0, 32), 'utf8');
  const fontSize = hook.length > 24 ? 75 : hook.length > 16 ? 100 : 150;
  // Scale the final video frame to YouTube's recommended 2160x3840 Shorts size.
  // Keep the title high enough to survive the bottom-right Shorts UI overlays.
  const filter = `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,` +
    `drawbox=x=0:y=0:w=iw:h=740:color=black@0.26:t=fill,` +
    `drawtext=textfile='${escapeFilterPath(textPath)}':fontcolor=white:fontsize=${fontSize}:` +
    `x=(w-text_w)/2:y=420:box=1:boxcolor=black@0.72:boxborderw=35`;
  try {
    const { promise } = runSpawn(ffmpegPath, [
      '-ss', Math.min(2, Math.max(0, duration / 3)).toFixed(2),
      '-i', videoPath, '-vf', filter, '-frames:v', '1', '-update', '1', imagePath, '-y',
    ], { timeoutMs: 120000 });
    const result = await promise;
    if (result.code !== 0 || !fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
      throw new Error(result.stderr.slice(-450) || 'No thumbnail was produced');
    }
  } finally {
    fs.rmSync(textPath, { force: true });
  }
}

export function writeShortsMetadata(filePath: string, copy: ShortsCopy, thumbnailPath: string): void {
  fs.writeFileSync(filePath, JSON.stringify({
    title: copy.publishTitle,
    thumbnailHook: copy.thumbnailHook,
    hashtags: copy.hashtags,
    thumbnailPath: path.basename(thumbnailPath),
  }, null, 2), 'utf8');
}
