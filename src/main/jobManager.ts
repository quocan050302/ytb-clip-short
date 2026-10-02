import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  AudioEventPlan,
  ClipAssetPlan,
  ClipCandidate,
  ClipEditPlan,
  DuckingSettings,
  EnhanceSettings,
  JobMetadata,
  JobSettings,
  LogEntry,
  MomentEvent,
  PlannedSfxEvent,
  RenderedClip,
  TranscriptSegment,
  VideoInfo,
  VisualOverlayPlan,
} from './types';
import { HypitAdapter } from './hypitAdapter';
import { VideoAnalyzer } from './videoAnalyzer';
import { AutoAssetPlanner } from './autoAssetPlanner';
import { MomentPlanner } from './momentPlanner';
import { loadSpeechTimeline, filterAndRemapSegments } from './speechTimeline';
import { enhanceVideo } from './videoEnhancer';
import {
  buildFrameTimestamps,
  extractFrameCandidates,
  scoreFrameCandidates,
  renderShortsThumbnail,
  suggestShortsCopy,
  writeShortsMetadata,
} from './shortsPackage';

import {
  migrateAssetPlan,
  buildAudioEventsFromAssetPlan,
  buildVisualOverlaysFromAssetPlan,
} from './autoAssetPlanner';

export {
  migrateAssetPlan,
  buildAudioEventsFromAssetPlan,
  buildVisualOverlaysFromAssetPlan,
};

/**
 * Synchronize candidate.assetPlan into candidate.editPlan so renderer always executes the latest plan.
 */
export function syncAssetPlanToEditPlan(candidate: ClipCandidate): void {
  if (!candidate.assetPlan) return;
  candidate.assetPlan = migrateAssetPlan(candidate.assetPlan, candidate.duration);
  if (candidate.editPlan) {
    candidate.editPlan.audioEvents = buildAudioEventsFromAssetPlan(
      candidate.assetPlan,
      candidate.editPlan.moments,
      candidate.duration
    );
    candidate.editPlan.visualOverlays = buildVisualOverlaysFromAssetPlan(
      candidate.assetPlan,
      candidate.editPlan.moments,
      candidate.duration
    );
    candidate.editPlan.musicTrack = candidate.assetPlan.musicTrack;
    candidate.editPlan.duckingSettings = candidate.assetPlan.duckingSettings;
    candidate.editPlan.legacyAssetPlan = candidate.assetPlan;
  }
}

export class JobManager {
  private baseJobsDir: string;
  private jobs: Map<string, JobMetadata> = new Map();
  private hypitAdapter: HypitAdapter;
  private videoAnalyzer: VideoAnalyzer;
  private autoAssetPlanner: AutoAssetPlanner;
  private momentPlanner: MomentPlanner;
  private onJobUpdatedCallback?: (job: JobMetadata) => void;

  constructor(customJobsDir?: string) {
    this.baseJobsDir =
      customJobsDir ||
      path.join(os.homedir(), 'Documents', 'AutoClip_Jobs');

    if (!fs.existsSync(this.baseJobsDir)) {
      fs.mkdirSync(this.baseJobsDir, { recursive: true });
    }

    this.hypitAdapter = new HypitAdapter();
    this.videoAnalyzer = new VideoAnalyzer();
    this.autoAssetPlanner = new AutoAssetPlanner();
    this.momentPlanner = new MomentPlanner();
    this.loadAllJobs();
  }

  getAutoAssetPlanner(): AutoAssetPlanner {
    return this.autoAssetPlanner;
  }

  setJobUpdatedCallback(cb: (job: JobMetadata) => void): void {
    this.onJobUpdatedCallback = cb;
  }

  private notifyUpdate(job: JobMetadata): void {
    this.saveJobMetadata(job);
    if (this.onJobUpdatedCallback) {
      this.onJobUpdatedCallback(job);
    }
  }

  getBaseJobsDir(): string {
    return this.baseJobsDir;
  }

