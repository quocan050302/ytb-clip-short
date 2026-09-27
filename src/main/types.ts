// ─── Core Media Info ─────────────────────────────────────────────────────────

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export type AspectRatio = '9:16' | '16:9';
export type VideoPreset = 'reaction' | 'documentary';

export type EnhanceMode = 'none' | 'smart-crop-hd' | 'blur-bg-preserve' | 'ai-upscale-local';

export interface EnhanceSettings {
  mode: EnhanceMode;
  targetResolution: '1080p' | '1440p' | '2160p';
  /** smart-crop-hd: use face-detection to center crop */
  faceAware: boolean;
  /** blur-bg-preserve: gaussian radius 0–80 */
  blurRadius: number;
  /** ai-upscale-local: scale factor 2 or 4 */
  upscaleFactor: 2 | 4;
  /** apply sharpening after upscale */
  sharpen: boolean;
}

export interface JobSettings {
  targetClipCount: number;
  clipDurationMin: number;
  clipDurationMax: number;
  aspectRatio: AspectRatio;
  preset: VideoPreset;
  captions: boolean;
  bgm: boolean;
  sfx: boolean;
  broll: boolean;
  mode: 'local' | 'cloud';
  /** Word-level captions from SRT/WhisperX (disabled if no word timing) */
  wordLevelCaptions: boolean;
  /** Callout text / lower-third captions enabled */
  callouts: boolean;
  /** Visual effects overlay (zoom punch, shake, flash) enabled */
  visualEffects: boolean;
  /** HD post-render enhance enabled */
  hdEnhance?: boolean;
  /** Mode for HD enhancement */
  enhanceMode?: 'smart-crop-hd' | 'blur-bg-preserve' | 'ai-upscale-local';
  enhance?: EnhanceSettings;
}

// ─── Transcript & Word Timing ─────────────────────────────────────────────────

export interface WordTiming {
  word: string;
  start: number; // seconds relative to source video
  end: number;
  confidence: number; // 0.0 – 1.0
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: WordTiming[]; // populated when SRT has word-level or WhisperX is used
  /** Flag indicating placeholder text generated from silence (e.g. "[Đoạn nói 1]") */
  isPlaceholder?: boolean;
}

// ─── Scores ───────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  hook: number;   // 0-100
  pacing: number; // 0-100
  payoff: number; // 0-100
}

// ─── Moments / Beats ─────────────────────────────────────────────────────────

export type BeatType = 'hook' | 'reveal' | 'surprise' | 'fail' | 'punchline' | 'pause';

/**
 * MomentType: richer classification used by MomentPlanner
 * Extends BeatType with more granular categories
 */
export type MomentType =
  | 'hook'          // strong opener / first 3-5s attention grab
  | 'reveal'        // information reveal moment
  | 'surprise'      // unexpected turn
  | 'fail'          // failure / blooper
  | 'punchline'     // joke payoff
  | 'pause'         // dramatic pause before key info
  | 'reaction'      // speaker reaction (laugh, gasp)
  | 'emphasis'      // stressed word or repeated phrase
  | 'transition';   // natural scene/topic change

export interface MomentEvent {
  id: string;
  momentType: MomentType;
  /** seconds relative to clip start */
  timestamp: number;
  /** How long this moment lasts (seconds) */
  duration: number;
  /** 0.0 – 1.0 */
  confidence: number;
  reason: string;
  /** Trigger word/phrase if speech-derived */
  triggerWord?: string;
  /** Energy score derived from audio analysis 0–1 */
  energyScore?: number;
}

// ─── Asset Items ──────────────────────────────────────────────────────────────

export interface AssetItem {
  id: string;
  name: string;
  type: 'meme' | 'sfx' | 'music';
  filePath: string;
  sourceUrl: string;
  author?: string;
  license: string;
  fetchedAt: string;
  fingerprint: string;
  mood?: string;
  tags: string[];
}

// ─── Legacy Beat / Asset Plan (kept for backward compat) ─────────────────────

export interface BeatEvent {
  id: string;
  beatType: BeatType;
  timestamp: number;    // seconds relative to clip start
  duration: number;     // overlay display duration in seconds
  sfx: AssetItem;       // paired SFX
  meme: AssetItem;      // paired Meme
  confidence: number;   // 0.0 - 1.0
  reason: string;
}

export interface DuckingSettings {
  normalVolume: number;
  duckedVolume: number;
  fadeInDuration: number;
  fadeOutDuration: number;
}

export interface ClipAssetPlan {
  clipId: string;
  musicTrack: AssetItem | null;
  beats: BeatEvent[];
  duckingSettings: DuckingSettings;
}

// ─── Advanced Edit Plan ───────────────────────────────────────────────────────

/** Text overlay for a specific time window (captions, callouts, lower-thirds) */
export interface TextOverlayPlan {
  id: string;
  text: string;
  /** seconds relative to clip start */
  start: number;
  end: number;
  style: 'caption' | 'callout' | 'lower-third' | 'word-highlight';
  /** Hex color string */
  color: string;
  /** Font size in points */
  fontSize: number;
  /** Position within canvas 0.0–1.0 */
  xNorm: number;
  yNorm: number;
  animation: 'none' | 'fade' | 'slide-up' | 'bounce' | 'pop';
}

