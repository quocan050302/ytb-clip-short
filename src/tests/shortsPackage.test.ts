import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  buildFrameTimestamps,
  extractFrameCandidates,
  scoreFrameCandidates,
  renderShortsThumbnail,
  suggestShortsCopy,
  writeShortsMetadata,
} from '../main/shortsPackage';
import { ClipCandidate, ClipEditPlan, MomentEvent, TranscriptSegment } from '../main/types';
import { runSpawn } from '../main/util';
import { JobManager } from '../main/jobManager';

describe('Shorts publishing package - Copy & Evidence', () => {
  const candidate = {
    start: 10,
    end: 42,
    title: 'Clip đề xuất #1 (32s)',
  } as ClipCandidate;

  it('keeps title, thumbnail hook and person hashtags grounded in this clip', () => {
    const transcript: TranscriptSegment[] = [
      { id: 'prior', start: 0, end: 8, text: 'Duke Dennis was here earlier' },
      { id: 'clip', start: 12, end: 16, text: 'Kai Cenat said no way when Fanum walked in!' },
      { id: 'post', start: 45, end: 50, text: 'Rayquan joined later' },
    ];
    const result = suggestShortsCopy(candidate, transcript);
    expect(result.publishTitle).toContain('Kai Cenat & Fanum');
    expect(result.publishTitleOptions.length).toBeGreaterThanOrEqual(2);
    expect(result.thumbnailHook).toBe('NO WAY');
    expect(result.hashtags).toContain('#Fanum');
    expect(result.hashtags).toContain('#KaiCenat');
    expect(result.hashtags).not.toContain('#DukeDennis');
    expect(result.hashtags).not.toContain('#Rayquan');
    expect(result.publishStatus).toBe('ready');
    expect(result.publishWarning).toBeUndefined();
  });

  it('does not invent streamer identities from a placeholder transcript', () => {
    const result = suggestShortsCopy(candidate, [
      { id: 'placeholder', start: 11, end: 15, text: '[Đoạn nói 1]', isPlaceholder: true },
    ]);
    expect(result.hashtags).toEqual(['#StreamerClips', '#Shorts']);
    expect(result.thumbnailHook).toBe('WATCH THIS');
    expect(result.publishStatus).toBe('needs_review');
    expect(result.publishWarning).toContain('Thiếu transcript/ngữ cảnh');
    expect(result.publishTitleOptions.length).toBeGreaterThanOrEqual(2);
  });

  it('does not invent streamer names if not spoken, even if candidate title mentions something', () => {
    const candWithFakeName = {
      start: 5,
      end: 20,
      title: 'Kai Cenat crazy moment',
    } as ClipCandidate;
    const result = suggestShortsCopy(candWithFakeName, [
      { id: '1', start: 6, end: 12, text: 'Look at this game play, totally unexpected' },
    ]);
    expect(result.publishTitle).not.toContain('Kai Cenat');
    expect(result.hashtags).not.toContain('#KaiCenat');
  });

  it('handles very brief speech like "no way" without inventing wild prank stories', () => {
    const result = suggestShortsCopy(candidate, [
      { id: '1', start: 12, end: 14, text: 'No way!' },
    ]);
    expect(result.thumbnailHook).toBe('NO WAY');
    expect(result.publishTitle).toContain('No way');
    expect(result.publishTitle).not.toContain('Fanum pranked Duke');
    expect(result.publishTitleOptions.length).toBe(3);
  });
});

