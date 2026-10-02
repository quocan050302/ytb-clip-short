import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { LocalAssetProvider } from '../main/assetProvider';
import { AutoAssetPlanner } from '../main/autoAssetPlanner';
import { JobManager } from '../main/jobManager';
import { renderWithEditPlan } from '../main/renderEngine';
import {
  ClipCandidate,
  JobSettings,
  MomentCandidate,
  TranscriptSegment,
  PlannedSfxEvent,
} from '../main/types';
import { runSpawn } from '../main/util';

describe('Real Catalog & SFX Rescan Acceptance Tests', () => {
  const repoAssetsDir = path.resolve(__dirname, '../../assets');
  let testUserDataDir: string;

  beforeEach(() => {
    testUserDataDir = path.join(os.tmpdir(), `autoclip_real_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    fs.mkdirSync(testUserDataDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testUserDataDir)) {
        fs.rmSync(testUserDataDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore
    }
  });

  it('1. Verifies that the REAL app assets/sfx directory loads all 17 SFX items (4 WAV + 13 MP3) with no hardcoding', async () => {
    const sfxDir = path.join(repoAssetsDir, 'sfx');
    expect(fs.existsSync(sfxDir)).toBe(true);

    const physicalAudioFiles = fs.readdirSync(sfxDir).filter((f) =>
      ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(path.extname(f).toLowerCase())
    );
    expect(physicalAudioFiles.length).toBe(17);

    // Initialize provider pointing directly to the real repo assets directory
    const importedDir = path.join(testUserDataDir, 'imported-sfx');
    const provider = new LocalAssetProvider(repoAssetsDir, importedDir);

    const allSfx = await provider.getAllAssets('sfx');
    const stats = provider.getCatalogStats();

    // 17 SFX in catalog
    expect(allSfx.length).toBe(17);
    expect(stats.totalSfx).toBe(17);
    expect(stats.defaultWavCount).toBe(4);
    expect(stats.repoMp3Count).toBe(13);
    expect(stats.importedCount).toBe(0);

    // 4 default WAV SFX
    const defaultIds = ['sfx_whoosh', 'sfx_vine_boom', 'sfx_bell_ting', 'sfx_bruh'];
    for (const defId of defaultIds) {
      const found = allSfx.find((a) => a.id === defId);
      expect(found).toBeDefined();
      expect(found?.license).toContain('CC0');
      expect(found?.reviewStatus).toBe('approved');
      expect(fs.existsSync(found!.filePath)).toBe(true);
    }

    // 13 repo MP3s must be present
    const expectedMp3Keywords = [
      'bonk',
      'cartoonslip',
      'money',
      'rizz',
      'shocked',
      'pop',
      'ding',
      'punch',
      'running',
      'loading',
      'bruh',
      'ahh',
      'fah',
    ];

    for (const kw of expectedMp3Keywords) {
      const match = allSfx.find(
        (a) =>
          a.originalFilename?.toLowerCase().includes(kw) ||
          a.name.toLowerCase().includes(kw) ||
          (a.tags || []).some((t) => t.toLowerCase().includes(kw))
      );
      expect(match).toBeDefined();
    }

    // Verify bruh.wav and bruh.mp3 are TWO SEPARATE assets with distinct fingerprints
    const bruhWav = allSfx.find((a) => a.id === 'sfx_bruh');
    const bruhMp3 = allSfx.find((a) => a.originalFilename === 'bruh.mp3');
    expect(bruhWav).toBeDefined();
    expect(bruhMp3).toBeDefined();
    expect(bruhWav?.id).not.toBe(bruhMp3?.id);
    expect(bruhWav?.fingerprint).not.toBe(bruhMp3?.fingerprint);

    // All 13 repo MP3s must have license 'Chưa xác nhận' and needs_review tag
    const repoMp3Assets = allSfx.filter((a) => !defaultIds.includes(a.id));
    expect(repoMp3Assets.length).toBe(13);
    for (const r of repoMp3Assets) {
      expect(r.license).toBe('Chưa xác nhận');
      expect(r.reviewStatus).toBe('needs_review');
      expect(r.description).toContain('[Gợi ý từ tên file/cần duyệt]');
      expect(fs.existsSync(r.filePath)).toBe(true);
    }
  });

  it('2. MatchBestSfxForMoment: DOES NOT fallback to Whoosh or availableSfx[0] when confidence is below threshold', () => {
    const provider = new LocalAssetProvider(repoAssetsDir, path.join(testUserDataDir, 'imported-sfx'));
    const planner = new AutoAssetPlanner(provider);
    const availableSfx = provider.getAllAssetsSync('sfx');

    // Moment with ambiguous or unrelated context
    const ambiguousMoment: MomentCandidate = {
      id: 'moment_unrelated',
      timestamp: 3.5,
      type: 'ambiguous_dialogue',
      evidence: 'Câu nói hoàn toàn bình thường không có từ khóa âm thanh đặc biệt nào',
      confidence: 0.50,
      status: 'suggested',
    };

    const match = planner.matchBestSfxForMoment(ambiguousMoment, availableSfx);
    expect(match).toBeDefined();
    // Must be null asset!
    expect(match?.asset).toBeNull();
    expect(match?.reason).toContain('Không có SFX phù hợp');
    // Top choices list is retained for user manual selection
    expect(match?.topChoices).toBeDefined();
  });

  it('3. Rescan candidate SFX: Re-evaluates all catalog assets and preserves manual user events', () => {
    const provider = new LocalAssetProvider(repoAssetsDir, path.join(testUserDataDir, 'imported-sfx'));
    const planner = new AutoAssetPlanner(provider);

    const candidate: ClipCandidate = {
      id: 'cand_test_1',
      title: 'Đoạn trượt chân ngã và mất tiền',
      start: 10,
      end: 25,
      duration: 15,
      score: 85,
      scoreBreakdown: { hook: 80, pacing: 85, density: 80, payoff: 90 },
      reason: 'Khoảnh khắc kịch tính',
      transcriptExcerpt: 'Bị trượt ngã rồi mất sạch tiền',
      selected: true,
    };

    const settings: JobSettings = {
      targetClipCount: 1,
      clipDurationMin: 15,
      clipDurationMax: 30,
      aspectRatio: '9:16',
      preset: 'reaction',
      captions: true,
      bgm: true,
      sfx: true,
      broll: false,
      mode: 'local',
      wordLevelCaptions: false,
      callouts: false,
      visualEffects: false,
    };

    const segments: TranscriptSegment[] = [
      { start: 13.0, end: 15.5, text: 'Bỗng nhiên anh ấy trượt ngã một cú đau đớn' },
      { start: 18.0, end: 20.5, text: 'Thế là mất sạch tiền triệu dollar trong ví' },
    ];

    // Initial plan
    const initialPlan = planner.planForClip(candidate, settings, segments, []);
    expect(initialPlan.suggestedMoments?.length).toBeGreaterThan(0);

    // Verify cartoon slip was proposed for slip segment
    const slipMoment = initialPlan.suggestedMoments?.find((m) => m.type === 'slip');
    expect(slipMoment).toBeDefined();
    expect(slipMoment?.suggestedSfx?.name).toContain('cartoon_slip');

    // Verify money cue was proposed for money segment
    const moneyMoment = initialPlan.suggestedMoments?.find((m) => m.type === 'money');
    expect(moneyMoment).toBeDefined();
    expect(moneyMoment?.suggestedSfx?.name).toContain('money_cue');

    // Simulate user adding a manual SFX event
    const bonkAsset = provider.getAllAssetsSync('sfx').find((s) => s.originalFilename?.includes('bonk'))!;
    const manualEvent: PlannedSfxEvent = {
      id: 'manual_custom_event_1',
      asset: bonkAsset,
      triggerAt: 5.5,
      volume: 1.25,
      fadeIn: 0.05,
      fadeOut: 0.25,
      enabled: true,
      origin: 'manual',
      reason: 'Người dùng tự chọn âm thanh bonk tại 5.5s',
    };

    initialPlan.sfxEvents = [...(initialPlan.sfxEvents || []), manualEvent];

    // Now RESCAN candidate SFX with the planner
    const rescannedPlan = planner.rescanCandidateSfx(candidate, settings, segments, [], initialPlan);

    // 1. Manual event MUST BE PRESERVED!
    const preservedManual = rescannedPlan.sfxEvents?.find((e) => e.id === 'manual_custom_event_1');
    expect(preservedManual).toBeDefined();
    expect(preservedManual?.triggerAt).toBe(5.5);
    expect(preservedManual?.volume).toBe(1.25);
    expect(preservedManual?.origin).toBe('manual');

    // 2. Rescanned auto events must still contain the contextual moments
    expect(rescannedPlan.suggestedMoments?.some((m) => m.type === 'slip')).toBe(true);
    expect(rescannedPlan.suggestedMoments?.some((m) => m.type === 'money')).toBe(true);
  });

  it('4. JobManager.rescanCandidateSfx updates job metadata, candidates.json and candidate.editPlan.audioEvents', async () => {
    const jobManager = new JobManager(path.join(testUserDataDir, 'jobs'));
    const dummyVideo = path.join(testUserDataDir, 'source.mp4');

    // Create a 2-second dummy source MP4 using ffmpeg
    const ffRes = await runSpawn('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=15:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      dummyVideo,
    ]).promise;
    expect(ffRes.code).toBe(0);

    const settings: JobSettings = {
      targetClipCount: 1,
      clipDurationMin: 10,
      clipDurationMax: 15,
      aspectRatio: '9:16',
      preset: 'reaction',
      captions: false,
      bgm: false,
      sfx: true,
      broll: false,
      mode: 'local',
      wordLevelCaptions: false,
      callouts: false,
      visualEffects: false,
    };

    const job = await jobManager.createJob(dummyVideo, settings, 'Test Rescan Job');
    expect(job).toBeDefined();

    // Mock analysis transcript and candidates
    const srtContent = `1\n00:00:01,000 --> 00:00:03,500\nBị đấm một cú punch cực mạnh\n\n2\n00:00:06,000 --> 00:00:08,000\nThế là mất sạch tiền rồi`;
    await jobManager.analyzeVideo(job.id, srtContent);

    const analyzedJob = jobManager.getJob(job.id)!;
    expect(analyzedJob.candidates.length).toBeGreaterThan(0);
    const cand = analyzedJob.candidates[0];

    // Trigger rescanCandidateSfx
    const rescannedJob = await jobManager.rescanCandidateSfx(job.id, cand.id);
    const updatedCand = rescannedJob.candidates.find((c) => c.id === cand.id)!;

    // Verify candidate.assetPlan and candidate.editPlan.audioEvents are synchronized
    expect(updatedCand.assetPlan).toBeDefined();
    expect(updatedCand.editPlan).toBeDefined();
    expect(updatedCand.editPlan?.audioEvents).toBeDefined();

    // Verify candidate was written to candidates.json on disk
    const candJsonPath = path.join(analyzedJob.jobDir, 'candidates', 'candidates.json');
    expect(fs.existsSync(candJsonPath)).toBe(true);
    const diskCandidates: ClipCandidate[] = JSON.parse(fs.readFileSync(candJsonPath, 'utf8'));
    const diskCand = diskCandidates.find((c) => c.id === cand.id)!;
    expect(diskCand.assetPlan?.sfxEvents?.length).toBe(updatedCand.assetPlan?.sfxEvents?.length);
  });

  it('5. End-to-End Render: Can render a subclip with an imported/repo MP3 sound (bonk.mp3) and verifies output file', async () => {
    const dummyVideo = path.join(testUserDataDir, 'render_source.mp4');
    const outMp4 = path.join(testUserDataDir, 'final_rendered_short.mp4');

    // Create 3-second source video
    await runSpawn('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920:d=3',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      dummyVideo,
    ]).promise;

    const provider = new LocalAssetProvider(repoAssetsDir, path.join(testUserDataDir, 'imported-sfx'));
    const allSfx = provider.getAllAssetsSync('sfx');
    const bonkAsset = allSfx.find((s) => s.originalFilename?.includes('bonk'))!;
    expect(bonkAsset).toBeDefined();
    expect(fs.existsSync(bonkAsset.filePath)).toBe(true);

    const candidate: ClipCandidate = {
      id: 'cand_render_test',
      title: 'Render Test Short',
      start: 0,
      end: 3,
      duration: 3,
      score: 90,
      scoreBreakdown: { hook: 90, pacing: 90, density: 90, payoff: 90 },
      reason: 'Render validation',
      transcriptExcerpt: 'Bonk test',
      selected: true,
    };

    const editPlan = {
      clipId: candidate.id,
      moments: [],
      textOverlays: [],
      visualOverlays: [],
      effects: [],
      audioEvents: [
        {
          id: 'audio_bonk_1',
          type: 'sfx' as const,
          assetPath: bonkAsset.filePath,
          triggerAt: 1.0,
          volume: 0.9,
          fadeIn: 0.05,
          fadeOut: 0.2,
          duration: 0.6,
        },
      ],
      musicTrack: null,
      duckingSettings: {
        normalVolume: 0.22,
        duckedVolume: 0.06,
        fadeInDuration: 0.5,
        fadeOutDuration: 1.0,
      },
      hasWordTiming: false,
    };

    const settings: JobSettings = {
      targetClipCount: 1,
      clipDurationMin: 3,
      clipDurationMax: 5,
      aspectRatio: '9:16',
      preset: 'reaction',
      captions: false,
      bgm: false,
      sfx: true,
      broll: false,
      mode: 'local',
      wordLevelCaptions: false,
      callouts: false,
      visualEffects: false,
    };

    // Render using renderWithEditPlan
    await renderWithEditPlan({
      clipId: candidate.id,
      projectDir: testUserDataDir,
      candidate,
      settings,
      cutVideoPath: dummyVideo,
      outputPath: outMp4,
      editPlan,
      relevantSegments: [],
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      onProgress: () => {},
      onLog: () => {},
    });

    expect(fs.existsSync(outMp4)).toBe(true);

    // Verify output with ffprobe
    const probeRes = await runSpawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,channels',
      '-of', 'json',
      outMp4,
    ]).promise;

    expect(probeRes.code).toBe(0);
    const probeData = JSON.parse(probeRes.stdout);
    const duration = parseFloat(probeData.format?.duration || '0');
    expect(duration).toBeGreaterThan(2.5);

    const audioStream = probeData.streams?.find((s: any) => s.codec_type === 'audio');
    expect(audioStream).toBeDefined();
    expect(audioStream.channels).toBe(2);
  });
});
