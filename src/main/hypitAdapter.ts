import fs from 'fs';
import path from 'path';
import { runSpawn, CommandResult } from './util';
import {
  EnvironmentStatus,
  VideoInfo,
  JobSettings,
  ClipCandidate,
  TranscriptSegment,
} from './types';

export class HypitAdapter {
  private cachedHypitPath: string | null = null;
  private cachedFfmpegPath: string | null = null;
  private cachedFfprobePath: string | null = null;
  private activeRuns = new Map<string, () => void>();

  /**
   * Dynamically locate hypit binary without assuming fixed hardcoded paths
   */
  async getHypitPath(): Promise<string> {
    if (this.cachedHypitPath) return this.cachedHypitPath;

    // 1. Check environment variable
    if (process.env.HYPIT_PATH && fs.existsSync(process.env.HYPIT_PATH)) {
      this.cachedHypitPath = process.env.HYPIT_PATH;
      return this.cachedHypitPath;
    }

    // 2. Check system PATH via 'which hypit'
    try {
      const { promise } = runSpawn('which', ['hypit']);
      const res = await promise;
      if (res.code === 0 && res.stdout.trim()) {
        const found = res.stdout.trim().split('\n')[0];
        if (fs.existsSync(found)) {
          this.cachedHypitPath = found;
          return this.cachedHypitPath;
        }
      }
    } catch {
      // Fall through to probe known locations
    }

    // 3. Probe common locations
    const candidates = [
      '/opt/homebrew/bin/hypit',
      path.join(process.env.HOME || '', '.local/bin/hypit'),
      '/usr/local/bin/hypit',
      path.join(process.env.HOME || '', '.nvm/versions/node/v22.22.3/bin/hypit'),
    ];

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        this.cachedHypitPath = cand;
        return this.cachedHypitPath;
      }
    }

    // Default to 'hypit' and let system resolve
    return 'hypit';
  }

  /**
   * Dynamically locate ffmpeg binary
   */
  async getFfmpegPath(): Promise<string> {
    if (this.cachedFfmpegPath) return this.cachedFfmpegPath;

    try {
      const { promise } = runSpawn('which', ['ffmpeg']);
      const res = await promise;
      if (res.code === 0 && res.stdout.trim()) {
        this.cachedFfmpegPath = res.stdout.trim().split('\n')[0];
        return this.cachedFfmpegPath;
      }
    } catch {
      // Ignore
    }

    const fallbacks = [
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      path.join(process.env.HOME || '', '.nvm/versions/node/v22.22.3/lib/node_modules/ffmpeg-static/ffmpeg'),
    ];

    for (const p of fallbacks) {
      if (fs.existsSync(p)) {
        this.cachedFfmpegPath = p;
        return p;
      }
    }
    return 'ffmpeg';
  }

  /**
   * Dynamically locate ffprobe binary
   */
  async getFfprobePath(): Promise<string> {
    if (this.cachedFfprobePath) return this.cachedFfprobePath;

    try {
      const { promise } = runSpawn('which', ['ffprobe']);
      const res = await promise;
      if (res.code === 0 && res.stdout.trim()) {
        this.cachedFfprobePath = res.stdout.trim().split('\n')[0];
        return this.cachedFfprobePath;
      }
    } catch {
      // Ignore
    }

    const fallbacks = [
      '/opt/homebrew/bin/ffprobe',
      '/usr/local/bin/ffprobe',
      path.join(process.env.HOME || '', '.nvm/versions/node/v22.22.3/lib/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe'),
    ];

    for (const p of fallbacks) {
      if (fs.existsSync(p)) {
        this.cachedFfprobePath = p;
        return p;
      }
    }
    return 'ffprobe';
  }

  /**
   * Comprehensive environment diagnosis
   */
  async checkEnvironment(): Promise<EnvironmentStatus> {
    const hypitPath = await this.getHypitPath();
    const ffmpegPath = await this.getFfmpegPath();
    const ffprobePath = await this.getFfprobePath();

    let nodeVersion = process.version;
    let hypitVersion = 'Not Installed';
    let hypitOk = false;
    let ffmpegOk = false;
    let ffmpegVersion = 'Not Installed';
    let ffprobeOk = false;
    let details = '';

    // Check Hypit
    try {
      const { promise } = runSpawn(hypitPath, ['version', '--check']);
      const res = await promise;
      if (res.code === 0) {
        hypitOk = true;
        const firstLine = res.stdout.trim().split('\n')[0] || '';
        hypitVersion = firstLine;
      } else {
        details += `Hypit check returned exit code ${res.code}: ${res.stderr}\n`;
      }
    } catch (err: any) {
      details += `Failed to execute hypit (${hypitPath}): ${err.message}\n`;
    }

    // Check FFmpeg
    try {
      const { promise } = runSpawn(ffmpegPath, ['-version']);
      const res = await promise;
      if (res.code === 0) {
        ffmpegOk = true;
        const line = res.stdout.split('\n')[0] || '';
        ffmpegVersion = line.replace('ffmpeg version ', '').split(' ')[0];
      }
    } catch (err: any) {
      details += `Failed to execute ffmpeg (${ffmpegPath}): ${err.message}\n`;
    }

    // Check FFprobe
    try {
      const { promise } = runSpawn(ffprobePath, ['-version']);
      const res = await promise;
      if (res.code === 0) {
        ffprobeOk = true;
      }
    } catch {
      // Ignore
    }

    return {
      nodeVersion,
      hypitVersion,
      hypitOk,
      hypitPath,
      ffmpegOk,
      ffmpegVersion,
      ffprobeOk,
      runtimeReady: hypitOk && ffmpegOk,
      details,
    };
  }

  /**
   * Probe media duration, size, fps and audio using hypit media probe or ffprobe
   */
  async probeMedia(videoPath: string): Promise<VideoInfo> {
    const hypitPath = await this.getHypitPath();

    try {
      const { promise } = runSpawn(hypitPath, ['media', 'probe', videoPath, '--json']);
      const res = await promise;
      if (res.code === 0 && res.stdout.trim()) {
        const data = JSON.parse(res.stdout.trim());
        return {
          duration: Number(data.duration) || 0,
          width: Number(data.width) || 1920,
          height: Number(data.height) || 1080,
          fps: Number(data.frameRate) || 30,
          hasAudio: Boolean(data.hasAudio),
        };
      }
    } catch (err) {
      console.warn('hypit media probe failed, trying ffprobe:', err);
    }

    // Fallback to ffprobe
    const ffprobePath = await this.getFfprobePath();
    const { promise } = runSpawn(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ]);
    const res = await promise;
    if (res.code !== 0) {
      throw new Error(`Cannot probe video: ${res.stderr}`);
    }

    const data = JSON.parse(res.stdout);
    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');

    let fps = 30;
    if (videoStream?.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split('/');
      if (parts.length === 2 && Number(parts[1]) > 0) {
        fps = Math.round(Number(parts[0]) / Number(parts[1]));
      }
    }

    return {
      duration: parseFloat(data.format?.duration || '0'),
      width: videoStream?.width || 1920,
      height: videoStream?.height || 1080,
      fps,
      hasAudio: Boolean(audioStream),
    };
  }

  /**
   * Extract video frame thumbnails at given timestamps
   */
  async extractThumbnails(
    videoPath: string,
    timestamps: number[],
    outputDir: string
  ): Promise<string[]> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const hypitPath = await this.getHypitPath();
    const generatedPaths: string[] = [];

    // Format timestamps as comma-separated seconds
    const atArg = timestamps.map((t) => Math.max(0, Math.round(t))).join(',');

    try {
      // Use unique subfolder for hypit media frames (it refuses to overwrite existing dirs)
      const framesDir = path.join(outputDir, `frames_${Date.now()}`);
      const { promise } = runSpawn(hypitPath, [
        'media', 'frames', videoPath,
        '--at', atArg,
        '--to', framesDir,
        '--json'
      ]);
      const res = await promise;
      if (res.code === 0 && res.stdout.trim()) {
        const data = JSON.parse(res.stdout.trim());
        if (data.frames && Array.isArray(data.frames)) {
          for (const f of data.frames) {
            if (f.path && fs.existsSync(f.path)) {
              generatedPaths.push(f.path);
            }
          }
          return generatedPaths;
        }
      }
    } catch (err) {
      console.warn('Hypit media frames error, falling back to ffmpeg thumbnailing:', err);
    }

    // Fallback using ffmpeg
    const ffmpegPath = await this.getFfmpegPath();
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      const outPath = path.join(outputDir, `thumb_${i}_${Math.round(t)}s.jpg`);
      const { promise } = runSpawn(ffmpegPath, [
        '-ss', t.toFixed(2),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        outPath,
        '-y'
      ]);
      await promise;
      if (fs.existsSync(outPath)) {
        generatedPaths.push(outPath);
      }
    }

    return generatedPaths;
  }

  /**
   * Cut video subsegment using Hypit media cut
   */
  async cutSegment(
    videoPath: string,
    start: number,
    end: number,
    outputPath: string
  ): Promise<string> {
    const hypitPath = await this.getHypitPath();

    // Remove old target if exists because hypit refuses to overwrite
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    try {
      const { promise } = runSpawn(hypitPath, [
        'media', 'cut', videoPath,
        '--start', start.toFixed(2),
        '--end', end.toFixed(2),
        '--to', outputPath,
        '--json'
      ]);
      const res = await promise;
      if (res.code === 0 && fs.existsSync(outputPath)) {
        return outputPath;
      }
    } catch (err) {
      console.warn('Hypit media cut failed, falling back to ffmpeg:', err);
    }

    // Fallback: fast precise cut with ffmpeg
    const ffmpegPath = await this.getFfmpegPath();
    const duration = end - start;
    const { promise } = runSpawn(ffmpegPath, [
      '-ss', start.toFixed(2),
      '-i', videoPath,
      '-t', duration.toFixed(2),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
      '-y'
    ]);
    const res = await promise;
    if (res.code !== 0 || !fs.existsSync(outputPath)) {
      throw new Error(`Failed to cut segment: ${res.stderr}`);
    }
    return outputPath;
  }

  /**
   * Generate durable Hypit project files (.svml, .svrun, .svs, hypit.runtime.json)
   */
  generateProject(
    projectDir: string,
    candidate: ClipCandidate,
    settings: JobSettings,
    cutVideoPath: string,
    relevantSegments: TranscriptSegment[]
  ): { svmlPath: string; svrunPath: string; runtimePath: string } {
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const isVertical = settings.aspectRatio === '9:16';
    const canvasWidth = isVertical ? 1080 : 1920;
    const canvasHeight = isVertical ? 1920 : 1080;
    const durationSec = Math.round(candidate.duration);

    // 1. Create pure local hypit.runtime.json
    const runtimeConfig = {
      format: 'hypit.runtime-local@1',
      dataRoot: '.hypit/runtimes/local',
      endpoints: {
        'media.local': {
          use: '@hypit/provider-media-local',
          config: { defaultConcurrency: 2 },
        },
        'hyperframes.local': {
          use: '@hypit/provider-hyperframes-local',
          config: { workers: 2, defaultConcurrency: 1 },
        },
      },
    };
    const runtimePath = path.join(projectDir, 'hypit.runtime.json');
    fs.writeFileSync(runtimePath, JSON.stringify(runtimeConfig, null, 2), 'utf8');

    // Setup .hypit/runtime pointer
    const hypitConfigDir = path.join(projectDir, '.hypit');
    if (!fs.existsSync(hypitConfigDir)) {
      fs.mkdirSync(hypitConfigDir, { recursive: true });
    }
    fs.writeFileSync(path.join(hypitConfigDir, 'runtime'), 'hypit.runtime.json', 'utf8');

    // 2. Create recipes.svs styling sheet
    const preset = settings.preset;
    const isReaction = preset === 'reaction';

    const svsContent = `<?svml using="@hypit/svs@1"?>
<sheet version="1">
  film.canvas { 
    background: ${isReaction ? '#0F0F14' : '#05070A'}; 
  }
  media.video_layer { 
    stack-order: 10; 
    fit: cover; 
    clip: frame; 
  }
  media.overlay_card { 
    stack-order: 30; 
    fit: contain; 
    clip: rounded; 
    radius: ${isReaction ? 16 : 8}; 
    padding: "16 24"; 
    frame-paint: ${isReaction ? '#FFDF00' : '#1E2530EE'}; 
    border-width: 2; 
    border-color: ${isReaction ? '#000000' : '#334155'}; 
  }
</sheet>
`;
    const svsPath = path.join(projectDir, 'recipes.svs');
    fs.writeFileSync(svsPath, svsContent, 'utf8');

    // 3. Create clip.svml authoring file
    // Relative path to cut video from projectDir
    const relVideoPath = path.relative(projectDir, cutVideoPath).replace(/\\/g, '/');

    const svmlContent = `<?svml using="@hypit/markup@1"?>
<svml>
  <import from="@hypit/script@1"/>
  <import as="media" from="@hypit/media@1"/>
  <import as="pipeline" from="@hypit/media-pipeline@1"/>
  <import as="time" from="@hypit/timeline-author@1"/>
  <import as="whisperx" from="@hypit/whisperx@1"/>
  <import as="media-track" from="@hypit/media-track@1"/>
  <import as="space" from="@hypit/spatial@1"/>
  <import as="program" from="@hypit/program-space@1"/>
  <import as="film" from="@hypit/film@1"/>
  <import as="render" from="@hypit/render-hyperframes@1"/>
  <import as="recipes" source="./recipes.svs"/>

  <script id="story">
    <scene><HOST>${escapeXml(candidate.title)}</HOST></scene>
  </script>

  <space:Canvas id="viewport" width="${canvasWidth}" height="${canvasHeight}"/>
  <program:Clock id="clock" frame-rate="30"/>
  <space:Frame id="main-frame" within={viewport} left="0%" top="0%" right="100%" bottom="100%"/>

  <!-- Source Video Segment -->
  <media:Video id="source-clip" src="${relVideoPath}"/>
  <pipeline:Normalize id="clip-media" source={source-clip} clock={clock} video="primary-moving" audio="primary-sync" span-authority="video"/>
  
  <whisperx:SemanticTake id="clip-take" narrative={story} segment={story.segment.scene} media={clip-media.media}/>
  
  <time:Timeline id="timeline" clock={clock} end="${durationSec}s">
    <time:Take source={clip-take.take}/>
  </time:Timeline>

  <media-track:Track id="visual-track" timeline={timeline.timeline} canvas={viewport}>
    <media-track:Item id="video-item" media={clip-media.media} frame={main-frame} during="program" appearance={recipes.media.video_layer}/>
  </media-track:Track>

  <film:Film id="main-film" canvas={viewport} timeline={timeline.timeline} appearance={recipes.film.canvas}>
    <film:Track source={visual-track.visual}/>
  </film:Film>

  <render:Video id="final" composition={main-film.composition} timeline={timeline.timeline}/>
</svml>
`;
    const svmlPath = path.join(projectDir, 'clip.svml');
    fs.writeFileSync(svmlPath, svmlContent, 'utf8');

    // 4. Create build.svrun
    const svrunContent = `<?svml using="@hypit/run-markup@1"?>
<svrun version="1">
  <author source="./clip.svml"/>
  <target output="final.video"/>
</svrun>
`;
    const svrunPath = path.join(projectDir, 'build.svrun');
    fs.writeFileSync(svrunPath, svrunContent, 'utf8');

    return { svmlPath, svrunPath, runtimePath };
  }

  /**
   * Render clip by running Hypit build & get, with automatic fallback
   * to high-fidelity FFmpeg crop/reframe/caption pipeline when needed.
   */
  async renderClip(
    clipId: string,
    projectDir: string,
    candidate: ClipCandidate,
    settings: JobSettings,
    sourceVideoPath: string,
    outputPath: string,
    relevantSegments: TranscriptSegment[],
    onProgress: (percent: number, phase: string) => void,
    onLog: (msg: string) => void
  ): Promise<string> {
    const hypitPath = await this.getHypitPath();
    const ffmpegPath = await this.getFfmpegPath();

    onProgress(5, 'Chuẩn bị dữ liệu và cắt A-roll segment');
    onLog(`[${clipId}] Bắt đầu quy trình dựng clip: ${candidate.title}`);

    // Ensure output directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // 1. Cut the source clip segment
    const cutSubclipPath = path.join(projectDir, `aroll_cut_${clipId}.mp4`);
    onLog(`[${clipId}] Trích xuất A-roll từ ${candidate.start}s đến ${candidate.end}s...`);
    await this.cutSegment(sourceVideoPath, candidate.start, candidate.end, cutSubclipPath);

    // 2. Generate Hypit project
    onProgress(20, 'Tạo dự án Hypit (SVML, SVRUN, SVS)');
    onLog(`[${clipId}] Khởi tạo cấu hình Hypit project tại ${projectDir}`);
    const { svrunPath } = this.generateProject(
      projectDir,
      candidate,
      settings,
      cutSubclipPath,
      relevantSegments
    );

    let hypitSuccess = false;
    let hypitBuildId: string | null = null;

    // 3. Attempt Hypit Build
    try {
      onProgress(35, 'Thực thi kiểm tra Hypit build plan');
      onLog(`[${clipId}] Chạy hypit plan...`);
      const planRes = await runSpawn(hypitPath, [
        'plan', 'build.svrun',
        '--workspace', projectDir,
        '--json'
      ]).promise;

      if (planRes.code === 0) {
        onProgress(45, 'Chạy Hypit build engine');
        onLog(`[${clipId}] Chạy hypit build --follow...`);

        const buildSpawn = runSpawn(hypitPath, [
          'build', 'build.svrun',
          '--workspace', projectDir,
          '--follow',
          '--json'
        ], {
          onStdout: (chunk) => {
            onLog(`[Hypit] ${chunk.trim()}`);
          }
        });

        this.activeRuns.set(clipId, buildSpawn.cancel);
        const buildRes = await buildSpawn.promise;
        this.activeRuns.delete(clipId);

        if (buildRes.code === 0 && buildRes.stdout) {
          try {
            const data = JSON.parse(buildRes.stdout.trim());
            hypitBuildId = data.build?.id;
            if (hypitBuildId && data.build?.result?.state === 'complete') {
              onProgress(80, 'Export video từ Hypit Build Result');
              onLog(`[${clipId}] Xuất output với hypit get ${hypitBuildId}...`);

              if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
              }

              const getRes = await runSpawn(hypitPath, [
                'get', hypitBuildId,
                '--output', 'final.video',
                '--to', outputPath,
                '--workspace', projectDir,
                '--json'
              ]).promise;

              if (getRes.code === 0 && fs.existsSync(outputPath)) {
                hypitSuccess = true;
                onLog(`[${clipId}] Hypit build thành công tuyệt đối!`);
              }
            }
          } catch (parseErr) {
            onLog(`[Hypit] Build parse error: ${parseErr}`);
          }
        }
      }
    } catch (err: any) {
      onLog(`[Hypit notice] Hypit run step error: ${err.message}`);
    }

    // 4. Fallback / Post-processing Pipeline:
    // If Hypit encountered an environmental missing package or if video styling
    // (exact 9:16 safe-crop, burned-in styled captions, audio ducking) is required,
    // apply local FFmpeg rendering pipeline to guarantee 100% playable output MP4!
    if (!hypitSuccess || settings.captions || settings.aspectRatio === '9:16') {
      onProgress(65, 'Áp dụng bộ lọc dựng chuẩn (Reframe 9:16, Subtitle, Audio ducking)');
      onLog(`[Renderer] Tinh chỉnh frame và đóng gói MP4 hoàn chỉnh...`);

      const tempRenderPath = path.join(projectDir, `render_processed_${clipId}.mp4`);
      if (fs.existsSync(tempRenderPath)) {
        fs.unlinkSync(tempRenderPath);
      }

      // Input video to process (either Hypit rendered or cut subclip)
      const inputToProcess = hypitSuccess && fs.existsSync(outputPath) ? outputPath : cutSubclipPath;

      // Build video filters for aspect ratio reframe
      const vfFilters: string[] = [];
      if (settings.aspectRatio === '9:16') {
        // Safe center crop to 9:16 (1080x1920) with smooth scaling
        vfFilters.push('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
      } else {
        vfFilters.push('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2');
      }

      // Add captions if enabled and transcript exists
      if (settings.captions && relevantSegments.length > 0) {
        // Generate ASS subtitle file for rich styled captions
        const assPath = path.join(projectDir, `captions_${clipId}.ass`);
        generateAssSubtitles(assPath, relevantSegments, candidate.start, settings.preset);
        vfFilters.push(`subtitles=${assPath.replace(/:/g, '\\:')}`);
      }

      const ffmpegArgs = [
        '-i', inputToProcess,
        '-vf', vfFilters.join(','),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '19',
        '-c:a', 'aac',
        '-b:a', '192k',
        tempRenderPath,
        '-y'
      ];

      const renderSpawn = runSpawn(ffmpegPath, ffmpegArgs, {
        onStderr: (data) => {
          if (data.includes('time=')) {
            onProgress(85, 'Đang ghi dữ liệu video MP4...');
          }
        }
      });

      this.activeRuns.set(clipId, renderSpawn.cancel);
      const renderRes = await renderSpawn.promise;
      this.activeRuns.delete(clipId);

      if (renderRes.code === 0 && fs.existsSync(tempRenderPath)) {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        fs.renameSync(tempRenderPath, outputPath);
        onLog(`[${clipId}] Dựng clip hoàn tất: ${outputPath}`);
      } else {
        // If ASS subtitles filter failed (e.g. libass missing in some builds), fallback to direct cut
        if (!fs.existsSync(outputPath) && fs.existsSync(cutSubclipPath)) {
          fs.copyFileSync(cutSubclipPath, outputPath);
          onLog(`[${clipId}] Đã xuất clip video sạch.`);
        }
      }
    }

    onProgress(100, 'Hoàn thành dựng clip');
    return outputPath;
  }

  /**
   * Cancel an ongoing render
   */
  cancelRender(clipId: string): void {
    const cancelFn = this.activeRuns.get(clipId);
    if (cancelFn) {
      cancelFn();
      this.activeRuns.delete(clipId);
    }
  }
}

/**
 * Generate Advanced SubStation Alpha (.ass) subtitles with styles
 */
function generateAssSubtitles(
  assPath: string,
  segments: TranscriptSegment[],
  clipStartTime: number,
  preset: string
): void {
  const isReaction = preset === 'reaction';
  const primaryColor = isReaction ? '&H0000FFFF' : '&H00FFFFFF'; // Yellow vs Clean White
  const outlineColor = '&H00000000'; // Black outline

  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,${primaryColor},&H000000FF,${outlineColor},&H80000000,1,0,0,0,100,100,0,0,1,4,2,2,40,40,240,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];

  for (const seg of segments) {
    const relStart = Math.max(0, seg.start - clipStartTime);
    const relEnd = Math.max(relStart + 0.5, seg.end - clipStartTime);

    const startStr = formatAssTime(relStart);
    const endStr = formatAssTime(relEnd);
    const cleanText = seg.text.replace(/[\r\n]+/g, ' ').trim();

    events.push(`Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${cleanText}`);
  }

  fs.writeFileSync(assPath, assHeader + events.join('\n') + '\n', 'utf8');
}

function formatAssTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
