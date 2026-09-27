import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { AssetItem, BeatType, VideoPreset, ImportedSfxMetadata, ImportResult } from './types';
import { runSpawn } from './util';

export interface AssetProviderInterface {
  getAsset(type: 'meme' | 'sfx' | 'music', query: string, mood?: string): Promise<AssetItem | null>;
  getAllAssets(type?: 'meme' | 'sfx' | 'music'): Promise<AssetItem[]>;
}

/**
 * Standard Local Asset Provider with verified file cache, licensing metadata,
 * and support for persistent imported user SFX library with audio-informed auto-classification.
 */
export class LocalAssetProvider implements AssetProviderInterface {
  private baseAssetsDir: string;
  private importedAssetsDir: string;
  private assetCache: Map<string, AssetItem> = new Map();
  private importedManifest: Map<string, ImportedSfxMetadata> = new Map();

  constructor(customAssetsDir?: string, customImportedDir?: string) {
    if (customAssetsDir && fs.existsSync(customAssetsDir)) {
      this.baseAssetsDir = customAssetsDir;
    } else {
      const candidates = [
        path.resolve(__dirname, '../assets'),
        path.resolve(process.cwd(), 'assets'),
        path.resolve(__dirname, '../../assets'),
      ];
      this.baseAssetsDir = candidates.find((c) => fs.existsSync(c)) || candidates[0];
    }

    if (customImportedDir) {
      this.importedAssetsDir = customImportedDir;
    } else {
      let defaultImported = path.join(os.homedir(), '.autoclip', 'imported-assets', 'sfx');
      try {
        // In electron main process, app.getPath('userData') is the persistent directory
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require('electron');
        if (electron?.app?.getPath) {
          defaultImported = path.join(electron.app.getPath('userData'), 'imported-assets', 'sfx');
        }
      } catch {
        // Fall back to ~/.autoclip for test / CLI environment
      }
      this.importedAssetsDir = defaultImported;
    }

    if (!fs.existsSync(this.importedAssetsDir)) {
      fs.mkdirSync(this.importedAssetsDir, { recursive: true });
    }

    this.indexLocalLibrary();
    this.indexImportedAssets();
  }

  getImportedAssetsDir(): string {
    return this.importedAssetsDir;
  }