describe('Shorts publishing package - Timestamp Generation', () => {
  it('uses timestamps relative to the clip and never adds candidate.start', () => {
    const candidate: ClipCandidate = {
      id: 'cand1',
      title: 'Highlight',
      start: 50,
      end: 80,
      duration: 30,
      score: 0.9,
      scoreBreakdown: { hook: 0.9, flow: 0.8, pacing: 0.8, payoff: 0.8 },
      reason: 'Good',
      transcriptExcerpt: '',
      selected: true,
      editPlan: {
        moments: [
          {
            id: 'm1',
            momentType: 'hook',
            timestamp: 4.5, // 4.5s into clip (NOT 54.5s)
            duration: 1.5,
            confidence: 0.9,
            reason: 'Opening hook',
          },
          {
            id: 'm2',
            momentType: 'punchline',
            timestamp: 22.0, // 22s into clip (NOT 72s)
            duration: 2.0,
            confidence: 0.85,
            reason: 'Punchline payoff',
          },
        ],
      } as unknown as ClipEditPlan,
    };

    const duration = 30.0;
    const timestamps = buildFrameTimestamps(duration, candidate, candidate.editPlan);

    // All timestamps must be strictly in [0, duration)
    for (const ts of timestamps) {
      expect(ts).toBeGreaterThanOrEqual(0);
      expect(ts).toBeLessThan(duration);
      // Ensure candidate.start (50) was NOT added!
      expect(ts).toBeLessThan(30);
    }

    // Must include points near moments (4.5 and 22.0)
    expect(timestamps.some(ts => Math.abs(ts - 4.5) <= 0.5)).toBe(true);
    expect(timestamps.some(ts => Math.abs(ts - 22.0) <= 0.5)).toBe(true);

    // Must be sorted and deduped
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
      expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(0.4);
    }

    // Must be capped at <= 15
    expect(timestamps.length).toBeLessThanOrEqual(15);
  });
});