  /**
   * Load existing jobs from disk to ensure persistence across app restarts
   */
  loadAllJobs(): void {
    try {
      const entries = fs.readdirSync(this.baseJobsDir);
      for (const entry of entries) {
        const jobDir = path.join(this.baseJobsDir, entry);
        const metaPath = path.join(jobDir, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const raw = fs.readFileSync(metaPath, 'utf8');
            const data: JobMetadata = JSON.parse(raw);
            if (data.candidates && Array.isArray(data.candidates)) {
              for (const cand of data.candidates) {
                if (cand.assetPlan) {
                  cand.assetPlan = migrateAssetPlan(cand.assetPlan, cand.duration);
                  syncAssetPlanToEditPlan(cand);
                }
              }
            }
            this.jobs.set(data.id, data);
          } catch (err) {
            console.warn(`Failed to parse job metadata in ${jobDir}:`, err);
          }
        }
      }
    } catch (err) {
      console.warn('Error reading base jobs dir:', err);
    }
  }

  getAllJobs(): JobMetadata[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getJob(id: string): JobMetadata | undefined {
    return this.jobs.get(id);
  }

  saveJobMetadata(job: JobMetadata): void {
    job.updatedAt = new Date().toISOString();
    const metaPath = path.join(job.jobDir, 'metadata.json');
    try {
      fs.writeFileSync(metaPath, JSON.stringify(job, null, 2), 'utf8');
    } catch (err) {
      console.error(`Failed to write metadata for job ${job.id}:`, err);
    }
  }

  addLog(jobId: string, level: LogEntry['level'], message: string, clipId?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      clipId,
    };
    job.logs.push(entry);

    // Append to logs file
    const logFile = path.join(job.jobDir, 'logs', 'process.log');
    try {
      fs.appendFileSync(logFile, `[${entry.timestamp}] [${level.toUpperCase()}] ${clipId ? `[${clipId}] ` : ''}${message}\n`);
    } catch {
      // Ignore
    }

    this.notifyUpdate(job);
  }

  /**
   * Create a new job folder and initialize metadata
   */
  async createJob(
    videoPath: string,
    settings: JobSettings,
    customTitle?: string
  ): Promise<JobMetadata> {
    const jobId = `job_${Date.now()}`;
    const jobDir = path.join(this.baseJobsDir, jobId);

    // Create subfolders
    const dirs = ['input', 'transcript', 'candidates', 'hypit_projects', 'logs', 'outputs'];
    for (const d of dirs) {
      fs.mkdirSync(path.join(jobDir, d), { recursive: true });
    }

    const title = customTitle || path.basename(videoPath, path.extname(videoPath));

    // Probe video
    let videoInfo: VideoInfo = {
      duration: 0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
    };

    try {
      videoInfo = await this.hypitAdapter.probeMedia(videoPath);
    } catch (err: any) {
      console.warn('Could not probe video info:', err.message);
    }

    const job: JobMetadata = {
      id: jobId,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceVideoPath: videoPath,
      videoInfo,
      settings,
      status: 'idle',
      transcript: [],
      candidates: [],
      clips: [],
      logs: [],
      jobDir,
    };

    this.jobs.set(jobId, job);
    this.addLog(jobId, 'info', `Tạo dự án mới: "${title}". Thời lượng: ${videoInfo.duration.toFixed(1)}s, Kích thước: ${videoInfo.width}x${videoInfo.height}`);
    this.notifyUpdate(job);
    return job;
  }

  /**
   * Run analysis step: audio silence detection, transcript parsing, candidate generation
   */
  async analyzeVideo(jobId: string, srtContent?: string): Promise<JobMetadata> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    job.status = 'analyzing';
    this.addLog(jobId, 'info', 'Bắt đầu phân tích âm thanh, nhịp điệu và lời thoại...');
    this.notifyUpdate(job);

    try {
      // 1. Detect silence intervals
      this.addLog(jobId, 'info', 'Đang quét khoảng lặng âm thanh qua bộ lọc silencedetect...');
      const silences = await this.videoAnalyzer.detectSilence(job.sourceVideoPath);
      this.addLog(jobId, 'info', `Phát hiện ${silences.length} điểm ngắt khoảng lặng.`);

      // 2. Handle transcript with SpeechTimeline
      const speechResult = loadSpeechTimeline(undefined, srtContent ?? '');
      for (const w of speechResult.warnings) {
        this.addLog(jobId, speechResult.hasWordTiming ? 'info' : 'warn', w);
      }

      let segments: TranscriptSegment[] = [];
      if (speechResult.segments.length > 0) {
        segments = speechResult.segments;
        this.addLog(jobId, 'info', `SpeechTimeline: ${segments.length} segments, word-timing: ${speechResult.hasWordTiming}`);
        fs.writeFileSync(path.join(job.jobDir, 'transcript', 'subtitles.srt'), srtContent ?? '', 'utf8');
      } else {
        this.addLog(jobId, 'info', 'Không có SRT tải lên: tự động sinh mốc phân đoạn theo nhịp nói và khoảng lặng...');
        this.addLog(jobId, 'warn', 'Không có transcript thật, captions đã được bỏ qua.');
        segments = this.videoAnalyzer.generateSilenceBasedTranscript(
          job.videoInfo.duration,
          silences
        );
      }

      job.transcript = segments;
      fs.writeFileSync(
        path.join(job.jobDir, 'transcript', 'transcript.json'),
        JSON.stringify(segments, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(job.jobDir, 'transcript', 'silences.json'),
        JSON.stringify(silences, null, 2),
        'utf8'
      );

      // 3. Generate candidate clips
      this.addLog(jobId, 'info', `Bắt đầu tính điểm Hook, Pacing, Payoff và tạo các đoạn clip đề xuất (${job.settings.targetClipCount} clips)...`);
      let candidates = this.videoAnalyzer.generateCandidates(
        segments,
        silences,
        job.videoInfo.duration,
        job.settings
      );

      // 4. Auto Asset Planning (legacy beats + BGM)
      this.addLog(jobId, 'info', 'Khởi chạy Auto Asset Planner: quét nhịp (hook/surprise/reveal/fail/punchline) & tự động đồng bộ Meme + SFX + BGM Ducking...');
      candidates = this.autoAssetPlanner.planAll(
        candidates,
        job.settings,
        segments,
        silences
      );

      // 5. Build ClipEditPlan for each candidate
      this.addLog(jobId, 'info', 'Xây dựng ClipEditPlan (MomentPlanner + TextOverlays + VisualOverlays + Effects)...');
      candidates = candidates.map((cand) => ({
        ...cand,
        editPlan: this.buildEditPlan(cand, job.settings, segments, silences, speechResult.hasWordTiming, speechResult.warnings),
      }));

      // 6. Extract thumbnails
      this.addLog(jobId, 'info', 'Trích xuất thumbnail kháung hình cho các đoạn đề xuất...');
      const timestamps = candidates.map((c) => c.start + Math.min(2, c.duration / 2));
      const thumbsDir = path.join(job.jobDir, 'candidates', 'thumbnails');
      const thumbPaths = await this.hypitAdapter.extractThumbnails(
        job.sourceVideoPath,
        timestamps,
        thumbsDir
      );

      for (let i = 0; i < candidates.length; i++) {
        if (thumbPaths[i]) candidates[i].thumbnailPath = thumbPaths[i];
      }

      job.candidates = candidates;
      fs.writeFileSync(
        path.join(job.jobDir, 'candidates', 'candidates.json'),
        JSON.stringify(candidates, null, 2),
        'utf8'
      );

      job.status = 'candidates_ready';
      this.addLog(jobId, 'info', `Đã tìm thấy ${candidates.length} đoạn shorts tiềm năng và hoàn tất Auto Asset Plan + ClipEditPlan! Sẵn sàng duyệt.`);
      this.notifyUpdate(job);
      return job;
    } catch (err: any) {
      job.status = 'error';
      this.addLog(jobId, 'error', `Lỗi trong quá trình phân tích: ${err.message}`);
      this.notifyUpdate(job);
      throw err;
    }
  }

  /**
   * Build a ClipEditPlan from a candidate using MomentPlanner + AutoAssetPlanner.
   * Converts AssetPlan beats → AudioEventPlan + VisualOverlayPlan.
   * Generates TextOverlayPlan from transcript segments.
   */
  private buildEditPlan(
    candidate: ClipCandidate,
    settings: JobSettings,
    allSegments: TranscriptSegment[],
    silences: Array<{ start: number; end: number }>,
    hasWordTiming: boolean,
    warnings: string[]
  ): ClipEditPlan {
    const clipDur = candidate.duration;
    const clipStart = candidate.start;
    const clipEnd = candidate.end;

    // Filter & remap segments to clip-relative
    const clipSegments: TranscriptSegment[] = filterAndRemapSegments(allSegments, clipStart, clipEnd);

    // Remap silences to clip-relative
    const clipSilences = silences
      .map((s) => ({ start: Math.max(0, s.start - clipStart), end: Math.min(clipDur, s.end - clipStart) }))
      .filter((s) => s.end > s.start && s.start < clipDur);

    // Detect moments
    const moments = this.momentPlanner.detectMoments(clipSegments, clipSilences, clipDur);

    // Enhance settings: wire settings.hdEnhance + settings.enhanceMode
    const enhanceMode = settings.hdEnhance
      ? (settings.enhanceMode ?? 'blur-bg-preserve')
      : (settings.enhance?.mode ?? 'none');

    const enhance: EnhanceSettings = {
      mode: enhanceMode,
      targetResolution: settings.enhance?.targetResolution ?? '1080p',
      faceAware: settings.enhance?.faceAware ?? false,
      blurRadius: settings.enhance?.blurRadius ?? 40,
      upscaleFactor: settings.enhance?.upscaleFactor ?? 2,
      sharpen: settings.enhance?.sharpen ?? true,
    };

    // Default ducking from assetPlan or hardcoded
    const duckingSettings: DuckingSettings = candidate.assetPlan?.duckingSettings ?? {
      normalVolume: 0.35,
      duckedVolume: 0.12,
      fadeInDuration: 0.5,
      fadeOutDuration: 1.0,
    };

    // Build TextOverlayPlan from caption segments (filter out placeholders!)
    const realClipSegments = clipSegments.filter(
      (s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text)
    );

    const textOverlays = realClipSegments.map((seg, i) => ({
      id: `text_${i}`,
      text: seg.text,
      start: seg.start,
      end: seg.end,
      style: 'caption' as const,
      color: '#FFFFFF',
      fontSize: 72,
      xNorm: 0.5,
      yNorm: 0.82,
      animation: 'fade' as const,
    }));

    // Build VisualOverlayPlan from assetPlan beats (memes)
    const visualOverlays = buildVisualOverlaysFromAssetPlan(candidate.assetPlan, moments, clipDur);

    // Build AudioEventPlan from assetPlan sfxEvents (or beats fallback)
    const audioEvents = buildAudioEventsFromAssetPlan(candidate.assetPlan, moments, clipDur);

    // Build EffectPlan from high-confidence moments
    const effects = moments
      .filter((m) => ['hook', 'surprise', 'punchline', 'fail'].includes(m.momentType) && m.confidence > 0.70)
      .map((m, i) => ({
        id: `eff_${i}`,
        effect: (m.momentType === 'surprise' || m.momentType === 'fail' ? 'zoom-punch' : 'flash') as any,
        start: m.timestamp,
        end: Math.min(clipDur, m.timestamp + Math.min(0.4, m.duration)),
        intensity: m.confidence * 0.6,
        momentId: m.id,
      }));

    const editWarnings = [...warnings];
    if (realClipSegments.length === 0) {
      editWarnings.push('Không có transcript thật, captions đã được bỏ qua.');
    }
    if (!hasWordTiming) {
      editWarnings.push(
        'No SRT/WhisperX word-level timing – word-level captions DISABLED. ' +
        'Upload a .srt or whisperx.json for animated word captions.'
      );
    }

    return {
      clipId: candidate.id,
      moments,
      textOverlays,
      visualOverlays,
      effects: settings.visualEffects ? effects : [],
      audioEvents,
      musicTrack: candidate.assetPlan?.musicTrack ?? null,
      duckingSettings,
      legacyAssetPlan: candidate.assetPlan,
      enhance,
      hasWordTiming,
      warnings: editWarnings,
    };
  }

  /**
   * Update candidate list (allow editing times, reordering, deleting, adding)
   */
  updateCandidates(jobId: string, candidates: ClipCandidate[]): JobMetadata {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const enriched = candidates.map((cand) => {
      if (!cand.assetPlan) {
        return {
          ...cand,
          assetPlan: this.autoAssetPlanner.planForClip(cand, job.settings, job.transcript, []),
        };
      }
      return cand;
    });

    job.candidates = enriched;
    fs.writeFileSync(
      path.join(job.jobDir, 'candidates', 'candidates.json'),
      JSON.stringify(enriched, null, 2),
      'utf8'
    );
    this.addLog(jobId, 'info', `Cập nhật danh sách candidate (${enriched.length} clips)`);
    this.notifyUpdate(job);
    return job;
  }

  /**
   * Update asset plan for a single candidate
   */
  updateCandidateAssetPlan(
    jobId: string,
    candidateId: string,
    assetPlan: ClipAssetPlan
  ): JobMetadata {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const cand = job.candidates.find((c) => c.id === candidateId);
    if (cand) {
      const migrated = migrateAssetPlan(assetPlan, cand.duration);
      // Validate asset files exist
      for (const evt of migrated.sfxEvents || []) {
        if (evt.enabled !== false && evt.asset?.filePath) {
          if (!fs.existsSync(evt.asset.filePath)) {
            this.addLog(
              jobId,
              'warn',
              `Cảnh báo: File SFX "${evt.asset.name}" (${evt.asset.filePath}) không tồn tại trên ổ đĩa.`,
              candidateId
            );
          }
        }
      }

      cand.assetPlan = migrated;
      syncAssetPlanToEditPlan(cand);
      fs.writeFileSync(
        path.join(job.jobDir, 'candidates', 'candidates.json'),
        JSON.stringify(job.candidates, null, 2),
        'utf8'
      );
      this.addLog(jobId, 'info', `Cập nhật Kế hoạch Asset (Meme/SFX/BGM) cho clip "${cand.title}"`, candidateId);
      this.notifyUpdate(job);
    }
    return job;
  }

  /**
   * Rescan SFX proposals for a candidate with the latest SFX catalog
   */
  async rescanCandidateSfx(jobId: string, candidateId: string): Promise<JobMetadata> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const cand = job.candidates.find((c) => c.id === candidateId);
    if (!cand) throw new Error(`Candidate ${candidateId} not found in job ${jobId}`);

    const catalogCount = this.autoAssetPlanner.getAssetProvider().getAllAssetsSync('sfx').length;

    let silences = [];
    const silencesPath = path.join(job.jobDir, 'transcript', 'silences.json');
    if (fs.existsSync(silencesPath)) {
      try {
        silences = JSON.parse(fs.readFileSync(silencesPath, 'utf8'));
      } catch {
        silences = [];
      }
    }

    const newPlan = this.autoAssetPlanner.rescanCandidateSfx(
      cand,
      job.settings,
      job.transcript || [],
      silences,
      cand.assetPlan
    );

    cand.assetPlan = newPlan;
    syncAssetPlanToEditPlan(cand);

    fs.writeFileSync(
      path.join(job.jobDir, 'candidates', 'candidates.json'),
      JSON.stringify(job.candidates, null, 2),
      'utf8'
    );

    this.addLog(
      jobId,
      'info',
      `Quét lại đề xuất SFX cho clip "${cand.title}" (${catalogCount} sound trong catalog, ${cand.assetPlan?.sfxEvents?.length || 0} SFX timeline)`,
      candidateId
    );
    this.notifyUpdate(job);
    return job;
  }

  /**
   * Render all selected candidates
   */
  async renderAllCandidates(jobId: string): Promise<JobMetadata> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const selectedCandidates = job.candidates.filter((c) => c.selected);
    if (selectedCandidates.length === 0) {
      throw new Error('Chưa chọn clip nào để dựng');
    }

    job.status = 'rendering';
    this.notifyUpdate(job);

    // Initialize or reset clip status
    job.clips = selectedCandidates.map((c, idx) => ({
      id: `clip_${idx + 1}`,
      candidateId: c.id,
      title: c.title,
      status: 'queued',
      progress: 0,
      duration: c.duration,
      updatedAt: new Date().toISOString(),
    }));
    this.notifyUpdate(job);

    for (const clip of job.clips) {
      const candidate = selectedCandidates.find((c) => c.id === clip.candidateId);
      if (!candidate) continue;

      await this.renderSingleClip(jobId, clip.id);
    }

    const allFinished = job.clips.every(
      (c) => c.status === 'completed' || c.status === 'failed' || c.status === 'canceled'
    );
    if (allFinished) {
      const anyCompleted = job.clips.some((c) => c.status === 'completed');
      job.status = anyCompleted ? 'completed' : 'error';
      this.notifyUpdate(job);
    }

    return job;
  }

  /**
   * Render or retry a single clip
   */
  async renderSingleClip(jobId: string, clipId: string): Promise<RenderedClip> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    let clip = job.clips.find((c) => c.id === clipId);
    const candidate = job.candidates.find((c) => c.id === clip?.candidateId);

    if (!clip || !candidate) {
      throw new Error(`Clip ${clipId} or candidate not found in job ${jobId}`);
    }

    clip.status = 'planning';
    clip.progress = 10;
    clip.error = undefined;
    clip.updatedAt = new Date().toISOString();
    this.notifyUpdate(job);

    const projectDir = path.join(job.jobDir, 'hypit_projects', clipId);
    const outputPath = path.join(job.jobDir, 'outputs', `${clipId}_${cleanFilename(candidate.title)}.mp4`);

    // Get relevant transcript segments for this clip
    const relevantSegs = job.transcript.filter(
      (s) => s.end >= candidate.start && s.start <= candidate.end
    );

    try {
      clip.status = 'rendering';
      this.notifyUpdate(job);

      let finalPath: string;
      let renderEngine: 'hypit' | 'ffmpeg-fallback' = 'ffmpeg-fallback';
      let enhancedPath: string | undefined;
      // Always migrate and synchronize assetPlan into editPlan right before rendering
      if (candidate.assetPlan) {
        candidate.assetPlan = migrateAssetPlan(candidate.assetPlan, candidate.duration);
        syncAssetPlanToEditPlan(candidate);
      }

      if (candidate.editPlan) {
        // New path: use ClipEditPlan + renderEngine + videoEnhancer
        const result = await this.hypitAdapter.renderClipWithEditPlan(
          clipId,
          projectDir,
          candidate,
          job.settings,
          job.sourceVideoPath,
          outputPath,
          candidate.editPlan,
          relevantSegs,
          (percent, phase) => {
            clip!.progress = percent;
            clip!.updatedAt = new Date().toISOString();
            this.addLog(jobId, 'info', `[${clipId}] ${percent}% - ${phase}`, clipId);
            this.notifyUpdate(job);
          },
          (msg) => {
            this.addLog(jobId, 'info', msg, clipId);
          }
        );
        finalPath = result.outputPath;
        renderEngine = result.engine;
        enhancedPath = result.enhancedPath;
        if (result.hdEnhanceFailed) {
          clip.hdEnhanceFailed = true;
          this.addLog(jobId, 'warn', `[${clipId}] HD enhance failed, using normal render`, clipId);
        }
      } else {
        // Legacy path: backward compat with old renderClip
        finalPath = await this.hypitAdapter.renderClip(
          clipId,
          projectDir,
          candidate,
          job.settings,
          job.sourceVideoPath,
          outputPath,
          relevantSegs,
          (percent, phase) => {
            clip!.progress = percent;
            clip!.updatedAt = new Date().toISOString();
            this.addLog(jobId, 'info', `[${clipId}] ${percent}% - ${phase}`, clipId);
            this.notifyUpdate(job);
          },
          (msg) => {
            this.addLog(jobId, 'info', msg, clipId);
          }
        );

        if (job.settings.hdEnhance) {
          try {
            const enhOut = outputPath.replace(/\.mp4$/i, '_HD.mp4');
            const enhResult = await enhanceVideo({
              inputPath: finalPath,
              outputPath: enhOut,
              settings: {
                mode: job.settings.enhanceMode ?? 'blur-bg-preserve',
                blurRadius: 40,
                sharpen: true,
              },
              isVertical: true,
              ffmpegPath: await this.hypitAdapter.getFfmpegPath(),
              ffprobePath: await this.hypitAdapter.getFfprobePath(),
              onLog: (m: string) => this.addLog(jobId, 'info', m, clipId),
              onProgress: () => {},
            });
            if (!enhResult.skipped && fs.existsSync(enhResult.outputPath)) {
              enhancedPath = enhResult.outputPath;
              finalPath = enhResult.outputPath;
            }
          } catch (enhErr: any) {
            clip.hdEnhanceFailed = true;
            this.addLog(jobId, 'warn', `[${clipId}] HD enhance failed, using normal render`, clipId);
          }
        }
      }

      // Acceptance criterion 5: Clip only completed when final MP4 exists and is playable
      if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size === 0) {
        throw new Error(`File MP4 xuất bản không tồn tại hoặc bị lỗi: ${finalPath}`);
      }

      let probeCheck;
      try {
        probeCheck = await this.hypitAdapter.probeMedia(finalPath);
        if (probeCheck.duration <= 0) {
          throw new Error(`File MP4 có thời lượng không hợp lệ (${probeCheck.duration}s)`);
        }
      } catch (probeErr: any) {
        throw new Error(`File MP4 không thể phát được (ffprobe validation error): ${probeErr.message}`);
      }

      clip.status = 'completed';
      clip.progress = 100;
      clip.outputPath = finalPath;
      clip.duration = probeCheck.duration;
      clip.renderEngine = renderEngine;
      clip.enhancedPath = enhancedPath;

      // Packaging is independent of the validated MP4: an error in thumbnail
      // or metadata generation must not fail the successfully rendered MP4.
      try {
        await this.generatePublishPackage(job, clip, candidate, relevantSegs, probeCheck.duration);
      } catch (packageErr: any) {
        clip.publishStatus = 'failed';
        clip.publishWarning = `Không tạo được thumbnail HD: ${packageErr.message}`;
        clip.thumbnailPath = undefined;
        this.addLog(jobId, 'warn', `[${clipId}] ${clip.publishWarning}`, clipId);
      }

      clip.updatedAt = new Date().toISOString();
      this.addLog(
        jobId, 'info',
        `[${clipId}] Dựng thành công (engine: ${renderEngine})! File xuất: ${finalPath}${enhancedPath ? ' | HD: ' + enhancedPath : ''}`,
        clipId
      );
      this.notifyUpdate(job);
      return clip;
    } catch (err: any) {
      clip.status = 'failed';
      clip.error = err.message;
      clip.updatedAt = new Date().toISOString();
      this.addLog(jobId, 'error', `[${clipId}] Lỗi render: ${err.message}`, clipId);
      this.notifyUpdate(job);
      return clip;
    }
  }

  /**
   * Internal helper to build thumbnails, candidate frames, copy suggestions, and publish metadata.
   */
  private async generatePublishPackage(
    job: JobMetadata,
    clip: RenderedClip,
    candidate: ClipCandidate,
    relevantSegs: TranscriptSegment[],
    realDuration: number
  ): Promise<void> {
    const ffmpegPath = await this.hypitAdapter.getFfmpegPath();
    const framesDir = path.join(job.jobDir, 'outputs', `${clip.id}_thumbnail_frames`);

    // 1. Generate frame timestamps based on probed duration and edit plan moments
    const timestamps = buildFrameTimestamps(realDuration, candidate, clip.editPlan);

    // 2. Extract frame candidates using sub-second FFmpeg extraction
    const rawFrames = await extractFrameCandidates(clip.outputPath!, timestamps, framesDir, ffmpegPath);

    // 3. Score frame candidates and pick 3 distinct frames
    const moments = clip.editPlan?.moments || candidate.editPlan?.moments || [];
    const { topFrames, selectedFrame } = await scoreFrameCandidates(rawFrames, moments, ffmpegPath);

    clip.thumbnailFrames = topFrames;
    clip.selectedThumbnailFrameId = selectedFrame?.id || topFrames[0]?.id;
    clip.thumbnailLayout = { textPosition: 'top' };

    // 4. Suggest evidence-based copy
    const copy = suggestShortsCopy(candidate, relevantSegs);
    clip.publishTitle = copy.publishTitle;
    clip.publishTitleOptions = copy.publishTitleOptions;
    clip.thumbnailHook = copy.thumbnailHook;
    clip.hashtags = copy.hashtags;
    clip.publishStatus = copy.publishStatus;
    clip.publishWarning = copy.publishWarning;

    // 5. Render standalone 9:16 Shorts thumbnail PNG (2160x3840)
    const thumbPath = path.join(job.jobDir, 'outputs', `${clip.id}_thumbnail.png`);
    const frameToRender = topFrames.find(f => f.id === clip.selectedThumbnailFrameId) || topFrames[0];
    if (frameToRender && fs.existsSync(frameToRender.path)) {
      await renderShortsThumbnail(
        frameToRender.path,
        thumbPath,
        copy.thumbnailHook,
        clip.thumbnailLayout,
        ffmpegPath
      );
      clip.thumbnailPath = thumbPath;
    }

    // 6. Write <clipId>_publish.json
    const metadataPath = path.join(job.jobDir, 'outputs', `${clip.id}_publish.json`);
    writeShortsMetadata(metadataPath, {
      title: copy.publishTitle,
      titleOptions: copy.publishTitleOptions,
      thumbnailHook: copy.thumbnailHook,
      hashtags: copy.hashtags,
      selectedFrameId: clip.selectedThumbnailFrameId,
      selectedFrameTimestamp: frameToRender?.timestamp,
      layout: clip.thumbnailLayout,
      thumbnailPath: path.basename(thumbPath),
      frames: topFrames.map(f => ({
        id: f.id,
        timestamp: f.timestamp,
        path: path.relative(path.join(job.jobDir, 'outputs'), f.path),
        score: f.score,
        reason: f.reason,
      })),
      status: clip.publishStatus,
      warning: clip.publishWarning,
    });
    clip.metadataPath = metadataPath;
  }

  /**
   * Regenerate publish package (candidate frames, suggestions, PNG) from existing MP4 without re-rendering video.
   */
  async regeneratePublishPackage(
    jobId: string,
    clipId: string,
    resetSuggestions: boolean = false
  ): Promise<JobMetadata> {
    const job = this.jobs.get(jobId);
    const clip = job?.clips.find(c => c.id === clipId);
    if (!job || !clip?.outputPath || clip.status !== 'completed') {
      throw new Error('Clip chưa xuất xong hoặc không tồn tại');
    }
    if (!fs.existsSync(clip.outputPath)) {
      throw new Error(`File MP4 xuất bản không tồn tại: ${clip.outputPath}`);
    }

    const ffmpegPath = await this.hypitAdapter.getFfmpegPath();
    const probe = await this.hypitAdapter.probeMedia(clip.outputPath);
    const duration = probe.duration || clip.duration || 30;

    const candidate = job.candidates.find(c => c.id === clip.candidateId) || {
      id: clip.candidateId,
      title: clip.title,
      start: 0,
      end: duration,
      duration,
      score: 0.8,
      scoreBreakdown: { hook: 0.8, flow: 0.8, pacing: 0.8, payoff: 0.8 },
      reason: 'Candidate clip',
      transcriptExcerpt: '',
      selected: true,
      editPlan: clip.editPlan,
    } as ClipCandidate;

    const relevantSegs = job.transcript.filter(
      s => s.end >= candidate.start && s.start <= candidate.end
    );

    const framesDir = path.join(job.jobDir, 'outputs', `${clipId}_thumbnail_frames`);
    const timestamps = buildFrameTimestamps(duration, candidate, clip.editPlan);
    const rawFrames = await extractFrameCandidates(clip.outputPath, timestamps, framesDir, ffmpegPath);
    const moments = clip.editPlan?.moments || candidate.editPlan?.moments || [];
    const { topFrames, selectedFrame } = await scoreFrameCandidates(rawFrames, moments, ffmpegPath);

    clip.thumbnailFrames = topFrames;

    if (resetSuggestions || !clip.publishTitle) {
      const copy = suggestShortsCopy(candidate, relevantSegs);
      clip.publishTitle = copy.publishTitle;
      clip.publishTitleOptions = copy.publishTitleOptions;
      clip.thumbnailHook = copy.thumbnailHook;
      clip.hashtags = copy.hashtags;
      clip.publishStatus = copy.publishStatus;
      clip.publishWarning = copy.publishWarning;
      clip.thumbnailLayout = { textPosition: 'top' };
      clip.selectedThumbnailFrameId = selectedFrame?.id || topFrames[0]?.id;
    } else {
      // Preserve user edits
      clip.thumbnailLayout = clip.thumbnailLayout || { textPosition: 'top' };
      const stillValid = topFrames.find(f => f.id === clip.selectedThumbnailFrameId);
      if (!stillValid) {
        clip.selectedThumbnailFrameId = selectedFrame?.id || topFrames[0]?.id;
      }
      clip.publishStatus = 'ready';
    }

    const frameToRender = topFrames.find(f => f.id === clip.selectedThumbnailFrameId) || topFrames[0];
    if (!frameToRender || !fs.existsSync(frameToRender.path)) {
      throw new Error('Không thể trích xuất khung hình hợp lệ để tạo thumbnail');
    }

    const thumbPath = path.join(job.jobDir, 'outputs', `${clipId}_thumbnail.png`);
    const tempThumbPath = path.join(job.jobDir, 'outputs', `${clipId}_thumbnail_tmp.png`);

    try {
      await renderShortsThumbnail(
        frameToRender.path,
        tempThumbPath,
        clip.thumbnailHook || 'WATCH THIS',
        clip.thumbnailLayout || { textPosition: 'top' },
        ffmpegPath
      );
      fs.renameSync(tempThumbPath, thumbPath);
      clip.thumbnailPath = thumbPath;
      if (clip.publishStatus === 'failed') {
        clip.publishStatus = 'ready';
      }
      clip.publishWarning = undefined;
    } catch (err: any) {
      fs.rmSync(tempThumbPath, { force: true });
      clip.publishStatus = 'failed';
      clip.publishWarning = `Không tạo được thumbnail HD: ${err.message}`;
      this.notifyUpdate(job);
      throw err;
    }

    const metadataPath = path.join(job.jobDir, 'outputs', `${clipId}_publish.json`);
    writeShortsMetadata(metadataPath, {
      title: clip.publishTitle || candidate.title,
      titleOptions: clip.publishTitleOptions || [clip.publishTitle || candidate.title],
      thumbnailHook: clip.thumbnailHook || 'WATCH THIS',
      hashtags: clip.hashtags || ['#Shorts'],
      selectedFrameId: clip.selectedThumbnailFrameId,
      selectedFrameTimestamp: frameToRender.timestamp,
      layout: clip.thumbnailLayout || { textPosition: 'top' },
      thumbnailPath: path.basename(thumbPath),
      frames: topFrames.map(f => ({
        id: f.id,
        timestamp: f.timestamp,
        path: path.relative(path.join(job.jobDir, 'outputs'), f.path),
        score: f.score,
        reason: f.reason,
      })),
      status: clip.publishStatus || 'ready',
      warning: clip.publishWarning,
    });

    clip.metadataPath = metadataPath;
    clip.updatedAt = new Date().toISOString();
    this.notifyUpdate(job);
    return job;
  }

  /**
   * Save editorial overrides and redraw only the still image if frame/hook/position changed,
   * leaving the MP4 completely untouched.
   */
  async updatePublishPackage(
    jobId: string,
    clipId: string,
    updatesOrTitle: any,
    legacyHook?: string,
    legacyHashtags?: string[]
  ): Promise<JobMetadata> {
    const job = this.jobs.get(jobId);
    const clip = job?.clips.find(c => c.id === clipId);
    if (!job || !clip?.outputPath || clip.status !== 'completed') throw new Error('Clip chưa xuất xong');

    let updates: {
      title?: string;
      hook?: string;
      hashtags?: string[];
      selectedFrameId?: string;
      textPosition?: 'top' | 'middle' | 'bottom';
    };

    if (typeof updatesOrTitle === 'string') {
      updates = {
        title: updatesOrTitle,
        hook: legacyHook,
        hashtags: legacyHashtags,
      };
    } else {
      updates = updatesOrTitle || {};
    }

    const cleanTitle = (updates.title !== undefined ? updates.title : (clip.publishTitle || '')).trim().slice(0, 100);
    const cleanHook = (updates.hook !== undefined ? updates.hook : (clip.thumbnailHook || '')).trim().replace(/[\r\n]/g, ' ').slice(0, 32);
    const rawTags = updates.hashtags !== undefined ? updates.hashtags : (clip.hashtags || []);
    const cleanTags = rawTags.map(tag => tag.trim()).filter(tag => /^#[\p{L}\p{N}_]+$/u.test(tag)).slice(0, 5);
    const targetPosition = updates.textPosition || clip.thumbnailLayout?.textPosition || 'top';

    if (!cleanTitle || !cleanHook) throw new Error('Title và hook không được để trống');

    let targetFrameId = updates.selectedFrameId || clip.selectedThumbnailFrameId;
    if (updates.selectedFrameId) {
      const frameMatch = clip.thumbnailFrames?.find(f => f.id === updates.selectedFrameId);
      if (!frameMatch || !fs.existsSync(frameMatch.path)) {
        throw new Error(`Khung hình được chọn '${updates.selectedFrameId}' không hợp lệ hoặc không tồn tại`);
      }
      const expectedPrefix = path.resolve(job.jobDir, 'outputs');
      if (!path.resolve(frameMatch.path).startsWith(expectedPrefix)) {
        throw new Error('Đường dẫn ảnh không thuộc về thư mục xuất của clip này');
      }
      targetFrameId = frameMatch.id;
    }

    const frameChanged = updates.selectedFrameId !== undefined && updates.selectedFrameId !== clip.selectedThumbnailFrameId;
    const hookChanged = updates.hook !== undefined && cleanHook !== clip.thumbnailHook;
    const posChanged = updates.textPosition !== undefined && targetPosition !== clip.thumbnailLayout?.textPosition;
    const missingThumb = !clip.thumbnailPath || !fs.existsSync(clip.thumbnailPath);

    const needsRerender = frameChanged || hookChanged || posChanged || missingThumb;

    const thumbPath = path.join(job.jobDir, 'outputs', `${clipId}_thumbnail.png`);
    const tempThumbPath = path.join(job.jobDir, 'outputs', `${clipId}_thumbnail_tmp.png`);

    if (needsRerender) {
      const frameObj = clip.thumbnailFrames?.find(f => f.id === targetFrameId) || clip.thumbnailFrames?.[0];
      let sourceFramePath = frameObj?.path;

      // Handle older job without thumbnailFrames: extract on demand
      if (!sourceFramePath || !fs.existsSync(sourceFramePath)) {
        const framesDir = path.join(job.jobDir, 'outputs', `${clipId}_thumbnail_frames`);
        const ffmpegPath = await this.hypitAdapter.getFfmpegPath();
        const candidate = job.candidates.find(c => c.id === clip.candidateId) || {
          id: clip.candidateId,
          title: clip.title,
          start: 0,
          end: clip.duration || 30,
          duration: clip.duration || 30,
          score: 0.8,
          scoreBreakdown: { hook: 0.8, flow: 0.8, pacing: 0.8, payoff: 0.8 },
          reason: '',
          transcriptExcerpt: '',
          selected: true,
        } as ClipCandidate;
        const timestamps = buildFrameTimestamps(clip.duration || 30, candidate, clip.editPlan);
        const rawFrames = await extractFrameCandidates(clip.outputPath, timestamps, framesDir, ffmpegPath);
        const { topFrames, selectedFrame } = await scoreFrameCandidates(rawFrames, clip.editPlan?.moments || [], ffmpegPath);
        clip.thumbnailFrames = topFrames;
        targetFrameId = selectedFrame?.id || topFrames[0]?.id;
        sourceFramePath = selectedFrame?.path || topFrames[0]?.path;
      }

      if (!sourceFramePath || !fs.existsSync(sourceFramePath)) {
        throw new Error('Không thể tìm thấy khung hình nguồn để vẽ lại thumbnail');
      }

      try {
        await renderShortsThumbnail(
          sourceFramePath,
          tempThumbPath,
          cleanHook,
          { textPosition: targetPosition },
          await this.hypitAdapter.getFfmpegPath()
        );
        fs.renameSync(tempThumbPath, thumbPath);
        clip.thumbnailPath = thumbPath;
      } catch (err) {
        fs.rmSync(tempThumbPath, { force: true });
        throw err;
      }
    }

    clip.publishTitle = cleanTitle;
    clip.thumbnailHook = cleanHook;
    clip.hashtags = cleanTags;
    clip.selectedThumbnailFrameId = targetFrameId;
    clip.thumbnailLayout = { textPosition: targetPosition };
    clip.publishStatus = 'ready';
    clip.publishWarning = undefined;
    clip.updatedAt = new Date().toISOString();

    const metadataPath = path.join(job.jobDir, 'outputs', `${clipId}_publish.json`);
    const activeFrame = clip.thumbnailFrames?.find(f => f.id === clip.selectedThumbnailFrameId);
    writeShortsMetadata(metadataPath, {
      title: cleanTitle,
      titleOptions: clip.publishTitleOptions || [cleanTitle],
      thumbnailHook: cleanHook,
      hashtags: cleanTags,
      selectedFrameId: clip.selectedThumbnailFrameId,
      selectedFrameTimestamp: activeFrame?.timestamp,
      layout: clip.thumbnailLayout,
      thumbnailPath: path.basename(thumbPath),
      frames: (clip.thumbnailFrames || []).map(f => ({
        id: f.id,
        timestamp: f.timestamp,
        path: path.relative(path.join(job.jobDir, 'outputs'), f.path),
        score: f.score,
        reason: f.reason,
      })),
      status: clip.publishStatus,
      warning: clip.publishWarning,
    });
    clip.metadataPath = metadataPath;

    this.notifyUpdate(job);
    return job;
  }

  /**
   * Cancel rendering for a specific clip
   */
  cancelClipRender(jobId: string, clipId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const clip = job.clips.find((c) => c.id === clipId);
    if (clip && (clip.status === 'rendering' || clip.status === 'planning' || clip.status === 'queued')) {
      this.hypitAdapter.cancelRender(clipId);
      clip.status = 'canceled';
      clip.updatedAt = new Date().toISOString();
      this.addLog(jobId, 'warn', `[${clipId}] Đã hủy render clip`, clipId);
      this.notifyUpdate(job);
    }
  }

  /**
   * Delete a job and its files
   */
  deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    try {
      if (fs.existsSync(job.jobDir)) {
        fs.rmSync(job.jobDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`Could not remove job directory ${job.jobDir}:`, err);
    }

    this.jobs.delete(jobId);
    return true;
  }
}

function cleanFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, '_').substring(0, 30);
}
