import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  ClipAssetPlan,
  ClipCandidate,
  JobMetadata,
  JobSettings,
  LogEntry,
  RenderedClip,
  TranscriptSegment,
  VideoInfo,
} from './types';
import { HypitAdapter } from './hypitAdapter';
import { VideoAnalyzer } from './videoAnalyzer';
import { AutoAssetPlanner } from './autoAssetPlanner';

export class JobManager {
  private baseJobsDir: string;
  private jobs: Map<string, JobMetadata> = new Map();
  private hypitAdapter: HypitAdapter;
  private videoAnalyzer: VideoAnalyzer;
  private autoAssetPlanner: AutoAssetPlanner;
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

      // 2. Handle transcript
      let segments: TranscriptSegment[] = [];
      if (srtContent && srtContent.trim()) {
        this.addLog(jobId, 'info', 'Đọc nội dung file phụ đề SRT được cung cấp...');
        segments = this.videoAnalyzer.parseSrt(srtContent);
        // Save SRT
        fs.writeFileSync(path.join(job.jobDir, 'transcript', 'subtitles.srt'), srtContent, 'utf8');
      } else {
        this.addLog(jobId, 'info', 'Không có SRT tải lên: tự động sinh mốc phân đoạn theo nhịp nói và khoảng lặng cục bộ...');
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

      // 3. Generate candidate clips
      this.addLog(jobId, 'info', `Bắt đầu tính điểm Hook, Pacing, Payoff và tạo các đoạn clip đề xuất (${job.settings.targetClipCount} clips)...`);
      let candidates = this.videoAnalyzer.generateCandidates(
        segments,
        silences,
        job.videoInfo.duration,
        job.settings
      );

      // 4. Auto Asset Planning for all candidates (Hook/Surprise/Reveal/Fail/Punchline + Meme & SFX sync + Ducking BGM)
      this.addLog(jobId, 'info', 'Khởi chạy Auto Asset Planner: quét nhịp (hook/surprise/reveal/fail/punchline) & tự động đồng bộ Meme + SFX + BGM Ducking...');
      candidates = this.autoAssetPlanner.planAll(
        candidates,
        job.settings,
        segments,
        silences
      );

      // 5. Extract thumbnails for each candidate
      this.addLog(jobId, 'info', 'Trích xuất thumbnail khung hình cho các đoạn đề xuất...');
      const timestamps = candidates.map((c) => c.start + Math.min(2, c.duration / 2));
      const thumbsDir = path.join(job.jobDir, 'candidates', 'thumbnails');
      const thumbPaths = await this.hypitAdapter.extractThumbnails(
        job.sourceVideoPath,
        timestamps,
        thumbsDir
      );

      for (let i = 0; i < candidates.length; i++) {
        if (thumbPaths[i]) {
          candidates[i].thumbnailPath = thumbPaths[i];
        }
      }

      job.candidates = candidates;
      fs.writeFileSync(
        path.join(job.jobDir, 'candidates', 'candidates.json'),
        JSON.stringify(candidates, null, 2),
        'utf8'
      );

      job.status = 'candidates_ready';
      this.addLog(jobId, 'info', `Đã tìm thấy ${candidates.length} đoạn shorts tiềm năng và hoàn tất Auto Asset Plan! Sẵn sàng duyệt.`);
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
      cand.assetPlan = assetPlan;
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

      const finalPath = await this.hypitAdapter.renderClip(
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

      clip.status = 'completed';
      clip.progress = 100;
      clip.outputPath = finalPath;
      clip.updatedAt = new Date().toISOString();
      this.addLog(jobId, 'info', `[${clipId}] Dựng thành công! File xuất: ${finalPath}`, clipId);
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