/** Visual overlay: meme image, b-roll clip, emoji etc */
export interface VisualOverlayPlan {
  id: string;
  type: 'meme-image' | 'broll-clip' | 'emoji' | 'sticker';
  assetPath: string;
  /** seconds relative to clip start */
  start: number;
  end: number;
  xNorm: number;
  yNorm: number;
  widthNorm: number;
  heightNorm: number;
  opacity: number;
  /** linked moment id for sync */
  momentId?: string;
}

/** Video/filter effect applied during a time window */
export interface EffectPlan {
  id: string;
  effect: 'zoom-punch' | 'shake' | 'flash' | 'color-grade' | 'slow-mo' | 'speed-ramp' | 'vignette';
  start: number;
  end: number;
  /** Intensity 0.0–1.0 */
  intensity: number;
  momentId?: string;
}

/** Single audio event: SFX, stinger, voice effect */
export interface AudioEventPlan {
  id: string;
  type: 'sfx' | 'stinger' | 'voice-effect';
  assetPath: string;
  /** When to fire (seconds relative to clip start) */
  triggerAt: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  momentId?: string;
}

/**
 * ClipEditPlan: unified plan driving the render engine.
 * Consolidates all overlays, effects and audio events for one clip.
 */
export interface ClipEditPlan {
  clipId: string;
  /** Moments identified in this clip */
  moments: MomentEvent[];
  /** Text overlays: captions, callouts, lower-thirds */
  textOverlays: TextOverlayPlan[];
  /** Visual overlays: memes, b-roll, stickers */
  visualOverlays: VisualOverlayPlan[];
  /** Filter effects on A-roll */
  effects: EffectPlan[];
  /** SFX / stinger audio events */
  audioEvents: AudioEventPlan[];
  /** Background music track */
  musicTrack: AssetItem | null;
  duckingSettings: DuckingSettings;
  /** Legacy asset plan preserved for backward compat */
  legacyAssetPlan?: ClipAssetPlan;
  enhance: EnhanceSettings;
  /** true = word-level captions available */
  hasWordTiming: boolean;
  /** UI warnings (e.g. "No SRT – word captions disabled") */
  warnings: string[];
}

// ─── Clip Candidate & Rendered ────────────────────────────────────────────────

export interface ClipCandidate {
  id: string;
  title: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reason: string;
  transcriptExcerpt: string;
  thumbnailPath?: string;
  selected: boolean;
  assetPlan?: ClipAssetPlan;
  /** Unified edit plan (supersedes assetPlan when present) */
  editPlan?: ClipEditPlan;
}

export type ClipRenderStatus =
  | 'queued'
  | 'analyzing'
  | 'planning'
  | 'rendering'
  | 'enhancing'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface ThumbnailFrame {
  id: string;
  timestamp: number;
  path: string;
  score: number;
  reason: string;
}

export interface ThumbnailLayout {
  textPosition: 'top' | 'middle' | 'bottom';
}

export type PublishStatus = 'pending' | 'generating' | 'ready' | 'needs_review' | 'failed';

export interface RenderedClip {
  id: string;
  candidateId: string;
  title: string;
  status: ClipRenderStatus;
  progress: number;
  outputPath?: string;
  /** Upload package generated independently of the MP4. */
  thumbnailPath?: string;
  publishTitle?: string;
  thumbnailHook?: string;
  hashtags?: string[];
  metadataPath?: string;
  publishWarning?: string;
  thumbnailFrames?: ThumbnailFrame[];
  selectedThumbnailFrameId?: string;
  thumbnailLayout?: ThumbnailLayout;
  publishTitleOptions?: string[];
  publishStatus?: PublishStatus;
  hypitBuildId?: string;
  error?: string;
  duration?: number;
  updatedAt: string;
  assetPlan?: ClipAssetPlan;
  editPlan?: ClipEditPlan;
  /** Which engine produced the final file */
  renderEngine?: 'hypit' | 'ffmpeg-fallback';
  /** Path to enhanced output (post HD enhancer) */
  enhancedPath?: string;
  /** True if HD enhancement was requested but failed (fell back to normal render) */
  hdEnhanceFailed?: boolean;
}

// ─── Logs / Job ───────────────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  clipId?: string;
}

export type JobStatus =
  | 'idle'
  | 'analyzing'
  | 'candidates_ready'
  | 'rendering'
  | 'completed'
  | 'error';

export interface JobMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceVideoPath: string;
  videoInfo: VideoInfo;
  settings: JobSettings;
  status: JobStatus;
  transcript: TranscriptSegment[];
  candidates: ClipCandidate[];
  clips: RenderedClip[];
  logs: LogEntry[];
  jobDir: string;
}

// ─── Environment ──────────────────────────────────────────────────────────────

export interface EnvironmentStatus {
  nodeVersion: string;
  hypitVersion: string;
  hypitOk: boolean;
  hypitPath: string;
  ffmpegOk: boolean;
  ffmpegVersion: string;
  ffprobeOk: boolean;
  runtimeReady: boolean;
  details: string;
}
