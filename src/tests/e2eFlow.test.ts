import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runSpawn } from '../main/util';
import { JobManager } from '../main/jobManager';
import { JobSettings } from '../main/types';

describe('AutoClip Studio End-to-End Pipeline', () => {
  let tempBaseDir: string;
  let testVideoPath: string;
  let testSrtPath: string;
  let jobManager: JobManager;

  const testSettings: JobSettings = {
    targetClipCount: 2,
    clipDurationMin: 5,
    clipDurationMax: 12,
    aspectRatio: '9:16',
    preset: 'reaction',
    captions: true,
    bgm: true,
    sfx: true,
    broll: true,
    mode: 'local',
  };

  beforeAll(async () => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclip_e2e_'));
    testVideoPath = path.join(tempBaseDir, 'test_source_video.mp4');
    testSrtPath = path.join(tempBaseDir, 'test_subtitles.srt');

    // 1. Generate a real 15-second test video with video pattern and audio tone
    const { promise: genPromise } = runSpawn('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=15:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=800:duration=15',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      testVideoPath,
      '-y',
    ]);
    await genPromise;

    // 2. Generate a real test SRT subtitle file
    const srtContent = `1
00:00:00,500 --> 00:00:04,500
Tại sao video ngắn này lại có thể gây sốt trên mạng xã hội?

2
00:00:05,000 --> 00:00:09,000
Bởi vì cấu trúc video được xây dựng rất chặt chẽ từ Hook đến Payoff.

3
00:00:09,500 --> 00:00:14,000
Hãy áp dụng ngay để tạo ra những video shorts triệu view nhé.
`;
    fs.writeFileSync(testSrtPath, srtContent, 'utf8');

    jobManager = new JobManager(tempBaseDir);
  }, 30000);

  afterAll(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('runs complete flow: video select -> analyze -> candidates -> render -> output verification', async () => {
    // 1. Create Job
    const job = await jobManager.createJob(testVideoPath, testSettings, 'E2E Demo Test');
    expect(job.id).toBeDefined();
    expect(job.videoInfo.duration).toBeGreaterThanOrEqual(14);
    expect(job.videoInfo.width).toBe(1280);
    expect(job.videoInfo.height).toBe(720);

    // 2. Analyze Video with SRT
    const srtContent = fs.readFileSync(testSrtPath, 'utf8');
    const analyzedJob = await jobManager.analyzeVideo(job.id, srtContent);

    expect(analyzedJob.status).toBe('candidates_ready');
    expect(analyzedJob.transcript.length).toBe(3);
    expect(analyzedJob.candidates.length).toBeGreaterThanOrEqual(1);

    const firstCand = analyzedJob.candidates[0];
    expect(firstCand.score).toBeGreaterThan(0);
    expect(firstCand.scoreBreakdown.hook).toBeDefined();
    expect(firstCand.reason).toBeDefined();

    // Auto Asset Plan assertions
    expect(firstCand.assetPlan).toBeDefined();
    expect(firstCand.assetPlan?.musicTrack).toBeDefined();
    expect(firstCand.assetPlan?.beats.length).toBeGreaterThan(0);
    expect(firstCand.assetPlan?.duckingSettings.normalVolume).toBeGreaterThan(
      firstCand.assetPlan!.duckingSettings.duckedVolume
    );

    // 3. Render candidates
    const renderedJob = await jobManager.renderAllCandidates(job.id);
    expect(renderedJob.status).toBe('completed');
    expect(renderedJob.clips.length).toBeGreaterThan(0);

    const renderedClip = renderedJob.clips[0];
    expect(renderedClip.status).toBe('completed');
    expect(renderedClip.outputPath).toBeDefined();
    expect(fs.existsSync(renderedClip.outputPath!)).toBe(true);
    expect(renderedClip.thumbnailPath && fs.existsSync(renderedClip.thumbnailPath)).toBe(true);
    expect(renderedClip.metadataPath && fs.existsSync(renderedClip.metadataPath)).toBe(true);
    const publish = JSON.parse(fs.readFileSync(renderedClip.metadataPath!, 'utf8'));
    expect(publish.thumbnailHook).toBe(renderedClip.thumbnailHook);
    expect(publish.title).toBe(renderedClip.publishTitle);
    expect(publish.hashtags).toContain('#Shorts');

    // 4. Verify output MP4 with ffprobe
    const { promise: probePromise } = runSpawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=width,height,codec_name',
      '-of', 'json',
      renderedClip.outputPath!,
    ]);
    const probeRes = await probePromise;
    expect(probeRes.code).toBe(0);

    const probeData = JSON.parse(probeRes.stdout);
    const videoStream = probeData.streams?.find((s: any) => s.codec_name === 'h264');
    expect(videoStream).toBeDefined();
    // 9:16 vertical reframe check
    expect(videoStream.width).toBe(1080);
    expect(videoStream.height).toBe(1920);

    // Audio stream check (Speech + Ducked BGM + Beat SFX mixed)
    const audioStream = probeData.streams?.find((s: any) => s.codec_name === 'aac');
    expect(audioStream).toBeDefined();

    // 5. Test persistence: reload and verify state
    const restoredManager = new JobManager(tempBaseDir);
    const restoredJob = restoredManager.getJob(job.id);
    expect(restoredJob).toBeDefined();
    expect(restoredJob?.clips.length).toBeGreaterThan(0);
    expect(restoredJob?.clips[0].status).toBe('completed');
  }, 45000);
});
