import React from 'react';
import { Sliders, Sparkles, Wand2, ShieldCheck, Film, Music, Type, Zap } from 'lucide-react';
import { JobSettings, AspectRatio, VideoPreset } from '../../main/types';

interface SettingsPanelProps {
  settings: JobSettings;
  onChange: (updated: JobSettings) => void;
  onAnalyze: () => void;
  disabled: boolean;
  isAnalyzing: boolean;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onChange,
  onAnalyze,
  disabled,
  isAnalyzing,
}) => {
  const update = <K extends keyof JobSettings>(key: K, value: JobSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="glass-card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sliders size={18} color="var(--accent-primary)" />
        2. Thiết Lập & Cấu Hình Định Dạng Shorts
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
        {/* Number of clips */}
        <div>
          <label className="input-label">Số lượng clip shorts mong muốn</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range"
              min="1"
              max="10"
              value={settings.targetClipCount}
              onChange={(e) => update('targetClipCount', Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
              disabled={disabled}
            />
            <span style={{ fontSize: '1rem', fontWeight: 700, minWidth: 40, textAlign: 'center' }}>
              {settings.targetClipCount} clips
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            Mặc định: 5 clip có điểm số kỹ thuật cao nhất
          </span>
        </div>

        {/* Clip Duration */}
        <div>
          <label className="input-label">Thời lượng mỗi clip (giây)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              className="text-input"
              style={{ width: 80 }}
              value={settings.clipDurationMin}
              min="15"
              max="90"
              onChange={(e) => update('clipDurationMin', Number(e.target.value))}
              disabled={disabled}
            />
            <span style={{ color: 'var(--text-dim)' }}>đến</span>
            <input
              type="number"
              className="text-input"
              style={{ width: 80 }}
              value={settings.clipDurationMax}
              min="20"
              max="120"
              onChange={(e) => update('clipDurationMax', Number(e.target.value))}
              disabled={disabled}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>giây</span>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            Đề xuất chuẩn: 30 - 45 giây tối ưu retention
          </span>
        </div>

        {/* Aspect Ratio */}
        <div>
          <label className="input-label">Tỷ lệ khung hình</label>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['9:16', '16:9'] as AspectRatio[]).map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={`btn btn-sm ${settings.aspectRatio === ratio ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '8px 12px' }}
                onClick={() => update('aspectRatio', ratio)}
                disabled={disabled}
              >
                {ratio === '9:16' ? '📱 9:16 (TikTok/Reels)' : '🖥️ 16:9 (Ngang)'}
              </button>
            ))}
          </div>
        </div>

        {/* Preset Style */}
        <div>
          <label className="input-label">Phong cách dựng (Preset)</label>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['reaction', 'documentary'] as VideoPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`btn btn-sm ${settings.preset === p ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '8px 12px' }}
                onClick={() => update('preset', p)}
                disabled={disabled}
              >
                {p === 'reaction' ? '⚡ Reaction / Stream' : '🎙️ Documentary / Kể chuyện'}
              </button>
            ))}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
            {settings.preset === 'reaction'
              ? 'Hook năng lượng đầu clip, cắt khoảng chết, zoom nhấn, chữ màu bắt mắt'
              : 'Nhịp điệu đều đặn, khung hình sạch, text box thông tin quan trọng'}
          </span>
        </div>
      </div>

      {/* Feature Toggles */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
        <label className="input-label" style={{ marginBottom: 10 }}>Các thành phần hiệu ứng (Bật / Tắt riêng):</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={settings.captions}
              onChange={(e) => update('captions', e.target.checked)}
              disabled={disabled}
            />
            <Type size={15} color="var(--accent-primary)" />
            Tự động tạo phụ đề (Captions)
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={settings.bgm}
              onChange={(e) => update('bgm', e.target.checked)}
              disabled={disabled}
            />
            <Music size={15} color="var(--status-info)" />
            Nhạc nền tự động giảm âm lượng (BGM Ducking)
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={settings.sfx}
              onChange={(e) => update('sfx', e.target.checked)}
              disabled={disabled}
            />
            <Zap size={15} color="var(--status-warning)" />
            Hiệu ứng âm thanh nhấn (SFX)
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={settings.broll}
              onChange={(e) => update('broll', e.target.checked)}
              disabled={disabled}
            />
            <Film size={15} color="var(--status-success)" />
            Chèn B-Roll / Minh họa có sẵn
          </label>
        </div>
      </div>

      {/* Mode Guarantee info */}
      <div
        style={{
          marginTop: 18,
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={20} color="var(--status-success)" />
          <span style={{ fontSize: '0.82rem', color: '#E2E8F0' }}>
            <strong>Chế độ: Local & Media có sẵn</strong> — 100% xử lý trên máy tính, không gửi video ra ngoài, không phát sinh chi phí API.
          </span>
        </div>

        <button
          className="btn btn-primary btn-lg"
          onClick={onAnalyze}
          disabled={disabled || isAnalyzing}
          style={{ minWidth: 200 }}
        >
          {isAnalyzing ? (
            <>
              <span className="pulse">●</span> Đang phân tích video...
            </>
          ) : (
            <>
              <Wand2 size={18} /> Phân Tích Video
            </>
          )}
        </button>
      </div>
    </div>
  );
};
