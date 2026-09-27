import React from 'react';
import { ShieldCheck, Cpu, DollarSign, Check, X } from 'lucide-react';
import { JobSettings, ClipCandidate } from '../../main/types';

interface CostPreflightModalProps {
  settings: JobSettings;
  candidatesToRender: ClipCandidate[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const CostPreflightModal: React.FC<CostPreflightModalProps> = ({
  settings,
  candidatesToRender,
  onConfirm,
  onCancel,
}) => {
  const isPureLocal = settings.mode === 'local';

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h4 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={20} color="var(--status-success)" />
            Kế Hoạch & Xác Nhận Chi Phí Dựng (Pre-flight Check)
          </h4>
          <button className="btn btn-secondary btn-sm" onClick={onCancel} style={{ padding: '4px 8px' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Account card */}
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 18px',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 4 }}>TÀI KHOẢN & RUNTIME PROFILE</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Cpu size={16} color="var(--status-info)" />
              Cục bộ: Máy tính cá nhân (Apple Silicon / Mac)
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Endpoint đã kết nối: <code>media.local</code> (FFmpeg) + <code>hyperframes.local</code> (Chrome Headless)
            </div>
          </div>

          {/* Demanded Requests */}
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 18px',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 6 }}>DANH SÁCH YÊU CẦU DỰNG (BUILD PLAN)</div>
            <ul style={{ paddingLeft: 18, fontSize: '0.84rem', color: '#E2E8F0', lineHeight: 1.6 }}>
              <li>Số lượng clip: <strong>{candidatesToRender.length} clips shorts</strong></li>
              <li>Tỷ lệ khung hình: <strong>{settings.aspectRatio}</strong></li>
              <li>Phong cách preset: <strong>{settings.preset === 'reaction' ? 'Reaction / Streamer' : 'Documentary / Kể chuyện'}</strong></li>
              <li>Tự động căn chỉnh & gắn phụ đề: <strong>{settings.captions ? 'Bật' : 'Tắt'}</strong></li>
              <li>Nhạc nền (BGM Auto-Ducking): <strong>{settings.bgm ? 'Bật (Tự động giảm âm lượng khi có giọng nói, CC0 bản quyền)' : 'Tắt'}</strong></li>
              <li>Hiệu ứng Meme & SFX Beat: <strong>{settings.broll || settings.sfx ? 'Bật (Đồng bộ chính xác mốc Hook, Surprise, Reveal, Fail, Punchline)' : 'Tắt'}</strong></li>
            </ul>
          </div>

          {/* Cost box */}
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: '0.78rem', color: '#6EE7B7' }}>ƯỚC TÍNH CHI PHÍ</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--status-success)', fontFamily: 'var(--font-heading)' }}>
                0 VNĐ (100% Miễn phí)
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textAlign: 'right' }}>
              Không cần API key<br />Không gửi dữ liệu lên cloud
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={onCancel}>
              Quay lại chỉnh sửa
            </button>
            <button className="btn btn-primary" onClick={onConfirm}>
              <Check size={16} /> Xác nhận và Dựng Video
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
