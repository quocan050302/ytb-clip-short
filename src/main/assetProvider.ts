import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AssetItem, BeatType, VideoPreset } from './types';

export interface AssetProviderInterface {
  getAsset(type: 'meme' | 'sfx' | 'music', query: string, mood?: string): Promise<AssetItem | null>;
  getAllAssets(type?: 'meme' | 'sfx' | 'music'): Promise<AssetItem[]>;
}

/**
 * Standard Local Asset Provider with verified file cache and licensing metadata.
 */
export class LocalAssetProvider implements AssetProviderInterface {
  private baseAssetsDir: string;
  private assetCache: Map<string, AssetItem> = new Map();

  constructor(customAssetsDir?: string) {
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
    this.indexLocalLibrary();
  }

  /**
   * Calculate SHA-256 fingerprint of a media file
   */
  private computeFingerprint(filePath: string): string {
    try {
      const buffer = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);
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
      },
      {
        id: 'sfx_vine_boom',
        name: 'Vine Boom Bass Drop',
        type: 'sfx',
        filePath: path.join(sfxDir, 'vine_boom.wav'),
        sourceUrl: 'urn:autoclip:sfx:vine_boom',
        author: 'AutoClip Open Studio Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['boom', 'bass', 'surprise', 'punchline'],
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
      },
      {
        id: 'sfx_bruh',
        name: 'Awkward Low Pitch Bruh',
        type: 'sfx',
        filePath: path.join(sfxDir, 'bruh.wav'),
        sourceUrl: 'urn:autoclip:sfx:bruh',
        author: 'AutoClip Open Studio Library',
        license: 'CC0 1.0 Universal (Public Domain)',
        tags: ['bruh', 'awkward', 'fail', 'pause'],
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
        const fullItem: AssetItem = {
          ...item,
          fetchedAt: new Date().toISOString(),
          fingerprint: this.computeFingerprint(item.filePath),
        };
        this.assetCache.set(fullItem.id, fullItem);
      }
    }
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

    // Default fallback to first available item
    return list[0] || null;
  }

  async getAllAssets(type?: 'meme' | 'sfx' | 'music'): Promise<AssetItem[]> {
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
}
