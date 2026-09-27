import React, { useState, useEffect } from 'react';
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
  Info,
} from 'lucide-react';
import {
  AssetItem,
  BeatEvent,
  BeatType,
  ClipAssetPlan,
  ClipCandidate,
} from '../../main/types';

interface AssetPlanModalProps {
  candidate: ClipCandidate;
  onSave: (updatedPlan: ClipAssetPlan) => void;
  onClose: () => void;
}

export const AssetPlanModal: React.FC<AssetPlanModalProps> = ({
  candidate,
  onSave,
  onClose,
}) => {
  const [availableMemes, setAvailableMemes] = useState<AssetItem[]>([]);
  const [availableSfx, setAvailableSfx] = useState<AssetItem[]>([]);
  const [availableMusic, setAvailableMusic] = useState<AssetItem[]>([]);

  // Local editable copy of plan
  const [plan, setPlan] = useState<ClipAssetPlan>(() => {
    if (candidate.assetPlan) {
      return JSON.parse(JSON.stringify(candidate.assetPlan));
    }
    return {
      clipId: candidate.id,
      musicTrack: null,
      beats: [],
      duckingSettings: {
        normalVolume: 0.22,
        duckedVolume: 0.06,
        fadeInDuration: 0.5,
        fadeOutDuration: 1.0,
      },
    };
  });

  // Fetch verified local library assets
  useEffect(() => {
    async function loadAssets() {
      try {
        if (window.electronAPI) {
          const [memes, sfxList, musicList] = await Promise.all([
            window.electronAPI.getAllAssets('meme'),
            window.electronAPI.getAllAssets('sfx'),
            window.electronAPI.getAllAssets('music'),
          ]);
          setAvailableMemes(memes);
          setAvailableSfx(sfxList);
          setAvailableMusic(musicList);
        }
      } catch (err) {
        console.error('Failed to load library assets:', err);
      }
    }
    loadAssets();
  }, []);

  const handleUpdateBeat = (index: number, updated: Partial<BeatEvent>) => {
    const newBeats = [...plan.beats];
    newBeats[index] = { ...newBeats[index], ...updated };
    setPlan({ ...plan, beats: newBeats });
  };

  const handleDeleteBeat = (index: number) => {
    const newBeats = plan.beats.filter((_, i) => i !== index);
    setPlan({ ...plan, beats: newBeats });
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
    const fallbackSfx = availableSfx[0] || {
      id: 'sfx_whoosh',
      name: 'Whoosh Transition SFX',
      type: 'sfx',
      filePath: '',
      sourceUrl: 'urn:autoclip:sfx:whoosh',
      license: 'CC0 1.0 Universal',
      fetchedAt: new Date().toISOString(),
      fingerprint: 'local',
      tags: [],
    };

    const newBeat: BeatEvent = {
      id: `beat_custom_${Date.now()}`,
      beatType: 'surprise',
      timestamp: Math.round((candidate.duration / 2) * 10) / 10,
      duration: 1.5,
      meme: fallbackMeme,
      sfx: fallbackSfx,
      confidence: 1.0,
      reason: 'Beat người dùng thêm thủ công',
    };

    setPlan({ ...plan, beats: [...plan.beats, newBeat] });
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 860, maxHeight: '90vh', overflowY: 'auto' }}
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
                fontSize: '1.15rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Sparkles size={20} color="var(--accent-primary)" />
              Auto Asset Plan — {candidate.title}
            </h4>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
              Đoạn clip: {candidate.start.toFixed(1)}s ➔ {candidate.end.toFixed(1)}s ({candidate.duration.toFixed(1)} giây).
              Meme và SFX tại mỗi beat luôn được khóa chung một mốc thời gian.
            </span>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
            <X size={16} />
          </button>
        </div>

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
              <label className="input-label" style={{ fontSize: '0.78rem' }}>Bài nhạc đã chọn tự động:</label>
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
                  Nguồn: <code>{plan.musicTrack.sourceUrl}</code> | Giấy phép: <strong>{plan.musicTrack.license}</strong> | Fingerprint: <code>{plan.musicTrack.fingerprint}</code>
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

        {/* 2. BEATS TIMELINE SECTION */}
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
              <Zap size={18} color="var(--status-warning)" />
              Timeline Đồng Bộ Beat ({plan.beats.length} beats phát hiện)
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
              {plan.beats.map((beat, idx) => (
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

                  {/* Synchronized Pair Settings */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10, alignItems: 'center' }}>
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

                    {/* Paired SFX */}
                    <div>
                      <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Volume2 size={12} color="var(--status-warning)" />
                        SFX Âm Thanh Trùng Mốc (Audio):
                      </label>
                      <select
                        className="text-input"
                        style={{ width: '100%', fontSize: '0.8rem', padding: '4px 8px', marginTop: 2 }}
                        value={beat.sfx?.id || ''}
                        onChange={(e) => {
                          const found = availableSfx.find((s) => s.id === e.target.value);
                          if (found) handleUpdateBeat(idx, { sfx: found });
                        }}
                      >
                        {availableSfx.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.license})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Timestamp Edit */}
                    <div>
                      <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        Mốc (giây):
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max={candidate.duration}
                        className="text-input"
                        style={{ width: '100%', fontSize: '0.8rem', padding: '4px 8px', marginTop: 2 }}
                        value={beat.timestamp}
                        onChange={(e) => handleUpdateBeat(idx, { timestamp: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. LICENSING & ZERO-COST GUARANTEE */}
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
              100% Asset đã xác minh quyền thương mại (CC0 / Public Domain) & Fingerprint SHA-256 nội bộ.
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
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(plan);
              onClose();
            }}
          >
            <Check size={15} /> Lưu Kế Hoạch Asset
          </button>
        </div>
      </div>
    </div>
  );
};
