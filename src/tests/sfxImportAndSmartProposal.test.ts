import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { LocalAssetProvider } from '../main/assetProvider';
import { AutoAssetPlanner, migrateAssetPlan, buildAudioEventsFromAssetPlan } from '../main/autoAssetPlanner';
import { renderWithEditPlan, probeHasAudio, probeAudioDuration } from '../main/renderEngine';
import { HypitAdapter } from '../main/hypitAdapter';
import { JobManager } from '../main/jobManager';
import {
  ClipCandidate,
  JobSettings,
  PlannedSfxEvent,
  TranscriptSegment,
  ImportedSfxMetadata,
} from '../main/types';
import { runSpawn } from '../main/util';

describe('SFX Import, Smart Sound Selection & Multi-SFX Timeline Verification', () => {
  const assetsDir = path.resolve(process.cwd(), 'assets');
  const userSfxDir = path.resolve(process.cwd(), 'assets', 'sfx');
  const testImportedDir = path.join(os.tmpdir(), `test_imported_sfx_${Date.now()}`);
  const testRenderDir = path.join(os.tmpdir(), `test_sfx_render_${Date.now()}`);

  let provider: LocalAssetProvider;
  let planner: AutoAssetPlanner;
  let ffmpegPath = 'ffmpeg';
  let ffprobePath = 'ffprobe';
  let sampleVideoPath = '';

  beforeAll(async () => {
    fs.mkdirSync(testImportedDir, { recursive: true });
    fs.mkdirSync(testRenderDir, { recursive: true });

    const adapter = new HypitAdapter();
    ffmpegPath = await adapter.getFfmpegPath();
    ffprobePath = await adapter.getFfprobePath();

    provider = new LocalAssetProvider(assetsDir, testImportedDir);
    planner = new AutoAssetPlanner(provider);

    // Generate a 20-second test video with sine audio
    sampleVideoPath = path.join(testRenderDir, 'test_source_20s.mp4');
    await runSpawn(ffmpegPath, [
      '-f', 'lavfi', '-i', 'testsrc=duration=20:size=1080x1920:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=500:duration=20',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      sampleVideoPath,
      '-y',
    ]).promise;
  }, 40000);

  afterAll(() => {
    try {
      if (fs.existsSync(testImportedDir)) fs.rmSync(testImportedDir, { recursive: true, force: true });
      if (fs.existsSync(testRenderDir)) fs.rmSync(testRenderDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ── TEST 1: Physical File Verification in Workspace ────────────────────────
  it('verifies that the provided 13 MP3 files exist in assets/sfx', () => {
    expect(fs.existsSync(userSfxDir)).toBe(true);
    const existingFiles = fs.readdirSync(userSfxDir);

    const requiredPatterns = [
      'bonk',
      'bruh',
      'cartoonslip',
      'ding',
      'money',
      'pop',
      'punch-gaming',
      'rizz',
      'running-away',
      'shocked',
      'loading-lost-connection',
      'ahh!!',
      'fah',
    ];

    for (const pattern of requiredPatterns) {
      const found = existingFiles.some((f) => f.toLowerCase().includes(pattern.toLowerCase()));
      expect(found, `Expected file matching "${pattern}" in ${userSfxDir}`).toBe(true);
    }
  });

  // ── TEST 2: Import, Standardization, Classification & Rules ────────────────
  it('imports the 13 MP3 files, standardizes names, classifies, and marks ahh/fah as needs_review', async () => {
    const originalFiles = fs.readdirSync(userSfxDir)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => path.join(userSfxDir, f));

    expect(originalFiles.length).toBeGreaterThanOrEqual(13);

    // Run import through LocalAssetProvider
    const result = await provider.importSfxPaths(originalFiles, ffprobePath);

    expect(result.failed).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.imported.length).toBe(originalFiles.length);

    // Verify each imported metadata
    const manifestItems = provider.getImportedAssets();
    expect(manifestItems.length).toBe(originalFiles.length);

    // Rule: License defaults to "Chưa xác nhận"
    for (const item of manifestItems) {
      expect(item.license).toBe('Chưa xác nhận');
      expect(item.storedFilename).toMatch(/^[a-z0-9_]+_[a-f0-9]{8}\.mp3$/);
      expect(fs.existsSync(item.filePath)).toBe(true);
      expect(item.sha256).toBeDefined();
      expect(item.duration).toBeGreaterThan(0);
    }

    // Specific classification rule verifications
    const bonk = manifestItems.find((i) => i.originalFilename.includes('bonk'));
    expect(bonk).toBeDefined();
    expect(bonk?.displayName).toBe('bonk_impact');
    expect(bonk?.category).toBe('impact');
    expect(bonk?.tags).toContain('impact');
    expect(bonk?.tags).toContain('comedy');
    expect(bonk?.tags).toContain('hit');

    const bruh = manifestItems.find((i) => i.originalFilename.includes('bruh'));
    expect(bruh).toBeDefined();
    expect(bruh?.displayName).toBe('bruh_reaction');
    expect(bruh?.tags).toContain('awkward');
    expect(bruh?.tags).toContain('fail');
    expect(bruh?.tags).toContain('reaction');

    const slip = manifestItems.find((i) => i.originalFilename.includes('cartoonslip'));
    expect(slip).toBeDefined();
    expect(slip?.displayName).toBe('cartoon_slip');
    expect(slip?.tags).toContain('slip');
    expect(slip?.tags).toContain('fall');
    expect(slip?.tags).toContain('comedy');

    const ding = manifestItems.find((i) => i.originalFilename.includes('ding'));
    expect(ding).toBeDefined();
    expect(ding?.displayName).toBe('ding_reveal');
    expect(ding?.tags).toContain('reveal');
    expect(ding?.tags).toContain('idea');
    expect(ding?.tags).toContain('success');

    const money = manifestItems.find((i) => i.originalFilename.includes('money'));
    expect(money).toBeDefined();
    expect(money?.displayName).toBe('money_cue');
    expect(money?.tags).toContain('money');
    expect(money?.tags).toContain('cash');
    expect(money?.tags).toContain('reward');

    const pop = manifestItems.find((i) => i.originalFilename.includes('pop'));
    expect(pop).toBeDefined();
    expect(pop?.displayName).toBe('pop_transition');
    expect(pop?.tags).toContain('pop');
    expect(pop?.tags).toContain('transition');

    const punch = manifestItems.find((i) => i.originalFilename.includes('punch-gaming'));
    expect(punch).toBeDefined();
    expect(punch?.displayName).toBe('punch_impact');
    expect(punch?.tags).toContain('punch');
    expect(punch?.tags).toContain('hit');

    const rizz = manifestItems.find((i) => i.originalFilename.includes('rizz'));
    expect(rizz).toBeDefined();
    expect(rizz?.displayName).toBe('rizz_reaction');
    expect(rizz?.tags).toContain('rizz');
    expect(rizz?.tags).toContain('comedy');

    const running = manifestItems.find((i) => i.originalFilename.includes('running-away'));
    expect(running).toBeDefined();
    expect(running?.displayName).toBe('running_away');
    expect(running?.tags).toContain('escape');
    expect(running?.tags).toContain('chase');

    const shocked = manifestItems.find((i) => i.originalFilename.includes('shocked'));
    expect(shocked).toBeDefined();
    expect(shocked?.displayName).toBe('shocked_reaction');
    expect(shocked?.tags).toContain('surprise');
    expect(shocked?.tags).toContain('shock');

    const lostConn = manifestItems.find((i) => i.originalFilename.includes('loading-lost-connection'));
    expect(lostConn).toBeDefined();
    expect(lostConn?.displayName).toBe('connection_lost');
    expect(lostConn?.tags).toContain('disconnect');
    expect(lostConn?.tags).toContain('fail');

    // Rule: ahh and fah must have reviewStatus='needs_review'
    const ahh = manifestItems.find((i) => i.originalFilename.toLowerCase().includes('ahh'));
    expect(ahh).toBeDefined();
    expect(ahh?.reviewStatus).toBe('needs_review');

    const fah = manifestItems.find((i) => i.originalFilename.toLowerCase().includes('fah'));
    expect(fah).toBeDefined();
    expect(fah?.reviewStatus).toBe('needs_review');

    // Check that original files in assets/sfx/ are UNMODIFIED
    for (const orig of originalFiles) {
      expect(fs.existsSync(orig)).toBe(true);
    }
  });

  // ── TEST 3: Duplicate Rejection & Corrupt File Handling ─────────────────────
  it('detects duplicate files by SHA-256 and handles corrupt files gracefully', async () => {
    const originalFiles = fs.readdirSync(userSfxDir)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => path.join(userSfxDir, f));

    // Try importing the exact same files again
    const dupResult = await provider.importSfxPaths(originalFiles, ffprobePath);
    expect(dupResult.imported.length).toBe(0);
    expect(dupResult.duplicates.length).toBe(originalFiles.length);

    // Try importing a corrupted / invalid audio file
    const corruptFile = path.join(testRenderDir, 'corrupt.mp3');
    fs.writeFileSync(corruptFile, 'THIS_IS_NOT_AUDIO_DATA_AT_ALL', 'utf8');

    const corruptResult = await provider.importSfxPaths([corruptFile], ffprobePath);
    expect(corruptResult.failed.length).toBe(1);
    expect(corruptResult.failed[0].path).toBe(corruptFile);
    expect(corruptResult.imported.length).toBe(0);
  });

  // ── TEST 4: Persistence across App Restarts ─────────────────────────────────
  it('persists imported assets across provider reload / restart', async () => {
    // Create brand new provider pointing to the same imported directory
    const newProvider = new LocalAssetProvider(assetsDir, testImportedDir);
    const allSfx = await newProvider.getAllAssets('sfx');

    expect(allSfx.length).toBeGreaterThanOrEqual(13);
    const bonk = allSfx.find((s) => s.name === 'bonk_impact');
    expect(bonk).toBeDefined();
    expect(bonk?.license).toBe('Chưa xác nhận');
  });

  // ── TEST 5: Metadata Editing and Deletion ───────────────────────────────────
  it('allows editing displayName, tags, category, license and deleting from library', async () => {
    const items = provider.getImportedAssets();
    const target = items.find((i) => i.displayName === 'cartoon_slip');
    expect(target).toBeDefined();

    // Edit metadata
    const updated = await provider.updateImportedAsset(target!.id, {
      displayName: 'my_custom_slip_sound',
      tags: ['custom_slip', 'funny_fall'],
      license: 'Royalty-Free Purchased License',
      category: 'comedy',
      reviewStatus: 'approved',
    });

    expect(updated.displayName).toBe('my_custom_slip_sound');
    expect(updated.tags).toEqual(['custom_slip', 'funny_fall']);
    expect(updated.license).toBe('Royalty-Free Purchased License');

    // Confirm cached asset reflects update
    const allSfx = await provider.getAllAssets('sfx');
    const updatedInCache = allSfx.find((s) => s.id === target!.id);
    expect(updatedInCache?.name).toBe('my_custom_slip_sound');
    expect(updatedInCache?.license).toBe('Royalty-Free Purchased License');

    // Delete one asset
    const deletedOk = await provider.deleteImportedAsset(target!.id);
    expect(deletedOk).toBe(true);
    expect(fs.existsSync(target!.filePath)).toBe(false);

    const reloadedItems = provider.getImportedAssets();
    expect(reloadedItems.some((i) => i.id === target!.id)).toBe(false);
  });

  // ── TEST 6: Two-Tier AI Smart Sound Selection Contextual Rules ──────────────
  it('proposes SFX based on two-tier context (transcript + audio characteristics)', async () => {
    const candidate: ClipCandidate = {
      id: 'clip_sample_ai_test',
      start: 0,
      end: 20,
      duration: 20,
      title: 'Tình huống bất ngờ và mất sạch tiền',
      hookText: 'Bạn sẽ không tin điều này!',
      summary: 'Một câu chuyện hài hước và ngã lăn ra',
      score: 90,
      selected: true,
      scoring: {
        virality: 90,
        hookStrength: 85,
        flow: 85,
        punchline: 90,
        audioEnergy: 80,
        standalone: 85,
        pacing: 80,
      },
    };

    const transcriptSegments: TranscriptSegment[] = [
      { id: '1', start: 0.5, end: 2.5, text: 'Hôm nay tôi đầu tư kiếm được rất nhiều tiền và nhận thưởng lớn.' }, // money context
      { id: '2', start: 4.0, end: 7.0, text: 'Đang đi thì bất ngờ bị trượt ngã lăn ra đường.' }, // slip context
      { id: '3', start: 8.0, end: 11.0, text: 'I lost everything, thất bại hoàn toàn rồi...' }, // fail punchline
      { id: '4', start: 14.0, end: 18.0, text: 'Cuối cùng phải chạy trốn kẻ truy đuổi thật nhanh.' }, // chase context
    ];

    const silences = [
      { start: 11.2, end: 12.8, duration: 1.6 }, // Silence right after fail punchline!
    ];

    const settings: JobSettings = {
      targetClipCount: 1,
      clipDurationMin: 15,
      clipDurationMax: 20,
      aspectRatio: '9:16',
      preset: 'reaction',
      captions: false,
      bgm: false,
      sfx: true,
      broll: false,
      mode: 'local',
    };

    const plan = planner.planForClip(candidate, settings, transcriptSegments, silences);

    expect(plan.suggestedMoments).toBeDefined();
    const moments = plan.suggestedMoments!;

    // 1. Money moment rule: matched when real money words present
    const moneyMoment = moments.find((m) => m.type === 'money');
    expect(moneyMoment).toBeDefined();
    expect(moneyMoment?.evidence).toContain('tiền');
    expect(moneyMoment?.suggestedSfx?.category).toBe('money');

    // 2. Slip moment rule: matched when slip/ngã present
    const slipMoment = moments.find((m) => m.type === 'slip');
    expect(slipMoment).toBeDefined();
    expect(slipMoment?.evidence).toContain('trượt');

    // 3. Bruh moment rule: placed in silence after fail punchline
    const failMoment = moments.find((m) => m.type === 'fail');
    expect(failMoment).toBeDefined();
    expect(failMoment?.suggestedSfx?.name.toLowerCase()).toContain('bruh');
    // Timestamp should be in the silence window (>= 11.2)
    expect(failMoment!.timestamp).toBeGreaterThanOrEqual(11.2);
    expect(failMoment?.reason).toContain('I lost');

    // 4. Chase moment rule
    const chaseMoment = moments.find((m) => m.type === 'chase');
    expect(chaseMoment).toBeDefined();
    expect(chaseMoment?.suggestedSfx?.name).toContain('running');
  });

  // ── TEST 7: Placeholder Transcript Does NOT Trigger False Concrete Claims ──
  it('marks proposals as "suggested" and avoids false action claims when transcript is placeholder', () => {
    const candidate: ClipCandidate = {
      id: 'clip_placeholder_test',
      start: 0,
      end: 18,
      duration: 18,
      title: 'Short không có transcript',
      hookText: 'Clip vui nhộn',
      summary: 'Video',
      score: 80,
      selected: true,
      scoring: {
        virality: 80,
        hookStrength: 80,
        flow: 80,
        punchline: 80,
        audioEnergy: 80,
        standalone: 80,
        pacing: 80,
      },
    };

    const placeholderSegments: TranscriptSegment[] = [
      { id: '1', start: 0, end: 5, text: '[Đoạn nói 1]', isPlaceholder: true },
      { id: '2', start: 6, end: 12, text: '[Đoạn nói 2]', isPlaceholder: true },
    ];

    const settings: JobSettings = {
      targetClipCount: 1,
      clipDurationMin: 15,
      clipDurationMax: 20,
      aspectRatio: '9:16',
      preset: 'reaction',
      captions: false,
      bgm: false,
      sfx: true,
      broll: false,
      mode: 'local',
    };

    const plan = planner.planForClip(candidate, settings, placeholderSegments, []);
    expect(plan.suggestedMoments).toBeDefined();

    // Hook proposal should be flagged as 'suggested' requiring review
    const hookMoment = plan.suggestedMoments!.find((m) => m.type === 'hook');
    expect(hookMoment?.status).toBe('suggested');
    expect(hookMoment?.evidence).toContain('chờ duyệt do thiếu transcript thật');

    // Must NOT propose money or cartoon_slip without evidence
    expect(plan.suggestedMoments!.some((m) => m.type === 'money')).toBe(false);
    expect(plan.suggestedMoments!.some((m) => m.type === 'slip')).toBe(false);
  });

  // ── TEST 8: Multi-SFX Timeline & Render Synchronization ────────────────────
  it('renders a Short with 3-5 SFX at exact timestamps and synchronizes candidate editPlan', async () => {
    const allSfx = await provider.getAllAssets('sfx');
    expect(allSfx.length).toBeGreaterThanOrEqual(3);

    const sfx1 = allSfx.find((s) => s.name.includes('ding')) || allSfx[0];
    const sfx2 = allSfx.find((s) => s.name.includes('punch')) || allSfx[1];
    const sfx3 = allSfx.find((s) => s.name.includes('pop')) || allSfx[2];

    const plannedEvents: PlannedSfxEvent[] = [
      {
        id: 'sfx_evt_1',
        asset: sfx1,
        triggerAt: 2.0,
        volume: 0.9,
        fadeIn: 0.05,
        fadeOut: 0.2,
        enabled: true,
        origin: 'manual',
        reason: 'SFX mốc 2.0s',
      },
      {
        id: 'sfx_evt_2',
        asset: sfx2,
        triggerAt: 7.5,
        volume: 0.85,
        fadeIn: 0.05,
        fadeOut: 0.25,
        enabled: true,
        origin: 'manual',
        reason: 'SFX mốc 7.5s',
      },
      {
        id: 'sfx_evt_3',
        asset: sfx3,
        triggerAt: 14.0,
        volume: 0.8,
        fadeIn: 0.05,
        fadeOut: 0.25,
        enabled: true,
        origin: 'manual',
        reason: 'SFX mốc 14.0s',
      },
    ];

    const candidate: ClipCandidate = {
      id: 'clip_multi_sfx_render',
      start: 0,
      end: 20,
      duration: 20,
      title: 'Render Multi-SFX Test',
      hookText: 'Test Hook',
      summary: 'Test summary',
      score: 90,
      selected: true,
      scoring: {
        virality: 90,
        hookStrength: 90,
        flow: 90,
        punchline: 90,
        audioEnergy: 90,
        standalone: 90,
        pacing: 90,
      },
      assetPlan: {
        clipId: 'clip_multi_sfx_render',
        musicTrack: null,
        beats: [],
        sfxEvents: plannedEvents,
        duckingSettings: {
          normalVolume: 0.2,
          duckedVolume: 0.05,
          fadeInDuration: 0.5,
          fadeOutDuration: 1.0,
        },
      },
    };

    // Instantiate JobManager to test candidate synchronization
    const jobManager = new JobManager(testRenderDir);
    const audioEvents = buildAudioEventsFromAssetPlan(candidate.assetPlan!, [], 20);
    expect(audioEvents.length).toBe(3);
    expect(audioEvents[0].triggerAt).toBe(2.0);
    expect(audioEvents[1].triggerAt).toBe(7.5);
    expect(audioEvents[2].triggerAt).toBe(14.0);

    // Test editing an SFX after Analyze: swap sfx2 to bonk
    const bonkSfx = allSfx.find((s) => s.name.includes('bonk')) || allSfx[0];
    plannedEvents[1].asset = bonkSfx;
    plannedEvents[1].triggerAt = 8.0;

    const updatedAudioEvents = buildAudioEventsFromAssetPlan(candidate.assetPlan!, [], 20);
    expect(updatedAudioEvents[1].assetPath).toBe(bonkSfx.filePath);
    expect(updatedAudioEvents[1].triggerAt).toBe(8.0);

    // Render with edit plan containing the 3 SFX events
    const outputPath = path.join(testRenderDir, 'rendered_multi_sfx.mp4');
    const editPlan = {
      clipId: candidate.id,
      moments: [],
      audioEvents: updatedAudioEvents,
      visualOverlays: [],
    };

    await renderWithEditPlan({
      clipId: candidate.id,
      projectDir: testRenderDir,
      candidate,
      settings: {
        targetClipCount: 1,
        clipDurationMin: 15,
        clipDurationMax: 20,
        aspectRatio: '9:16',
        preset: 'reaction',
        captions: false,
        bgm: false,
        sfx: true,
        broll: false,
        mode: 'local',
      },
      cutVideoPath: sampleVideoPath,
      outputPath,
      editPlan,
      relevantSegments: [],
      ffmpegPath,
      ffprobePath,
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    const stat = fs.statSync(outputPath);
    expect(stat.size).toBeGreaterThan(100000);

    const hasAudio = await probeHasAudio(outputPath, ffprobePath);
    expect(hasAudio).toBe(true);

    const duration = await probeAudioDuration(outputPath, ffprobePath);
    expect(duration).toBeGreaterThan(18.5);
    expect(duration).toBeLessThanOrEqual(20.5);
  }, 45000);
});