describe('Shorts publishing package - Extraction, Scoring & Rendering', () => {
  let tempDir: string;
  let testVideoPath: string;
  let ffmpegPath: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts_pkg_test_'));
    testVideoPath = path.join(tempDir, 'sample_short.mp4');
    ffmpegPath = '/opt/homebrew/bin/ffmpeg';

    // Generate a 6-second video with testsrc (sharp colorful pattern)
    const { promise } = runSpawn(ffmpegPath, [
      '-f', 'lavfi', '-i', 'testsrc=duration=6:size=1080x1920:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac',
      testVideoPath,
      '-y',
    ], { timeoutMs: 30000 });
    await promise;
  }, 40000);

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('extracts candidate frames with sub-second timestamps and verifies existence', async () => {
    const framesDir = path.join(tempDir, 'frames_out');
    const timestamps = [0.8, 2.2, 3.7, 4.9];
    const frames = await extractFrameCandidates(testVideoPath, timestamps, framesDir, ffmpegPath);

    expect(frames.length).toBe(4);
    for (const f of frames) {
      expect(fs.existsSync(f.path)).toBe(true);
      expect(fs.statSync(f.path).size).toBeGreaterThan(0);
    }
  });

  it('penalizes black / dark / blurry frames and selects distinct high-quality frames', async () => {
    const framesDir = path.join(tempDir, 'scoring_frames');
    fs.mkdirSync(framesDir, { recursive: true });

    // Create 1 black frame, 1 overexposed white frame, 1 blurry frame, 2 high-contrast patterned frames
    const blackPath = path.join(framesDir, 'black.jpg');
    const whitePath = path.join(framesDir, 'white.jpg');
    const blurPath = path.join(framesDir, 'blur.jpg');
    const sharp1Path = path.join(framesDir, 'sharp1.jpg');
    const sharp2Path = path.join(framesDir, 'sharp2.jpg');

    await runSpawn(ffmpegPath, ['-f', 'lavfi', '-i', 'color=c=black:s=720x1280:d=1', '-frames:v', '1', blackPath, '-y']).promise;
    await runSpawn(ffmpegPath, ['-f', 'lavfi', '-i', 'color=c=white:s=720x1280:d=1', '-frames:v', '1', whitePath, '-y']).promise;
    await runSpawn(ffmpegPath, ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=720x1280', '-vf', 'boxblur=30:30', '-frames:v', '1', blurPath, '-y']).promise;
    await runSpawn(ffmpegPath, ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=720x1280', '-frames:v', '1', sharp1Path, '-y']).promise;
    await runSpawn(ffmpegPath, ['-f', 'lavfi', '-i', 'smptebars=duration=1:size=720x1280', '-frames:v', '1', sharp2Path, '-y']).promise;

    const frames = [
      { id: 'f_black', timestamp: 1.0, path: blackPath, score: 0, reason: '' },
      { id: 'f_white', timestamp: 2.0, path: whitePath, score: 0, reason: '' },
      { id: 'f_blur', timestamp: 3.0, path: blurPath, score: 0, reason: '' },
      { id: 'f_sharp1', timestamp: 4.0, path: sharp1Path, score: 0, reason: '' },
      { id: 'f_sharp2', timestamp: 5.0, path: sharp2Path, score: 0, reason: '' },
    ];

    const moments: MomentEvent[] = [
      // Put a hook moment right on the black frame! Moment proximity MUST NOT rescue a black frame.
      { id: 'm1', momentType: 'hook', timestamp: 1.0, duration: 1, confidence: 1.0, reason: 'Hook' },
      { id: 'm2', momentType: 'punchline', timestamp: 4.0, duration: 1, confidence: 0.9, reason: 'Punchline' },
    ];

    const { scoredFrames, topFrames, selectedFrame } = await scoreFrameCandidates(frames, moments, ffmpegPath);

    const blackScore = scoredFrames.find(f => f.id === 'f_black')!;
    const whiteScore = scoredFrames.find(f => f.id === 'f_white')!;
    const sharp1Score = scoredFrames.find(f => f.id === 'f_sharp1')!;
    const sharp2Score = scoredFrames.find(f => f.id === 'f_sharp2')!;

    // Black frame must have very low score and clear reason
    expect(blackScore.score).toBeLessThanOrEqual(25);
    expect(blackScore.reason).toMatch(/quá tối|gần đen/i);

    // White frame must have low score
    expect(whiteScore.score).toBeLessThanOrEqual(30);

    // Sharp frames must score high
    expect(sharp1Score.score).toBeGreaterThan(60);
    expect(sharp2Score.score).toBeGreaterThan(50);

    // Top selected frame must be sharp1 (not black!)
    expect(selectedFrame.id).toBe('f_sharp1');
    expect(topFrames[0].id).toBe('f_sharp1');
    expect(topFrames.some(f => f.id === 'f_sharp2')).toBe(true);
  });

  it('renders a 9:16 Shorts thumbnail at 2160x3840 with hook text and safe zone layout', async () => {
    const framePath = path.join(tempDir, 'source_frame.jpg');
    const outputPath = path.join(tempDir, 'test_output_2160x3840.png');

    await runSpawn(ffmpegPath, [
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=1080x1920',
      '-frames:v', '1', framePath, '-y',
    ]).promise;

    await renderShortsThumbnail(
      framePath,
      outputPath,
      'CỰC SỐC',
      { textPosition: 'top' },
      ffmpegPath
    );

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);

    // Verify 2160x3840 resolution with ffprobe
    const { promise } = runSpawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      outputPath,
    ]);
    const probeRes = await promise;
    expect(probeRes.code).toBe(0);
    const probeJson = JSON.parse(probeRes.stdout);
    expect(probeJson.streams[0].width).toBe(2160);
    expect(probeJson.streams[0].height).toBe(3840);
  });
});

