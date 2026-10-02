import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { JobManager } from '../main/jobManager';
import { LocalAssetProvider } from '../main/assetProvider';
import { AutoAssetPlanner, migrateAssetPlan, buildAudioEventsFromAssetPlan } from '../main/autoAssetPlanner';
import { renderWithEditPlan, probeAudioDuration, probeHasAudio } from '../main/renderEngine';
import { HypitAdapter } from '../main/hypitAdapter';
import { ClipCandidate, JobSettings, PlannedSfxEvent, TranscriptSegment, BeatEvent } from '../main/types';
import { runSpawn } from '../main/util';

describe('Multi-SFX Timeline & AssetPlan-to-Render Synchronization Tests', () => {
  const assetsDir = path.resolve(__dirname, '../../assets');
  const provider = new LocalAssetProvider(assetsDir);
  const planner = new AutoAssetPlanner(provider);
  const testOutputDir = path.join(os.tmpdir(), `autoclip_sfx_test_${Date.now()}`);
  let ffmpegPath = 'ffmpeg';
  let ffprobePath = 'ffprobe';

  const mockSettings: JobSettings = {
    targetClipCount: 1,
    clipDurationMin: 20,
    clipDurationMax: 30,
    aspectRatio: '9:16',
    preset: 'reaction',
    captions: false,
    bgm: false,
    sfx: true,
    broll: false,
    mode: 'local',
  };

  const mockSegments: TranscriptSegment[] = [
    { id: '1', start: 0, end: 4, text: 'Mở đầu video với một hook thật cuốn hút.' },
    { id: '2', start: 4.5, end: 10, text: 'Và khoảnh khắc bất ngờ xuất hiện ngay lúc này.' },
    { id: '3', start: 10.5, end: 17, text: 'Một cú twist không thể tin được xảy ra.' },
    { id: '4', start: 17.5, end: 25, text: 'Kết thúc với punchline bùng nổ.' },
  ];

  let sampleVideoPath = '';

  beforeAll(async () => {
    fs.mkdirSync(testOutputDir, { recursive: true });
    const adapter = new HypitAdapter();
    ffmpegPath = await adapter.getFfmpegPath();
    ffprobePath = await adapter.getFfprobePath();

    // Create a 25-second synthetic test video with audio
    sampleVideoPath = path.join(testOutputDir, 'sample_25s.mp4');
    await runSpawn(ffmpegPath, [
      '-f', 'lavfi', '-i', 'testsrc=duration=25:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=25',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      sampleVideoPath,
      '-y',
    ]).promise;
  }, 30000);

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('1. Tự động đề xuất SFX khi có nhiều khoảnh khắc, không giới hạn 1 SFX/Short hay 1 SFX/Beat', () => {
    const candidate: ClipCandidate = {
      id: 'cand_multi_sfx',
      title: 'Clip có nhiều khoảnh khắc',
      start: 0,
      end: 25,
      duration: 25,
      score: 90,
      scoreBreakdown: { hook: 92, pacing: 88, payoff: 90 },
      reason: 'Hook và nhiều bất ngờ',
      transcriptExcerpt: 'Mở đầu video...',
      selected: true,
    };

    const plan = planner.planForClip(candidate, mockSettings, mockSegments, [
      { start: 10.0, end: 10.4, relStart: 10.0, relEnd: 10.4, duration: 0.4 },
    ]);

    expect(plan.sfxEvents).toBeDefined();
    expect(plan.sfxEvents!.length).toBeGreaterThanOrEqual(2);

    for (const evt of plan.sfxEvents!) {
      expect(evt.id).toBeTruthy();
      expect(evt.asset).toBeDefined();
      expect(evt.asset.filePath).toBeTruthy();
      expect(evt.triggerAt).toBeGreaterThanOrEqual(0);
      expect(evt.triggerAt).toBeLessThan(candidate.duration);
      expect(evt.volume).toBeGreaterThan(0);
      expect(evt.reason).toBeTruthy();
    }
  });

  it('2. Đồng bộ tức thì: Lưu modal cập nhật assetPlan -> editPlan.audioEvents khớp 100%', async () => {
    const sfxAssets = await provider.getAllAssets('sfx');
    expect(sfxAssets.length).toBeGreaterThanOrEqual(4);

    const jobManager = new JobManager(testOutputDir);
    const job = await jobManager.createJob(sampleVideoPath, mockSettings, 'Test Multi-SFX Sync');
    await jobManager.analyzeVideo(job.id);

    const cand = job.candidates[0];
    expect(cand).toBeDefined();

    // Setup 5 distinct SFX at 1.0s, 4.2s, 8.5s, 12.0s, 18.3s
    // with 2 SFX around the same beat at 8.5s (8.2s and 8.5s)
    const testBeatId = 'beat_surprise_85';
    const beat: BeatEvent = {
      id: testBeatId,
      beatType: 'surprise',
      timestamp: 8.5,
      duration: 1.5,
      meme: (await provider.getAllAssets('meme'))[0],
      sfx: sfxAssets[0],
      confidence: 0.95,
      reason: 'Khoảnh khắc bất ngờ lớn',
    };

    const customSfxEvents: PlannedSfxEvent[] = [
      {
        id: 'sfx_1',
        asset: sfxAssets[0],
        triggerAt: 1.0,
        volume: 0.85,
        fadeIn: 0.05,
        fadeOut: 0.2,
        enabled: true,
        origin: 'manual',
        reason: 'Hook opening whoosh',
      },
      {
        id: 'sfx_2',
        asset: sfxAssets[1 % sfxAssets.length],
        triggerAt: 4.2,
        volume: 0.70,
        fadeIn: 0.05,
        fadeOut: 0.25,
        enabled: true,
        origin: 'manual',
        reason: 'Transition pop',
      },
      {
        id: 'sfx_3a',
        asset: sfxAssets[2 % sfxAssets.length],
        triggerAt: 8.2, // pre-cue before surprise beat
        volume: 0.75,
        fadeIn: 0.05,
        fadeOut: 0.2,
        enabled: true,
        sourceBeatId: testBeatId,
        origin: 'manual',
        reason: 'Pre-cue SFX trước beat bất ngờ',
      },
      {
        id: 'sfx_3b',
        asset: sfxAssets[3 % sfxAssets.length],
        triggerAt: 8.5, // exact beat timestamp
        volume: 0.90,
        fadeIn: 0.05,
        fadeOut: 0.3,
        enabled: true,
        sourceBeatId: testBeatId,
        origin: 'manual',
        reason: 'Impact SFX đúng mốc beat bất ngờ',
      },
      {
        id: 'sfx_4',
        asset: sfxAssets[0],
        triggerAt: 12.0,
        volume: 0.80,
        fadeIn: 0.05,
        fadeOut: 0.2,
        enabled: true,
        origin: 'manual',
        reason: 'Payoff chime',
      },
      {
        id: 'sfx_5',
        asset: sfxAssets[1 % sfxAssets.length],
        triggerAt: 18.3,
        volume: 0.85,
        fadeIn: 0.05,
        fadeOut: 0.25,
        enabled: true,
        origin: 'manual',
        reason: 'Punchline bell',
      },
    ];

    const newAssetPlan = {
      clipId: cand.id,
      musicTrack: null,
      beats: [beat],
      sfxEvents: customSfxEvents,
      duckingSettings: {
        normalVolume: 0.22,
        duckedVolume: 0.06,
        fadeInDuration: 0.5,
        fadeOutDuration: 1.0,
      },
    };

    // Save asset plan (simulating user clicking "Lưu Kế Hoạch Asset" in AssetPlanModal)
    jobManager.updateCandidateAssetPlan(job.id, cand.id, newAssetPlan);

    // Read back candidate from JobManager
    const updatedJob = jobManager.getJob(job.id)!;
    const updatedCand = updatedJob.candidates.find((c) => c.id === cand.id)!;

    // Verify candidate.assetPlan has all 6 SFX events
    expect(updatedCand.assetPlan?.sfxEvents?.length).toBe(6);

    // Verify candidate.editPlan.audioEvents has matched every single event!
    expect(updatedCand.editPlan).toBeDefined();
    expect(updatedCand.editPlan!.audioEvents.length).toBe(6);

    const audioEvents = updatedCand.editPlan!.audioEvents;
    expect(audioEvents.map((a) => a.triggerAt)).toEqual([1.0, 4.2, 8.2, 8.5, 12.0, 18.3]);
    expect(audioEvents.map((a) => a.id)).toEqual(['sfx_1', 'sfx_2', 'sfx_3a', 'sfx_3b', 'sfx_4', 'sfx_5']);
  });

  it('3. Đóng / Mở lại job: Không mất SFX và vẫn giữ nguyên migration', async () => {
    const jobManager1 = new JobManager(testOutputDir);
    const allJobs = jobManager1.getAllJobs();
    expect(allJobs.length).toBeGreaterThan(0);

    const loadedJob = allJobs[0];
    const cand = loadedJob.candidates[0];

    // Reloading from disk via a fresh JobManager instance
    const jobManager2 = new JobManager(testOutputDir);
    const reloadedJob = jobManager2.getJob(loadedJob.id)!;
    const reloadedCand = reloadedJob.candidates.find((c) => c.id === cand.id)!;

    expect(reloadedCand.assetPlan?.sfxEvents?.length).toBe(6);
    expect(reloadedCand.editPlan?.audioEvents.length).toBe(6);
  });

  it('4. Migration job cũ (beats[].sfx) tạo sfxEvents ổn định, không trùng lặp', () => {
    const sfxAsset = {
      id: 'sfx_old',
      name: 'Legacy SFX',
      type: 'sfx' as const,
      filePath: '/path/to/old.mp3',
      sourceUrl: '',
      license: 'CC0',
      fetchedAt: new Date().toISOString(),
      fingerprint: 'fp_old',
      tags: [],
    };

    const legacyPlan = {
      clipId: 'cand_legacy',
      musicTrack: null,
      beats: [
        {
          id: 'beat_legacy_1',
          beatType: 'hook' as const,
          timestamp: 2.5,
          duration: 1.5,
          meme: null as any,
          sfx: sfxAsset,
          confidence: 0.9,
          reason: 'Legacy hook',
        },
      ],
      duckingSettings: {
        normalVolume: 0.22,
        duckedVolume: 0.06,
        fadeInDuration: 0.5,
        fadeOutDuration: 1.0,
      },
    };

    // First migration
    const migrated1 = migrateAssetPlan(legacyPlan, 20);
    expect(migrated1.sfxEvents?.length).toBe(1);
    expect(migrated1.sfxEvents![0].triggerAt).toBe(2.5);
    expect(migrated1.sfxEvents![0].id).toBe('sfx_migrated_beat_legacy_1');
    expect(migrated1.sfxEvents![0].origin).toBe('auto');

    // Second migration: must not duplicate
    const migrated2 = migrateAssetPlan(migrated1, 20);
    expect(migrated2.sfxEvents?.length).toBe(1);
  });

  it('5. Render clip thực tế với 5+ SFX (bao gồm 2 SFX quanh cùng 1 beat) ra MP4 hoàn chỉnh', async () => {
    const jobManager = new JobManager(testOutputDir);
    const jobs = jobManager.getAllJobs();
    const job = jobs[0];
    const cand = job.candidates[0];

    const projectDir = path.join(testOutputDir, 'render_test_proj');
    fs.mkdirSync(projectDir, { recursive: true });
    const outputPath = path.join(testOutputDir, 'output_multi_sfx.mp4');

    const result = await renderWithEditPlan({
      clipId: 'clip_sfx_test',
      projectDir,
      candidate: cand,
      settings: mockSettings,
      cutVideoPath: sampleVideoPath,
      outputPath,
      editPlan: cand.editPlan!,
      relevantSegments: mockSegments,
      ffmpegPath,
      ffprobePath,
      onProgress: () => {},
      onLog: () => {},
    });

    expect(result.engine).toBe('ffmpeg-fallback');
    expect(fs.existsSync(outputPath)).toBe(true);

    // Verify output with ffprobe
    const probeRes = await runSpawn(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', outputPath,
    ]).promise;

    expect(probeRes.code).toBe(0);
    const probeData = JSON.parse(probeRes.stdout);
    const duration = parseFloat(probeData.format?.duration ?? '0');
    expect(duration).toBeGreaterThan(15);

    const audioStream = probeData.streams?.find((s: any) => s.codec_type === 'audio');
    expect(audioStream).toBeDefined();
    expect(audioStream.codec_name).toBe('aac');

    const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
    expect(videoStream).toBeDefined();
  }, 40000);

  it('6. Tắt / Xóa một SFX chỉ ảnh hưởng duy nhất event đó khi render lại', async () => {
    const jobManager = new JobManager(testOutputDir);
    const job = jobManager.getAllJobs()[0];
    const cand = job.candidates[0];

    // Disable the 2nd SFX ('sfx_2')
    const updatedEvents = cand.assetPlan!.sfxEvents!.map((e) =>
      e.id === 'sfx_2' ? { ...e, enabled: false } : e
    );

    jobManager.updateCandidateAssetPlan(job.id, cand.id, {
      ...cand.assetPlan!,
      sfxEvents: updatedEvents,
    });

    const refreshedJob = jobManager.getJob(job.id)!;
    const refreshedCand = refreshedJob.candidates.find((c) => c.id === cand.id)!;

    // editPlan.audioEvents must now have 5 enabled events, omitting 'sfx_2'
    expect(refreshedCand.editPlan!.audioEvents.length).toBe(5);
    expect(refreshedCand.editPlan!.audioEvents.some((a) => a.id === 'sfx_2')).toBe(false);
  });
});
