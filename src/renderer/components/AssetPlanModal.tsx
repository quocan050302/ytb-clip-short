import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Music,
  Zap,
  Film,
  X,
  Check,
  Plus,
  Trash2,
  ShieldCheck,
  Clock,
  Volume2,
  VolumeX,
  Play,
  Square,
  AlertTriangle,
  Info,
  Sliders,
  FolderPlus,
  Folder,
  FileAudio,
  CheckCircle2,
  CheckCheck,
  HelpCircle,
  ThumbsUp,
  RefreshCw,
} from 'lucide-react';
import {
  AssetItem,
  BeatEvent,
  BeatType,
  CatalogStats,
  ClipAssetPlan,
  ClipCandidate,
  MomentCandidate,
  PlannedSfxEvent,
} from '../../main/types';
import { SfxLibraryModal } from './SfxLibraryModal';

interface AssetPlanModalProps {
  candidate: ClipCandidate;
  jobId?: string;
  onSave: (updatedPlan: ClipAssetPlan) => void;
  onClose: () => void;
  onPlanUpdatedInJob?: (updatedJob: any) => void;
}

export const AssetPlanModal: React.FC<AssetPlanModalProps> = ({
  candidate,
  jobId,
  onSave,
  onClose,
  onPlanUpdatedInJob,
}) => {
  const [availableMemes, setAvailableMemes] = useState<AssetItem[]>([]);
  const [availableSfx, setAvailableSfx] = useState<AssetItem[]>([]);
  const [availableMusic, setAvailableMusic] = useState<AssetItem[]>([]);
  const [catalogStats, setCatalogStats] = useState<CatalogStats | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isRescanning, setIsRescanning] = useState<boolean>(false);
  const [libraryChanged, setLibraryChanged] = useState<boolean>(false);
  const [rescanFeedback, setRescanFeedback] = useState<string | null>(null);

  // Audio audition state
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // AI sound proposals state
  const [suggestedMoments, setSuggestedMoments] = useState<MomentCandidate[]>(() => {
    return candidate.assetPlan?.suggestedMoments
      ? JSON.parse(JSON.stringify(candidate.assetPlan.suggestedMoments))
      : [];
  });
  const [showLibraryModal, setShowLibraryModal] = useState<boolean>(false);

  // Local editable copy of plan with automatic migration to sfxEvents[]
  const [plan, setPlan] = useState<ClipAssetPlan>(() => {
    let initialPlan: ClipAssetPlan;
    if (candidate.assetPlan) {
      initialPlan = JSON.parse(JSON.stringify(candidate.assetPlan));
    } else {
      initialPlan = {
        clipId: candidate.id,
        musicTrack: null,
        beats: [],
        sfxEvents: [],
        duckingSettings: {
          normalVolume: 0.22,
          duckedVolume: 0.06,
          fadeInDuration: 0.5,
          fadeOutDuration: 1.0,
        },
      };
    }

    // Ensure sfxEvents is populated from beats if missing
    if (!initialPlan.sfxEvents || !Array.isArray(initialPlan.sfxEvents)) {
      initialPlan.sfxEvents = (initialPlan.beats || [])
        .filter((b: BeatEvent) => b.sfx && b.sfx.filePath)
        .map((b: BeatEvent, i: number) => ({
          id: `sfx_migrated_${b.id || i}`,
          asset: b.sfx,
          triggerAt: Math.max(0, Math.min(Math.max(0, candidate.duration - 0.1), b.timestamp)),
          duration: b.duration,
          volume: 0.85,
          fadeIn: 0.05,
          fadeOut: 0.25,
          enabled: true,
          sourceBeatId: b.id,
          origin: 'auto' as const,
          reason: b.reason || `SFX đồng bộ theo beat ${b.beatType}`,
        }));
    }

    return initialPlan;
  });

  // Stop audition audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Fetch verified local library assets
  useEffect(() => {
    async function loadAssets() {
      try {
        if (window.electronAPI) {
          const [memes, sfxList, musicList, stats] = await Promise.all([
            window.electronAPI.getAllAssets('meme'),
            window.electronAPI.getAllAssets('sfx'),
            window.electronAPI.getAllAssets('music'),
            window.electronAPI.getCatalogStats ? window.electronAPI.getCatalogStats() : Promise.resolve(null),
          ]);
          setAvailableMemes(memes);
          setAvailableSfx(sfxList);
          setAvailableMusic(musicList);
          if (stats) setCatalogStats(stats);
        }
      } catch (err) {
        console.error('Failed to load library assets:', err);
      }
    }
    loadAssets();
  }, []);

  // Audio audition preview handler
  const handleToggleAudition = (filePath: string, id: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingAssetId === id) {
      setPlayingAssetId(null);
      return;
    }

    if (!filePath) return;

    try {
      const src = filePath.startsWith('http') || filePath.startsWith('file:')
        ? filePath
        : `file://${filePath}`;
      const audio = new Audio(src);
      audio.onended = () => setPlayingAssetId(null);
      audio.onerror = () => setPlayingAssetId(null);
      audio.play().then(() => {
        audioRef.current = audio;
        setPlayingAssetId(id);
      }).catch(() => {
        setPlayingAssetId(null);
      });
    } catch {
      setPlayingAssetId(null);
    }
  };

  // ── Beat Actions ────────────────────────────────────────────────────────────

  const handleUpdateBeat = (index: number, updated: Partial<BeatEvent>) => {
    const oldBeat = plan.beats[index];
    const newBeats = [...plan.beats];
    const updatedBeat = { ...oldBeat, ...updated };
    newBeats[index] = updatedBeat;

    let newSfxEvents = [...(plan.sfxEvents || [])];

    // If beat timestamp moved, propagate shift to all linked 'auto' SFX events
    if (updated.timestamp !== undefined && updated.timestamp !== oldBeat.timestamp) {
      const delta = updated.timestamp - oldBeat.timestamp;
      newSfxEvents = newSfxEvents.map((evt) => {
        if (evt.sourceBeatId === oldBeat.id && evt.origin === 'auto') {
          const newTrig = Math.max(0, Math.min(candidate.duration - 0.05, Math.round((evt.triggerAt + delta) * 10) / 10));
          return { ...evt, triggerAt: newTrig };
        }
        return evt;
      });
    }

    setPlan({ ...plan, beats: newBeats, sfxEvents: newSfxEvents });
  };

  const handleDeleteBeat = (index: number) => {
    const beatToDelete = plan.beats[index];
    const newBeats = plan.beats.filter((_, i) => i !== index);

    // Rule: deleting a beat only removes linked 'auto' SFX events; manual SFX are preserved
    const newSfxEvents = (plan.sfxEvents || [])
      .filter((evt) => !(evt.sourceBeatId === beatToDelete.id && evt.origin === 'auto'))
      .map((evt) => {
        if (evt.sourceBeatId === beatToDelete.id) {
          return { ...evt, sourceBeatId: undefined };
        }
        return evt;
      });

    setPlan({ ...plan, beats: newBeats, sfxEvents: newSfxEvents });
  };

  const handleAddBeat = () => {
    const fallbackMeme = availableMemes[0] || {
      id: 'meme_fire_hype',
      name: 'Blazing Fire Flame',
      type: 'meme',
      filePath: '',
      sourceUrl: 'urn:autoclip:meme:fire_hype',
      license: 'CC0 1.0 Universal',
      fetchedAt: new Date().toISOString(),
      fingerprint: 'local',
      tags: [],
    };

    const newBeatId = `beat_custom_${Date.now()}`;
    const newBeatTimestamp = Math.round((candidate.duration / 2) * 10) / 10;

    const newBeat: BeatEvent = {
      id: newBeatId,
      beatType: 'surprise',
      timestamp: newBeatTimestamp,
      duration: 1.5,
      meme: fallbackMeme,
      sfx: availableSfx[0],
      confidence: 1.0,
      reason: 'Beat người dùng thêm thủ công',
    };

    setPlan({ ...plan, beats: [...plan.beats, newBeat] });
  };

  // ── SFX Timeline Actions ───────────────────────────────────────────────────

  const handleAddSfx = (targetTime?: number, sourceBeatId?: string) => {
    if (availableSfx.length === 0) return;

    const trig = targetTime !== undefined
      ? Math.max(0, Math.min(candidate.duration - 0.05, Math.round(targetTime * 10) / 10))
      : Math.round((candidate.duration / 3) * 10) / 10;

    const defaultAsset = availableSfx[0];
    const newEvent: PlannedSfxEvent = {
      id: `sfx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      asset: defaultAsset,
      triggerAt: trig,
      duration: undefined,
      volume: 0.85,
      fadeIn: 0.05,
      fadeOut: 0.25,
      enabled: true,
      sourceBeatId,
      origin: 'manual',
      reason: sourceBeatId ? `SFX thủ công tại beat ${sourceBeatId}` : 'SFX thêm thủ công vào timeline',
    };

    setPlan({
      ...plan,
      sfxEvents: [...(plan.sfxEvents || []), newEvent],
    });
  };

  const handleUpdateSfx = (id: string, updated: Partial<PlannedSfxEvent>) => {
    const newEvents = (plan.sfxEvents || []).map((evt) => {
      if (evt.id === id) {
        const next = { ...evt, ...updated };
        // If user manually changed triggerAt on an auto event, decouple to manual
        if (updated.triggerAt !== undefined && updated.triggerAt !== evt.triggerAt) {
          next.origin = 'manual';
        }
        return next;
      }
      return evt;
    });
    setPlan({ ...plan, sfxEvents: newEvents });
  };

  const handleDeleteSfx = (id: string) => {
    const newEvents = (plan.sfxEvents || []).filter((e) => e.id !== id);
    setPlan({ ...plan, sfxEvents: newEvents });
  };

  // ── AI Sound Proposal Actions (Two-Tier AI Selection) ───────────────────────

  const handleApplyAllSuggested = () => {
    const newSfxEvents = [...(plan.sfxEvents || [])];
    let addedCount = 0;

    suggestedMoments.forEach((m) => {
      if (!m.suggestedSfx) return;
      const alreadyExists = newSfxEvents.some(
        (e) => Math.abs(e.triggerAt - m.timestamp) < 0.25 && e.asset.id === m.suggestedSfx?.id
      );
      if (!alreadyExists) {
        newSfxEvents.push({
          id: `sfx_moment_${m.id}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          asset: m.suggestedSfx,
          triggerAt: Math.round(m.timestamp * 10) / 10,
          duration: undefined,
          volume: 0.85,
          fadeIn: 0.05,
          fadeOut: 0.25,
          enabled: true,
          origin: 'auto',
          reason: m.reason || m.evidence,
        });
        addedCount++;
      }
    });

    setPlan({ ...plan, sfxEvents: newSfxEvents });
  };

  const handleAcceptMoment = (m: MomentCandidate) => {
    if (!m.suggestedSfx) return;
    const newSfxEvents = [...(plan.sfxEvents || [])];
    const alreadyExists = newSfxEvents.some(
      (e) => Math.abs(e.triggerAt - m.timestamp) < 0.25 && e.asset.id === m.suggestedSfx?.id
    );
    if (!alreadyExists) {
      newSfxEvents.push({
        id: `sfx_moment_${m.id}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        asset: m.suggestedSfx,
        triggerAt: Math.round(m.timestamp * 10) / 10,
        duration: undefined,
        volume: 0.85,
        fadeIn: 0.05,
        fadeOut: 0.25,
        enabled: true,
        origin: 'auto',
        reason: m.reason || m.evidence,
      });
      setPlan({ ...plan, sfxEvents: newSfxEvents });
    }
  };

  const handleChangeMomentSfx = (momentId: string, asset: AssetItem) => {
    setSuggestedMoments((prev) =>
      prev.map((m) => (m.id === momentId ? { ...m, suggestedSfx: asset } : m))
    );
  };

  const handleDismissMoment = (momentId: string) => {
    setSuggestedMoments((prev) => prev.filter((m) => m.id !== momentId));
  };

  const handleImportFromFinder = async (mode: 'files' | 'folder' = 'files') => {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.importSfxDialog(mode);
      if (res && res.imported.length > 0) {
        await handleRefreshSfxAssets();
        setLibraryChanged(true);
      }
    } catch (err) {
      console.error('Import from Finder failed:', err);
    }
  };

  const handleRefreshSfxAssets = async () => {
    if (!window.electronAPI) return;
    try {
      const [sfxList, stats] = await Promise.all([
        window.electronAPI.getAllAssets('sfx'),
        window.electronAPI.getCatalogStats ? window.electronAPI.getCatalogStats() : Promise.resolve(null),
      ]);
      setAvailableSfx(sfxList);
      if (stats) setCatalogStats(stats);
    } catch (err) {
      console.error('Failed to reload SFX:', err);
    }
  };

  const handleRescanSfx = async () => {
    if (!window.electronAPI) return;
    setIsRescanning(true);
    setRescanFeedback(null);
    try {
      if (jobId) {
        const updatedJob = await window.electronAPI.rescanCandidateSfx(jobId, candidate.id);
        const updatedCand = updatedJob.candidates?.find((c: any) => c.id === candidate.id);
        if (updatedCand?.assetPlan) {
          setPlan(JSON.parse(JSON.stringify(updatedCand.assetPlan)));
          setSuggestedMoments(JSON.parse(JSON.stringify(updatedCand.assetPlan.suggestedMoments || [])));
        }
        if (onPlanUpdatedInJob) {
          onPlanUpdatedInJob(updatedJob);
        }
      }
      await handleRefreshSfxAssets();
      setLibraryChanged(false);
      setRescanFeedback('Đã quét lại đề xuất SFX thành công cho Short này từ catalog mới nhất!');
      setTimeout(() => setRescanFeedback(null), 5000);
    } catch (err: any) {
      console.error('Rescan failed:', err);
      setRescanFeedback(`Lỗi quét lại SFX: ${err.message}`);
    } finally {
      setIsRescanning(false);
    }
  };

  // ── Validation & Save ──────────────────────────────────────────────────────

  const handleSaveModal = () => {
    const events = plan.sfxEvents || [];
    for (const evt of events) {
      if (evt.enabled !== false) {
        if (evt.triggerAt < 0 || evt.triggerAt >= candidate.duration) {
          setValidationError(
            `SFX "${evt.asset.name}" có mốc thời gian (${evt.triggerAt}s) nằm ngoài phạm vi Short (0s – ${candidate.duration.toFixed(1)}s).`
          );
          return;
        }
        if (evt.volume < 0.05 || evt.volume > 2.0) {
          setValidationError(
            `SFX "${evt.asset.name}" có mức âm lượng không hợp lệ (phải từ 5% đến 200%).`
          );
          return;
        }
        if (evt.fadeIn < 0 || evt.fadeOut < 0) {
          setValidationError(`SFX "${evt.asset.name}" có fade in hoặc fade out âm.`);
          return;
        }
      }
    }

    setValidationError(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const finalPlan: ClipAssetPlan = {
      ...plan,
      suggestedMoments,
    };
    onSave(finalPlan);
    onClose();
  };

  const getBeatBadge = (type: BeatType) => {
    switch (type) {
      case 'hook':
        return <span className="badge badge-hook">🔥 Hook (Mở đầu)</span>;
      case 'surprise':
        return <span className="badge badge-score">💥 Surprise (Bất ngờ)</span>;
      case 'reveal':
        return <span className="badge badge-payoff">💡 Reveal (Bật mí)</span>;
      case 'fail':
        return <span className="badge badge-danger">🗿 Fail / Bruh</span>;
      case 'punchline':
        return <span className="badge badge-pacing">🕶️ Punchline (Cao trào)</span>;
      case 'pause':
        return <span className="badge badge-secondary">⏱️ Dramatic Pause</span>;
    }
  };

  const sfxEventsSorted = [...(plan.sfxEvents || [])].sort((a, b) => a.triggerAt - b.triggerAt);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 920, maxHeight: '92vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: 12,
          }}
        >
          <div>
            <h4
              style={{
                fontSize: '1.2rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Sparkles size={20} color="var(--accent-primary)" />
              Kế Hoạch Asset & SFX Timeline — {candidate.title}
            </h4>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
              Đoạn clip: {candidate.start.toFixed(1)}s ➔ {candidate.end.toFixed(1)}s ({candidate.duration.toFixed(1)} giây).
              Hỗ trợ nhiều SFX tại mọi mốc thời gian, tách độc lập với beat và không giới hạn số lượng.
            </span>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
            <X size={16} />
          </button>
        </div>

        {/* Validation Error Alert */}
        {validationError && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--status-danger)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.82rem',
              color: '#FCA5A5',
            }}
          >
            <AlertTriangle size={16} color="var(--status-danger)" />
            <span>{validationError}</span>
          </div>
        )}

        {/* 1. MUSIC & DUCKING SECTION */}
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.95rem' }}>
              <Music size={18} color="var(--status-info)" />
              Nhạc Nền & Giảm Âm Thoại (BGM Auto-Ducking)
            </div>
            <span className="badge badge-pacing" style={{ fontSize: '0.7rem' }}>
              Sidechain Ducking Engine
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'center' }}>
            <div>
              <label className="input-label" style={{ fontSize: '0.78rem' }}>Bài nhạc đã chọn:</label>
              <select
                className="text-input"
                style={{ width: '100%', fontSize: '0.85rem', cursor: 'pointer' }}
                value={plan.musicTrack?.id || ''}
                onChange={(e) => {
                  const found = availableMusic.find((m) => m.id === e.target.value);
                  setPlan({ ...plan, musicTrack: found || null });
                }}
              >
                <option value="">-- Không chèn nhạc nền --</option>
                {availableMusic.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.mood || 'Standard'} • {m.license})
                  </option>
                ))}
              </select>
              {plan.musicTrack && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 4 }}>
                  Nguồn: <code>{plan.musicTrack.sourceUrl}</code> | Giấy phép: <strong>{plan.musicTrack.license}</strong>
                </div>
              )}
            </div>

            {/* Ducking levels */}
            <div
              style={{
                background: 'rgba(0,0,0,0.25)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                Thông số tự động Gain Ducking:
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#E2E8F0', marginBottom: 4 }}>
                <span>Âm lượng bình thường:</span>
                <strong>{Math.round(plan.duckingSettings.normalVolume * 100)}%</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--status-info)' }}>
                <span>Âm lượng khi có lời thoại (Ducked):</span>
                <strong>{Math.round(plan.duckingSettings.duckedVolume * 100)}%</strong>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 4 }}>
                Fade in: {plan.duckingSettings.fadeInDuration}s • Fade out: {plan.duckingSettings.fadeOutDuration}s
              </div>
            </div>
          </div>
        </div>

        {/* 2. BẢNG DUYỆT ĐỀ XUẤT SFX TỪ AI (TWO-TIER AI SOUND PROPOSAL) */}
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.95rem' }}>
                <Sparkles size={18} color="var(--accent-primary)" />
                Đề Xuất SFX Từ AI Theo Bối Cảnh Lời Thoại & Âm Thanh
                <span className="badge badge-hook" style={{ fontSize: '0.7rem' }}>
                  AI Proposal Engine
                </span>
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Tự động đối chiếu 2 phía: nội dung bối cảnh clip (lời thoại thật, khoảng lặng, beat) &amp; thư viện SFX (tags, tính chất âm). Không tự rải SFX bừa bãi.
              </div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  className="badge"
                  style={{
                    fontSize: '0.72rem',
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: '#93C5FD',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    padding: '2px 8px',
                  }}
                >
                  Đã nạp {availableSfx.length} SFX (
                  {catalogStats
                    ? `${catalogStats.defaultWavCount} mặc định, ${catalogStats.repoMp3Count} từ repo${catalogStats.importedCount ? `, ${catalogStats.importedCount} đã nhập` : ''}`
                    : `${availableSfx.length} sound trong catalog`}
                  )
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                  • 4 trạng thái: [1] Trong thư viện ➔ [2] Được AI đề xuất ➔ [3] Đã thêm vào timeline ➔ [4] Đã render vào MP4
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRescanSfx}
                disabled={isRescanning}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.78rem',
                  borderColor: libraryChanged ? '#F59E0B' : undefined,
                  color: libraryChanged ? '#FCD34D' : undefined,
                }}
                title="Đánh giá lại toàn bộ SFX trong catalog cho từng khoảnh khắc của Short này"
              >
                <RefreshCw size={14} className={isRescanning ? 'spin' : ''} />
                {isRescanning ? 'Đang quét lại...' : 'Quét lại SFX cho Short này'}
              </button>

              {suggestedMoments.length > 0 && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleApplyAllSuggested}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
                  title="Thêm tất cả các SFX được đề xuất phù hợp vào timeline bên dưới"
                >
                  <CheckCheck size={14} /> Áp dụng các đề xuất phù hợp
                </button>
              )}
            </div>
          </div>

          {/* Outdated library warning */}
          {libraryChanged && (
            <div
              style={{
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid #F59E0B',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                marginBottom: 12,
                fontSize: '0.78rem',
                color: '#FCD34D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={15} color="#F59E0B" />
                <span>Thư viện SFX vừa có thay đổi. Bảng đề xuất hiện tại có thể đang dùng kết quả cũ.</span>
              </div>
              <button
                className="btn btn-sm"
                style={{ background: '#F59E0B', color: '#000', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 600 }}
                onClick={handleRescanSfx}
                disabled={isRescanning}
              >
                Quét lại ngay
              </button>
            </div>
          )}

          {/* Rescan feedback banner */}
          {rescanFeedback && (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid #10B981',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                marginBottom: 12,
                fontSize: '0.78rem',
                color: '#6EE7B7',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <CheckCircle2 size={15} color="#10B981" />
              <span>{rescanFeedback}</span>
            </div>
          )}

          {suggestedMoments.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '20px 14px',
                color: 'var(--text-dim)',
                fontSize: '0.82rem',
                background: 'rgba(0,0,0,0.18)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Chưa có khoảnh khắc nổi bật nào cần chèn âm thanh theo transcript thật. Bạn có thể tự thêm SFX từ thư viện bên dưới hoặc bấm <strong>"Quét lại SFX cho Short này"</strong>.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.78rem',
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      color: 'var(--text-dim)',
                      fontSize: '0.72rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    <th style={{ padding: '8px 6px' }}>Thời điểm</th>
                    <th style={{ padding: '8px 6px' }}>Khoảnh khắc phát hiện</th>
                    <th style={{ padding: '8px 6px' }}>SFX đề xuất</th>
                    <th style={{ padding: '8px 6px' }}>Lý do</th>
                    <th style={{ padding: '8px 6px' }}>Độ tin cậy</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center' }}>Nghe thử</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Chấp nhận / Đổi / Xóa</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestedMoments.map((m) => {
                    const isPlaying = m.suggestedSfx && playingAssetId === `prop_${m.id}`;
                    const isAlreadyAdded = (plan.sfxEvents || []).some(
                      (e) => Math.abs(e.triggerAt - m.timestamp) < 0.25 && e.asset.id === m.suggestedSfx?.id
                    );

                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: isAlreadyAdded ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                        }}
                      >
                        {/* 1. Timestamp */}
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              color: 'var(--status-warning)',
                            }}
                          >
                            @{m.timestamp.toFixed(1)}s
                          </span>
                        </td>

                        {/* 2. Detected Moment */}
                        <td style={{ padding: '8px 6px', maxWidth: 180 }}>
                          <span
                            className="badge badge-secondary"
                            style={{ fontSize: '0.68rem', marginRight: 4 }}
                          >
                            {m.type.toUpperCase()}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.73rem' }}>
                            {m.evidence}
                          </span>
                        </td>

                        {/* 3. Proposed SFX */}
                        <td style={{ padding: '8px 6px', minWidth: 180 }}>
                          {m.suggestedSfx ? (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                                  {m.suggestedSfx.name}
                                </span>
                                <span
                                  className="badge badge-secondary"
                                  style={{ fontSize: '0.65rem', padding: '0px 4px' }}
                                >
                                  {['sfx_whoosh', 'sfx_vine_boom', 'sfx_bell_ting', 'sfx_bruh'].includes(m.suggestedSfx.id)
                                    ? 'Mặc định'
                                    : m.suggestedSfx.id.startsWith('imported_sfx_')
                                    ? 'Đã nhập'
                                    : 'Repo'}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 2 }}>
                                File: <code>{m.suggestedSfx.originalFilename || m.suggestedSfx.name}</code> • Tag: {(m.suggestedSfx.tags || []).slice(0, 3).join(', ')}
                              </div>
                              {/* Top choices chips */}
                              {m.topChoices && m.topChoices.length > 1 && (
                                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Gợi ý khác:</span>
                                  {m.topChoices.slice(0, 3).map((choice, cIdx) => (
                                    <button
                                      key={choice.asset.id}
                                      className={`btn btn-sm ${choice.asset.id === m.suggestedSfx?.id ? 'btn-primary' : 'btn-secondary'}`}
                                      style={{ padding: '1px 5px', fontSize: '0.65rem' }}
                                      onClick={() => handleChangeMomentSfx(m.id, choice.asset)}
                                      title={`${choice.asset.name}: ${choice.score}đ — ${choice.reason}`}
                                    >
                                      #{cIdx + 1} {choice.asset.name} ({choice.score}đ)
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div style={{ color: '#F59E0B', fontWeight: 600, fontSize: '0.74rem' }}>
                                Không có SFX phù hợp (Cần duyệt)
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                                Chưa đủ bằng chứng để gán sound. Hãy chọn sound từ menu bên phải nếu muốn.
                              </div>
                            </div>
                          )}
                        </td>

                        {/* 4. Reason */}
                        <td style={{ padding: '8px 6px', maxWidth: 220, fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                          {m.reason || m.evidence}
                        </td>

                        {/* 5. Confidence */}
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          {m.status === 'suggested' || m.confidence < 0.75 ? (
                            <span
                              className="badge"
                              style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#FBBF24', fontSize: '0.68rem' }}
                            >
                              Đề xuất để duyệt ({Math.round(m.confidence * 100)}%)
                            </span>
                          ) : (
                            <span
                              className="badge badge-success"
                              style={{ fontSize: '0.68rem' }}
                            >
                              {Math.round(m.confidence * 100)}%
                            </span>
                          )}
                        </td>

                        {/* 6. Audition */}
                        <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                          {m.suggestedSfx ? (
                            <button
                              className={`btn ${isPlaying ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                              style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                              onClick={() => handleToggleAudition(m.suggestedSfx!.filePath, `prop_${m.id}`)}
                              title="Nghe thử âm thanh SFX này"
                            >
                              {isPlaying ? <Square size={10} /> : <Play size={10} />}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-dim)' }}>—</span>
                          )}
                        </td>

                        {/* 7. Action: Accept / Change / Dismiss */}
                        <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {isAlreadyAdded ? (
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  color: 'var(--status-success)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 2,
                                  fontWeight: 600,
                                }}
                              >
                                <Check size={12} /> Đã vào timeline
                              </span>
                            ) : (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                                onClick={() => handleAcceptMoment(m)}
                                disabled={!m.suggestedSfx}
                                title="Chấp nhận đề xuất này và thêm vào timeline SFX bên dưới"
                              >
                                Chấp nhận
                              </button>
                            )}

                            {/* Change SFX dropdown */}
                            <select
                              className="text-input"
                              style={{
                                fontSize: '0.72rem',
                                padding: '3px 6px',
                                maxWidth: 130,
                                cursor: 'pointer',
                              }}
                              value={m.suggestedSfx?.id || ''}
                              onChange={(e) => {
                                const found = availableSfx.find((s) => s.id === e.target.value);
                                if (found) handleChangeMomentSfx(m.id, found);
                              }}
                              title="Đổi sang SFX khác từ toàn bộ catalog"
                            >
                              <option value="" disabled>
                                Đổi SFX...
                              </option>
                              {availableSfx.map((s) => {
                                const originTag = ['sfx_whoosh', 'sfx_vine_boom', 'sfx_bell_ting', 'sfx_bruh'].includes(s.id)
                                  ? 'Mặc định'
                                  : s.id.startsWith('imported_sfx_')
                                  ? 'Đã nhập'
                                  : 'Repo';
                                return (
                                  <option key={s.id} value={s.id}>
                                    [{originTag}] {s.name}
                                  </option>
                                );
                              })}
                            </select>

                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '3px 6px', fontSize: '0.72rem', color: '#F87171' }}
                              onClick={() => handleDismissMoment(m.id)}
                              title="Bỏ qua đề xuất này"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 3. SFX TIMELINE SECTION (MULTI-SFX INDEPENDENT TIMELINE) */}
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.95rem' }}>
              <Volume2 size={18} color="var(--status-warning)" />
              Timeline SFX của Short
              <span className="badge badge-score" style={{ fontSize: '0.72rem', marginLeft: 6 }}>
                {sfxEventsSorted.length} SFX trong Short
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleImportFromFinder('files')}
                style={{ padding: '4px 10px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 6 }}
                title="Chọn các file MP3/WAV từ macOS Finder để import vào app"
              >
                <FileAudio size={13} /> Import SFX từ máy
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowLibraryModal(true)}
                style={{ padding: '4px 10px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 6 }}
                title="Xem, nghe thử, sửa tên/tag hoặc xóa SFX trong thư viện"
              >
                <FolderPlus size={13} /> Quản lý thư viện SFX
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleAddSfx()}
                style={{ padding: '4px 12px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Plus size={14} /> + Thêm SFX
              </button>
            </div>
          </div>

          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            Một Short có thể dùng nhiều SFX tại nhiều thời điểm (kể cả nhiều SFX quanh cùng một beat). Bạn có thể thêm, đổi âm thanh, nghe thử, chỉnh volume và fade theo ý muốn.
          </div>

          {sfxEventsSorted.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 0',
                color: 'var(--text-dim)',
                fontSize: '0.85rem',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Chưa có SFX nào trong Short này. Bấm <strong>"+ Thêm SFX"</strong> để bổ sung hiệu ứng âm thanh.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sfxEventsSorted.map((evt) => {
                const isPlaying = playingAssetId === evt.id;
                const isLinkedToBeat = !!evt.sourceBeatId;
                const linkedBeat = plan.beats.find((b) => b.id === evt.sourceBeatId);

                return (
                  <div
                    key={evt.id}
                    style={{
                      background: evt.enabled !== false ? 'rgba(15, 20, 32, 0.75)' : 'rgba(15, 20, 32, 0.35)',
                      border: `1px solid ${evt.enabled !== false ? 'var(--border-subtle)' : 'rgba(255,255,255,0.04)'}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      opacity: evt.enabled !== false ? 1 : 0.6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {/* Event Header Bar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={evt.enabled !== false}
                          onChange={(e) => handleUpdateSfx(evt.id, { enabled: e.target.checked })}
                          title="Bật / Tắt SFX này"
                          style={{ cursor: 'pointer', width: 15, height: 15 }}
                        />

                        <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--status-warning)', fontWeight: 700 }}>
                          @{evt.triggerAt.toFixed(1)}s
                        </span>

                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
                          — {evt.asset.name}
                        </span>

                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          — Vol: {Math.round((evt.volume ?? 0.85) * 100)}%
                        </span>

                        <span
                          className={`badge ${evt.origin === 'auto' ? 'badge-secondary' : 'badge-hook'}`}
                          style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                        >
                          {evt.origin === 'auto'
                            ? `Auto: ${linkedBeat ? `Beat ${linkedBeat.beatType}` : 'Hệ thống gợi ý'}`
                            : (isLinkedToBeat ? `Thủ công tại beat ${linkedBeat?.beatType || ''}` : 'Thủ công độc lập')}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Audition Button */}
                        <button
                          className={`btn ${isPlaying ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                          style={{ padding: '3px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => handleToggleAudition(evt.asset.filePath, evt.id)}
                          title="Nghe thử âm thanh SFX này"
                        >
                          {isPlaying ? <Square size={11} /> : <Play size={11} />}
                          {isPlaying ? 'Dừng' : 'Nghe thử'}
                        </button>

                        {/* Delete Button */}
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ padding: '3px 6px' }}
                          onClick={() => handleDeleteSfx(evt.id)}
                          title="Xóa SFX này"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* SFX Reason */}
                    {evt.reason && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                        Lý do: {evt.reason}
                      </div>
                    )}

                    {/* Event Detail Editor Grid */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(180px, 1.5fr) 100px 90px 110px 80px 80px',
                        gap: 8,
                        alignItems: 'flex-end',
                      }}
                    >
                      {/* Asset Dropdown */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          Hiệu ứng âm thanh (SFX):
                        </label>
                        <select
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                          value={evt.asset.id}
                          onChange={(e) => {
                            const found = availableSfx.find((s) => s.id === e.target.value);
                            if (found) handleUpdateSfx(evt.id, { asset: found });
                          }}
                        >
                          {availableSfx.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.license})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* TriggerAt */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          Bắt đầu (s):
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max={Math.max(0, candidate.duration - 0.05)}
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                          value={evt.triggerAt}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            handleUpdateSfx(evt.id, { triggerAt: isNaN(val) ? 0 : val });
                          }}
                        />
                      </div>

                      {/* Duration */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          Thời lượng (s):
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="10"
                          placeholder="Hết file"
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                          value={evt.duration ?? ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            handleUpdateSfx(evt.id, { duration: isNaN(val) ? undefined : val });
                          }}
                        />
                      </div>

                      {/* Volume */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span>Âm lượng:</span>
                          <span style={{ fontWeight: 600 }}>{Math.round((evt.volume ?? 0.85) * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min="0.1"
                          max="1.8"
                          step="0.05"
                          style={{ width: '100%', cursor: 'pointer' }}
                          value={evt.volume ?? 0.85}
                          onChange={(e) => {
                            handleUpdateSfx(evt.id, { volume: parseFloat(e.target.value) });
                          }}
                        />
                      </div>

                      {/* Fade In */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          Fade in (s):
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max="1.5"
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                          value={evt.fadeIn ?? 0.05}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            handleUpdateSfx(evt.id, { fadeIn: isNaN(val) ? 0 : val });
                          }}
                        />
                      </div>

                      {/* Fade Out */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          Fade out (s):
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max="2.0"
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                          value={evt.fadeOut ?? 0.25}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            handleUpdateSfx(evt.id, { fadeOut: isNaN(val) ? 0 : val });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. BEATS & VISUAL OVERLAYS SECTION */}
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.95rem' }}>
              <Zap size={18} color="var(--accent-secondary)" />
              Timeline Beat & Meme Visual ({plan.beats.length} beats)
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleAddBeat} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
              <Plus size={13} /> Thêm Beat
            </button>
          </div>

          {plan.beats.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              Chưa có beat nào được gán cho đoạn này.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plan.beats.map((beat, idx) => {
                const linkedSfx = (plan.sfxEvents || []).filter((e) => e.sourceBeatId === beat.id);

                return (
                  <div
                    key={beat.id || idx}
                    style={{
                      background: 'rgba(15, 20, 32, 0.6)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {getBeatBadge(beat.beatType)}
                        <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                          @{beat.timestamp.toFixed(1)}s (kéo dài {beat.duration.toFixed(1)}s)
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                          Độ tin cậy: {Math.round(beat.confidence * 100)}%
                        </span>
                      </div>

                      <button
                        className="btn btn-danger btn-sm"
                        style={{ padding: '2px 6px' }}
                        onClick={() => handleDeleteBeat(idx)}
                        title="Xóa beat này"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Beat reason */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      "{beat.reason}"
                    </div>

                    {/* Controls */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 110px', gap: 10, alignItems: 'center' }}>
                      {/* Paired Meme */}
                      <div>
                        <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Film size={12} color="var(--accent-secondary)" />
                          Meme Overlay (Visual):
                        </label>
                        <select
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.8rem', padding: '4px 8px', marginTop: 2 }}
                          value={beat.meme?.id || ''}
                          onChange={(e) => {
                            const found = availableMemes.find((m) => m.id === e.target.value);
                            if (found) handleUpdateBeat(idx, { meme: found });
                          }}
                        >
                          {availableMemes.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.license})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Linked SFX Summary & Add button */}
                      <div>
                        <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Volume2 size={12} color="var(--status-warning)" />
                            SFX liên kết ({linkedSfx.length}):
                          </span>
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {linkedSfx.length === 0 ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                              Chưa có SFX tại beat này
                            </span>
                          ) : (
                            linkedSfx.map((s) => (
                              <span
                                key={s.id}
                                className="badge badge-secondary"
                                style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                                title={`@${s.triggerAt.toFixed(1)}s - Vol: ${Math.round(s.volume * 100)}%`}
                              >
                                {s.asset.name} (@{s.triggerAt.toFixed(1)}s)
                              </span>
                            ))
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '2px 6px', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                            onClick={() => handleAddSfx(beat.timestamp, beat.id)}
                            title="Thêm một SFX mới đồng bộ tại beat này"
                          >
                            <Plus size={10} /> + SFX tại beat này
                          </button>
                        </div>
                      </div>

                      {/* Timestamp Edit */}
                      <div>
                        <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} />
                          Mốc beat (s):
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max={Math.max(0, candidate.duration - 0.05)}
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.8rem', padding: '4px 8px', marginTop: 2 }}
                          value={beat.timestamp}
                          onChange={(e) => handleUpdateBeat(idx, { timestamp: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. LICENSING & ZERO-COST GUARANTEE */}
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.78rem',
            color: '#E2E8F0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={18} color="var(--status-success)" />
            <span>
              4 SFX mặc định là CC0 1.0 (Public Domain); các âm thanh từ repo hoặc tự nhập được gắn nhãn "Chưa xác nhận" bản quyền.
            </span>
          </div>
          <span style={{ color: 'var(--status-success)', fontWeight: 700 }}>
            Chi phí: 0 VNĐ
          </span>
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={handleSaveModal}>
            <Check size={15} /> Lưu Kế Hoạch Asset
          </button>
        </div>

        {/* SFX Persistent Library Management Modal */}
        <SfxLibraryModal
          isOpen={showLibraryModal}
          onClose={() => {
            setShowLibraryModal(false);
            handleRefreshSfxAssets();
            setLibraryChanged(true);
          }}
          onAssetChanged={() => {
            handleRefreshSfxAssets();
            setLibraryChanged(true);
          }}
        />
      </div>
    </div>
  );
};