describe('JobManager - Publish Package Workflow & Independence', () => {
  let tempBaseDir: string;
  let jobManager: JobManager;
  let testVideoPath: string;

  beforeAll(async () => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm_pub_test_'));
    testVideoPath = path.join(tempBaseDir, 'source.mp4');

    await runSpawn('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=8:size=720x1280:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=500:duration=8',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac',
      testVideoPath,
      '-y',
    ]).promise;

    jobManager = new JobManager(tempBaseDir);
  }, 40000);

  afterAll(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  it('updates title and hashtags without re-rendering PNG; updates frame or hook re-renders PNG', async () => {
    const job = await jobManager.createJob(testVideoPath, {
      targetClipCount: 1,
      clipDurationMin: 4,
      clipDurationMax: 8,
      aspectRatio: '9:16',
      preset: 'reaction',
      captions: false,
      bgm: false,
      sfx: false,
      broll: false,
      mode: 'local',
    }, 'Publish Test Job');

    const srt = `1\n00:00:01,000 --> 00:00:05,000\nKai Cenat yelled no way!\n`;
    await jobManager.analyzeVideo(job.id, srt);
    const renderedJob = await jobManager.renderAllCandidates(job.id);

    const clip = renderedJob.clips[0];
    expect(clip.status).toBe('completed');
    expect(clip.thumbnailPath && fs.existsSync(clip.thumbnailPath)).toBe(true);
    expect(clip.thumbnailFrames?.length).toBeGreaterThanOrEqual(1);

    const initialThumbMtime = fs.statSync(clip.thumbnailPath!).mtimeMs;

    // Wait a tiny moment so filesystem mtime would differ if re-rendered
    await new Promise(r => setTimeout(r, 100));

    // 1. Changing ONLY title and hashtags -> MUST NOT re-render PNG
    const updatedJob1 = await jobManager.updatePublishPackage(job.id, clip.id, {
      title: 'Tự sửa tiêu đề mới cực chất',
      hashtags: ['#Test', '#Shorts'],
    });

    const updatedClip1 = updatedJob1.clips.find(c => c.id === clip.id)!;
    expect(updatedClip1.publishTitle).toBe('Tự sửa tiêu đề mới cực chất');
    expect(updatedClip1.hashtags).toContain('#Test');
    const thumbMtimeAfterTitleOnly = fs.statSync(updatedClip1.thumbnailPath!).mtimeMs;
    // Thumbnail file was NOT re-rendered!
    expect(thumbMtimeAfterTitleOnly).toBe(initialThumbMtime);

    // 2. Changing hook or frame -> MUST re-render PNG
    await new Promise(r => setTimeout(r, 100));
    const updatedJob2 = await jobManager.updatePublishPackage(job.id, clip.id, {
      hook: 'NEW HOOK WOW',
      textPosition: 'middle',
    });

    const updatedClip2 = updatedJob2.clips.find(c => c.id === clip.id)!;
    expect(updatedClip2.thumbnailHook).toBe('NEW HOOK WOW');
    expect(updatedClip2.thumbnailLayout?.textPosition).toBe('middle');
    const thumbMtimeAfterHook = fs.statSync(updatedClip2.thumbnailPath!).mtimeMs;
    // Thumbnail was re-rendered!
    expect(thumbMtimeAfterHook).toBeGreaterThan(initialThumbMtime);
  }, 35000);

  it('regeneratePublishPackage recreates frames and thumbnail from MP4 without re-rendering video', async () => {
    const jobs = jobManager.getAllJobs();
    const job = jobs[0];
    const clip = job.clips[0];

    const originalVideoMtime = fs.statSync(clip.outputPath!).mtimeMs;

    // Delete thumbnail PNG to simulate regeneration
    fs.rmSync(clip.thumbnailPath!, { force: true });

    const regenJob = await jobManager.regeneratePublishPackage(job.id, clip.id, false);
    const regenClip = regenJob.clips.find(c => c.id === clip.id)!;

    expect(regenClip.status).toBe('completed');
    expect(fs.existsSync(regenClip.thumbnailPath!)).toBe(true);
    // MP4 video was NOT re-rendered!
    expect(fs.statSync(regenClip.outputPath!).mtimeMs).toBe(originalVideoMtime);
  }, 25000);
});