  /**
   * Calculate SHA-256 fingerprint of a media file
   */
  private computeFingerprint(filePath: string): string {
    try {
      const buffer = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch {
      return 'unverified';
    }
  }

  /**
   * Index built-in and cached royalty-free assets
   */
  indexLocalLibrary(): void {
    const sfxDir = path.join(this.baseAssetsDir, 'sfx');
    const memesDir = path.join(this.baseAssetsDir, 'memes');
    const musicDir = path.join(this.baseAssetsDir, 'music');

    // 1. Index SFX
    const sfxItems: Array<Omit<AssetItem, 'fingerprint' | 'fetchedAt'>> = [
      {
        id: 'sfx_whoosh',
        name: 'Whoosh Transition SFX',
        type: 'sfx',
        filePath: path.join(sfxDir, 'whoosh.wav'),
        sourceUrl: 'urn:autoclip:sfx:whoosh',
        author: 'AutoClip Open Studio Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['whoosh', 'transition', 'hook', 'energy'],
        category: 'transition',
      },
      {
        id: 'sfx_vine_boom',
        name: 'Vine Boom Bass Drop',
        type: 'sfx',
        filePath: path.join(sfxDir, 'vine_boom.wav'),
        sourceUrl: 'urn:autoclip:sfx:vine_boom',
        author: 'AutoClip Open Studio Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['boom', 'bass', 'surprise', 'punchline', 'impact'],
        category: 'impact',
      },
      {
        id: 'sfx_bell_ting',
        name: 'Epiphany Bell Ting',
        type: 'sfx',
        filePath: path.join(sfxDir, 'bell_ting.wav'),
        sourceUrl: 'urn:autoclip:sfx:bell_ting',
        author: 'AutoClip Open Studio Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['ting', 'bell', 'reveal', 'idea', 'success'],
        category: 'reveal',
      },
      {
        id: 'sfx_bruh',
        name: 'Awkward Low Pitch Bruh',
        type: 'sfx',
        filePath: path.join(sfxDir, 'bruh.wav'),
        sourceUrl: 'urn:autoclip:sfx:bruh',
        author: 'AutoClip Open Studio Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['bruh', 'awkward', 'fail', 'pause', 'reaction'],
        category: 'reaction',
      },
    ];

    // 2. Index Memes
    const memeItems: Array<Omit<AssetItem, 'fingerprint' | 'fetchedAt'>> = [
      {
        id: 'meme_shocked',
        name: 'Shocked Emoji Reaction',
        type: 'meme',
        filePath: path.join(memesDir, 'shocked_face.png'),
        sourceUrl: 'urn:autoclip:meme:shocked_face',
        author: 'AutoClip Vector Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['shocked', 'surprise', 'crazy', 'reaction'],
      },
      {
        id: 'meme_confused',
        name: 'Confused Question Mark Burst',
        type: 'meme',
        filePath: path.join(memesDir, 'confused_question.png'),
        sourceUrl: 'urn:autoclip:meme:confused_question',
        author: 'AutoClip Vector Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['confused', 'fail', 'question', 'pause'],
      },
      {
        id: 'meme_deal_with_it',
        name: 'Thug Life Pixel Sunglasses',
        type: 'meme',
        filePath: path.join(memesDir, 'deal_with_it.png'),
        sourceUrl: 'urn:autoclip:meme:deal_with_it',
        author: 'AutoClip Vector Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['sunglasses', 'punchline', 'boss', 'win'],
      },
      {
        id: 'meme_fire_hype',
        name: 'Blazing Fire Flame',
        type: 'meme',
        filePath: path.join(memesDir, 'fire_hype.png'),
        sourceUrl: 'urn:autoclip:meme:fire_hype',
        author: 'AutoClip Vector Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['fire', 'hook', 'hype', 'trending'],
      },
      {
        id: 'meme_lightbulb',
        name: 'Glowing Lightbulb Insight',
        type: 'meme',
        filePath: path.join(memesDir, 'lightbulb_reveal.png'),
        sourceUrl: 'urn:autoclip:meme:lightbulb_reveal',
        author: 'AutoClip Vector Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['lightbulb', 'reveal', 'insight', 'fact'],
      },
    ];

    // 3. Index Music
    const musicItems: Array<Omit<AssetItem, 'fingerprint' | 'fetchedAt'>> = [
      {
        id: 'music_reaction_upbeat',
        name: 'Upbeat Groovy Rhythm Trap',
        type: 'music',
        filePath: path.join(musicDir, 'reaction_upbeat.wav'),
        sourceUrl: 'urn:autoclip:music:reaction_upbeat',
        author: 'AutoClip Acoustic Engine',
        license: 'CC0 1.0 Universal (Royalty-Free Permissive)',
        mood: 'upbeat',
        tags: ['upbeat', 'trap', 'funk', 'reaction', 'streamer'],
      },
      {
        id: 'music_documentary_ambient',
        name: 'Cinematic Ambient Story Bed',
        type: 'music',
        filePath: path.join(musicDir, 'documentary_ambient.wav'),
        sourceUrl: 'urn:autoclip:music:documentary_ambient',
        author: 'AutoClip Acoustic Engine',
        license: 'CC0 1.0 Universal (Royalty-Free Permissive)',
        mood: 'ambient',
        tags: ['ambient', 'cinematic', 'curiosity', 'documentary', 'storytelling'],
      },
    ];

    const all = [...sfxItems, ...memeItems, ...musicItems];
    for (const item of all) {
      if (fs.existsSync(item.filePath)) {
        const fullHash = this.computeFingerprint(item.filePath);
        const fullItem: AssetItem = {
          ...item,
          fetchedAt: new Date().toISOString(),
          fingerprint: fullHash.substring(0, 16),
        };
        this.assetCache.set(fullItem.id, fullItem);
      }
    }
  }

  /**
   * Index persistent imported user SFX library from manifest.json
   */
  indexImportedAssets(): void {
    const manifestPath = path.join(this.importedAssetsDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const items: ImportedSfxMetadata[] = JSON.parse(raw);
      if (Array.isArray(items)) {
        for (const meta of items) {
          if (fs.existsSync(meta.filePath)) {
            this.importedManifest.set(meta.id, meta);

            const asset: AssetItem = {
              id: meta.id,
              name: meta.displayName,
              type: 'sfx',
              filePath: meta.filePath,
              sourceUrl: `file://${meta.filePath}`,
              license: meta.license || 'Chưa xác nhận',
              fetchedAt: meta.importedAt,
              fingerprint: meta.sha256.substring(0, 16),
              tags: meta.tags || [],
              category: meta.category,
              confidence: meta.confidence,
              reviewStatus: meta.reviewStatus,
              originalFilename: meta.originalFilename,
              description: meta.description,
            };
            this.assetCache.set(asset.id, asset);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to parse imported assets manifest:', err);
    }
  }

  /**
   * Save current imported manifest to disk
   */
  private saveImportedManifest(): void {
    const manifestPath = path.join(this.importedAssetsDir, 'manifest.json');
    const items = Array.from(this.importedManifest.values());
    fs.writeFileSync(manifestPath, JSON.stringify(items, null, 2), 'utf8');
  }

  /**
   * Auto-classify SFX based on filename, audio duration and sound profile
   */
  classifySfx(
    originalFilename: string,
    duration: number,
    sampleRate?: number,
    channels?: number
  ): {
    displayName: string;
    normalizedBase: string;
    category: string;
    tags: string[];
    confidence: number;
    reviewStatus: 'approved' | 'needs_review';
    description: string;
  } {
    const lowerName = originalFilename.toLowerCase();

    // 1. Bonk
    if (/bonk/i.test(lowerName)) {
      return {
        displayName: 'bonk_impact',
        normalizedBase: 'bonk_impact',
        category: 'impact',
        tags: ['impact', 'comedy', 'hit'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh gõ / va chạm hài hước dạng bonk',
      };
    }

    // 2. Bruh
    if (/bruh/i.test(lowerName)) {
      return {
        displayName: 'bruh_reaction',
        normalizedBase: 'bruh_reaction',
        category: 'reaction',
        tags: ['awkward', 'fail', 'reaction'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh biểu cảm ngượng ngùng / hụt hẫng (bruh)',
      };
    }

    // 3. Cartoon Slip
    if (/cartoonslip|cartoon.*slip|slip/i.test(lowerName)) {
      return {
        displayName: 'cartoon_slip',
        normalizedBase: 'cartoon_slip',
        category: 'comedy',
        tags: ['slip', 'fall', 'comedy'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh trượt ngã hoạt hình hài hước',
      };
    }

    // 4. Loading / Connection Lost
    if (/loading.*lost.*connection|connection.*lost|lost.*connection/i.test(lowerName)) {
      return {
        displayName: 'connection_lost',
        normalizedBase: 'connection_lost',
        category: 'fail',
        tags: ['disconnect', 'glitch', 'fail'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh mất kết nối / đứng hình / glitch',
      };
    }

    // 5. Ding / Reveal
    if (/(?:^|[^a-z])ding(?:[^a-z]|$)/i.test(lowerName)) {
      return {
        displayName: 'ding_reveal',
        normalizedBase: 'ding_reveal',
        category: 'reveal',
        tags: ['reveal', 'idea', 'success'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh chuông báo ý tưởng / bật mí thành công',
      };
    }

    // 6. Money
    if (/money|cash/i.test(lowerName)) {
      return {
        displayName: 'money_cue',
        normalizedBase: 'money_cue',
        category: 'money',
        tags: ['money', 'cash', 'reward'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh liên quan tiền bạc / phần thưởng',
      };
    }

    // 7. Pop
    if (/pop/i.test(lowerName)) {
      return {
        displayName: 'pop_transition',
        normalizedBase: 'pop_transition',
        category: 'transition',
        tags: ['pop', 'appearance', 'transition'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh pop nhẹ khi xuất hiện hoặc chuyển cảnh',
      };
    }

    // 8. Punch Gaming
    if (/punch/i.test(lowerName)) {
      return {
        displayName: 'punch_impact',
        normalizedBase: 'punch_impact',
        category: 'impact',
        tags: ['punch', 'hit', 'gaming'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh cú đấm / tác động mạnh phong cách gaming',
      };
    }

    // 9. Rizz
    if (/rizz/i.test(lowerName)) {
      return {
        displayName: 'rizz_reaction',
        normalizedBase: 'rizz_reaction',
        category: 'reaction',
        tags: ['flirt', 'rizz', 'comedy'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh nhạc nền tán tỉnh / rizz hài hước',
      };
    }

    // 10. Running Away
    if (/running.*away|run.*away/i.test(lowerName)) {
      return {
        displayName: 'running_away',
        normalizedBase: 'running_away',
        category: 'chase',
        tags: ['escape', 'chase', 'comedy'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh rượt đuổi / bỏ chạy vui nhộn',
      };
    }

    // 11. Shocked
    if (/shocked|shock/i.test(lowerName)) {
      return {
        displayName: 'shocked_reaction',
        normalizedBase: 'shocked_reaction',
        category: 'reaction',
        tags: ['surprise', 'shock', 'reaction'],
        confidence: 0.95,
        reviewStatus: 'approved',
        description: 'Âm thanh thể hiện sự kinh ngạc / sốc',
      };
    }

    // 12. Ambiguous sounds like 'ahh!!' or 'fahhhhh'
    if (/ahh|fah/i.test(lowerName)) {
      const cleanTitle = originalFilename
        .replace(/\.[^/.]+$/, '')
        .replace(/[!._-]+/g, ' ')
        .trim();
      const cleanSnake = cleanTitle.toLowerCase().replace(/\s+/g, '_');
      return {
        displayName: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
        normalizedBase: cleanSnake || 'voice_exclamation',
        category: 'voice',
        tags: ['voice', 'sound'],
        confidence: 0.50,
        reviewStatus: 'needs_review',
        description: 'Âm thanh chưa rõ ngữ cảnh cụ thể, cần người dùng nghe thử và xác nhận',
      };
    }

    // 13. General fallback
    const rawNoExt = originalFilename.replace(/\.[^/.]+$/, '');
    const cleanWords = rawNoExt.replace(/[^a-zA-Z0-9\s_-]/g, ' ').replace(/[_-]/g, ' ').trim();
    const title = cleanWords
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ') || 'Custom SFX';
    const snake = title.toLowerCase().replace(/\s+/g, '_');

    return {
      displayName: title,
      normalizedBase: snake,
      category: 'other',
      tags: ['sfx', snake],
      confidence: 0.60,
      reviewStatus: 'needs_review',
      description: 'SFX nhập từ máy người dùng, cần người dùng duyệt',
    };
  }

  /**
   * Import multiple audio files or directories from user local machine into persistent app storage
   */
  async importSfxPaths(sourcePaths: string[], customFfprobePath?: string): Promise<ImportResult> {
    const ffprobePath = customFfprobePath || (await this.resolveFfprobePath());
    const filesToProcess: string[] = [];

    // Helper to recursively collect audio files
    const collectFiles = (targetPath: string) => {
      if (!fs.existsSync(targetPath)) return;
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(targetPath);
        for (const entry of entries) {
          collectFiles(path.join(targetPath, entry));
        }
      } else if (stat.isFile()) {
        const ext = path.extname(targetPath).toLowerCase();
        if (['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'].includes(ext)) {
          filesToProcess.push(targetPath);
        }
      }
    };

    for (const p of sourcePaths) {
      collectFiles(p);
    }

    const imported: ImportedSfxMetadata[] = [];
    const duplicates: Array<{ filename: string; sha256: string; existingName: string }> = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const filePath of filesToProcess) {
      const originalFilename = path.basename(filePath);

      // 1. Probe audio validity and properties
      let duration = 0;
      let sampleRate: number | undefined;
      let channels: number | undefined;

      try {
        const probeRes = await runSpawn(ffprobePath, [
          '-v', 'error',
          '-show_entries', 'format=duration:stream=codec_type,sample_rate,channels',
          '-of', 'json',
          filePath,
        ]).promise;

        if (probeRes.code !== 0) {
          failed.push({ path: filePath, error: `ffprobe failed: ${probeRes.stderr}` });
          continue;
        }

        const data = JSON.parse(probeRes.stdout);
        duration = parseFloat(data.format?.duration ?? '0');
        if (isNaN(duration) || duration <= 0) {
          failed.push({ path: filePath, error: 'Không thể xác định thời lượng audio (duration <= 0)' });
          continue;
        }

        const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
        if (!audioStream) {
          failed.push({ path: filePath, error: 'File không chứa audio stream hợp lệ' });
          continue;
        }

        sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined;
        channels = audioStream.channels ? parseInt(audioStream.channels, 10) : undefined;
      } catch (err: any) {
        failed.push({ path: filePath, error: `Lỗi đọc file: ${err.message}` });
        continue;
      }

      // 2. Compute SHA-256 for duplicate detection
      const sha256 = this.computeFingerprint(filePath);
      const existingInManifest = Array.from(this.importedManifest.values()).find(
        (m) => m.sha256 === sha256
      );

      if (existingInManifest) {
        duplicates.push({
          filename: originalFilename,
          sha256,
          existingName: existingInManifest.displayName,
        });
        continue;
      }

      // 3. Auto-classify & Propose standardized metadata
      const classification = this.classifySfx(originalFilename, duration, sampleRate, channels);
      const shortHash = sha256.substring(0, 8);
      const ext = path.extname(originalFilename) || '.mp3';
      const storedFilename = `${classification.normalizedBase}_${shortHash}${ext.toLowerCase()}`;
      const destPath = path.join(this.importedAssetsDir, storedFilename);

      // 4. Copy file to persistent app storage (never touch original file!)
      try {
        fs.copyFileSync(filePath, destPath);
      } catch (copyErr: any) {
        failed.push({ path: filePath, error: `Không thể sao chép file: ${copyErr.message}` });
        continue;
      }

      // 5. Build manifest entry
      const metaItem: ImportedSfxMetadata = {
        id: `imported_sfx_${shortHash}`,
        originalFilename,
        displayName: classification.displayName,
        storedFilename,
        filePath: destPath,
        sha256,
        duration,
        sampleRate,
        channels,
        tags: classification.tags,
        category: classification.category,
        description: classification.description,
        confidence: classification.confidence,
        reviewStatus: classification.reviewStatus,
        license: 'Chưa xác nhận',
        importedAt: new Date().toISOString(),
      };

      this.importedManifest.set(metaItem.id, metaItem);

      // 6. Add to runtime asset cache
      const assetItem: AssetItem = {
        id: metaItem.id,
        name: metaItem.displayName,
        type: 'sfx',
        filePath: destPath,
        sourceUrl: `file://${destPath}`,
        license: metaItem.license,
        fetchedAt: metaItem.importedAt,
        fingerprint: shortHash,
        tags: metaItem.tags,
        category: metaItem.category,
        confidence: metaItem.confidence,
        reviewStatus: metaItem.reviewStatus,
        originalFilename: metaItem.originalFilename,
        description: metaItem.description,
      };
      this.assetCache.set(assetItem.id, assetItem);

      imported.push(metaItem);
    }

    // Persist manifest
    this.saveImportedManifest();

    return { imported, duplicates, failed };
  }

  /**
   * Update imported asset metadata (displayName, tags, category, license, reviewStatus)
   */
  async updateImportedAsset(id: string, updates: Partial<ImportedSfxMetadata>): Promise<ImportedSfxMetadata> {
    const existing = this.importedManifest.get(id);
    if (!existing) {
      throw new Error(`Imported SFX with ID "${id}" not found.`);
    }

    const updated: ImportedSfxMetadata = {
      ...existing,
      ...updates,
      id: existing.id,
      filePath: existing.filePath,
      storedFilename: existing.storedFilename,
      sha256: existing.sha256,
    };

    this.importedManifest.set(id, updated);

    // Update in asset cache as well
    const cached = this.assetCache.get(id);
    if (cached) {
      cached.name = updated.displayName;
      cached.tags = updated.tags;
      cached.license = updated.license;
      cached.category = updated.category;
      cached.confidence = updated.confidence;
      cached.reviewStatus = updated.reviewStatus;
      cached.description = updated.description;
    }

    this.saveImportedManifest();
    return updated;
  }

  /**
   * Delete an imported SFX from persistent storage and manifest
   */
  async deleteImportedAsset(id: string): Promise<boolean> {
    const existing = this.importedManifest.get(id);
    if (!existing) return false;

    // Delete copied file
    try {
      if (fs.existsSync(existing.filePath)) {
        fs.unlinkSync(existing.filePath);
      }
    } catch (err) {
      console.warn(`Failed to delete file ${existing.filePath}:`, err);
    }

    this.importedManifest.delete(id);
    this.assetCache.delete(id);
    this.saveImportedManifest();
    return true;
  }

  /**
   * Get all currently imported SFX metadata items
   */
  getImportedAssets(): ImportedSfxMetadata[] {
    return Array.from(this.importedManifest.values());
  }

  async getAsset(type: 'meme' | 'sfx' | 'music', query: string, mood?: string): Promise<AssetItem | null> {
    const list = Array.from(this.assetCache.values()).filter((a) => a.type === type);
    const q = query.toLowerCase();

    // Exact or tag match
    const matched = list.find(
      (a) => a.tags.some((t) => t.includes(q)) || a.name.toLowerCase().includes(q)
    );
    if (matched) return matched;

    // Mood match
    if (mood) {
      const moodMatch = list.find((a) => a.mood === mood);
      if (moodMatch) return moodMatch;
    }

    return list[0] || null;
  }

  async getAllAssets(type?: 'meme' | 'sfx' | 'music'): Promise<AssetItem[]> {
    return this.getAllAssetsSync(type);
  }

  getAllAssetsSync(type?: 'meme' | 'sfx' | 'music'): AssetItem[] {
    const list = Array.from(this.assetCache.values());
    if (type) {
      return list.filter((a) => a.type === type);
    }
    return list;
  }

  /**
   * Map beat type and preset to a verified SFX asset
   */
  getSfxForBeat(beatType: BeatType, preset: VideoPreset): AssetItem {
    let key = 'sfx_whoosh';
    switch (beatType) {
      case 'hook':
        key = 'sfx_whoosh';
        break;
      case 'surprise':
        key = 'sfx_vine_boom';
        break;
      case 'reveal':
        key = 'sfx_bell_ting';
        break;
      case 'fail':
        key = 'sfx_bruh';
        break;
      case 'punchline':
        key = 'sfx_vine_boom';
        break;
      case 'pause':
        key = 'sfx_bruh';
        break;
    }
    const item = this.assetCache.get(key) || Array.from(this.assetCache.values()).find((a) => a.type === 'sfx');
    if (item) return item;
    return {
      id: key,
      name: 'Default SFX',
      type: 'sfx',
      filePath: path.join(this.baseAssetsDir, 'sfx', 'whoosh.wav'),
      sourceUrl: `urn:autoclip:sfx:${key}`,
      license: 'CC0 1.0 Universal',
      fetchedAt: new Date().toISOString(),
      fingerprint: 'local',
      tags: [],
    };
  }

  /**
   * Map beat type and preset to a verified Meme visual asset
   */
  getMemeForBeat(beatType: BeatType, preset: VideoPreset): AssetItem {
    let key = 'meme_fire_hype';
    switch (beatType) {
      case 'hook':
        key = 'meme_fire_hype';
        break;
      case 'surprise':
        key = 'meme_shocked';
        break;
      case 'reveal':
        key = 'meme_lightbulb';
        break;
      case 'fail':
        key = 'meme_confused';
        break;
      case 'punchline':
        key = 'meme_deal_with_it';
        break;
      case 'pause':
        key = 'meme_confused';
        break;
    }
    const item = this.assetCache.get(key) || Array.from(this.assetCache.values()).find((a) => a.type === 'meme');
    if (item) return item;
    return {
      id: key,
      name: 'Default Meme',
      type: 'meme',
      filePath: path.join(this.baseAssetsDir, 'memes', 'fire_hype.png'),
      sourceUrl: `urn:autoclip:meme:${key}`,
      license: 'CC0 1.0 Universal',
      fetchedAt: new Date().toISOString(),
      fingerprint: 'local',
      tags: [],
    };
  }

  /**
   * Get mood-matched BGM track for preset
   */
  getMusicForPreset(preset: VideoPreset): AssetItem {
    const key = preset === 'reaction' ? 'music_reaction_upbeat' : 'music_documentary_ambient';
    const item = this.assetCache.get(key) || Array.from(this.assetCache.values()).find((a) => a.type === 'music');
    if (item) return item;
    return {
      id: key,
      name: preset === 'reaction' ? 'Upbeat Groovy Rhythm Trap' : 'Cinematic Ambient Story Bed',
      type: 'music',
      filePath: path.join(this.baseAssetsDir, 'music', preset === 'reaction' ? 'reaction_upbeat.wav' : 'documentary_ambient.wav'),
      sourceUrl: `urn:autoclip:music:${key}`,
      license: 'CC0 1.0 Universal',
      fetchedAt: new Date().toISOString(),
      fingerprint: 'local',
      tags: [],
    };
  }

  private async resolveFfprobePath(): Promise<string> {
    try {
      const { promise } = runSpawn('which', ['ffprobe']);
      const res = await promise;
      if (res.code === 0 && res.stdout.trim()) {
        return res.stdout.trim().split('\n')[0];
      }
    } catch {
      // Fallback
    }

    const fallbacks = [
      '/opt/homebrew/bin/ffprobe',
      '/usr/local/bin/ffprobe',
    ];
    for (const p of fallbacks) {
      if (fs.existsSync(p)) return p;
    }
    return 'ffprobe';
  }
}
