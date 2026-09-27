import React, { useState } from 'react';
import { Play, Trash2, ArrowUp, ArrowDown, Clock, Sparkles, Check, Edit2 } from 'lucide-react';
import { ClipCandidate } from '../../main/types';
import { formatTime } from '../../shared/formatTime';

interface CandidateCardProps {
  candidate: ClipCandidate;
  index: number;
  totalCount: number;
  onUpdate: (updated: ClipCandidate) => void;
  onDelete: (id: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onPreview: (candidate: ClipCandidate) => void;
}

export const CandidateCard: React.FC<CandidateCardProps> = ({
  candidate,
  index,
  totalCount,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onPreview,
}) => {
  const [isEditingTimes, setIsEditingTimes] = useState(false);
  const [startInput, setStartInput] = useState(candidate.start.toString());
  const [endInput, setEndInput] = useState(candidate.end.toString());

  const handleSaveTimes = () => {
    const s = parseFloat(startInput);
    const e = parseFloat(endInput);
    if (!isNaN(s) && !isNaN(e) && e > s) {
      onUpdate({
        ...candidate,
        start: s,
        end: e,
        duration: Math.round((e - s) * 100) / 100,
      });
      setIsEditingTimes(false);
    }
  };

  return (
    <div
      className="glass-card"
      style={{
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        background: candidate.selected ? 'var(--bg-card)' : 'rgba(15, 20, 32, 0.4)',
        borderColor: candidate.selected ? 'rgba(99, 102, 241, 0.3)' : 'var(--border-subtle)',
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="checkbox"
            checked={candidate.selected}
            onChange={(e) => onUpdate({ ...candidate, selected: e.target.checked })}
            style={{ width: 18, height: 18, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
          />
          <h4 style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
            {candidate.title}
          </h4>
          <span className="badge badge-score">
            ★ {candidate.score} điểm
          </span>
        </div>

        {/* Action icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            title="Di chuyển lên trên"
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onMoveDown(index)}
            disabled={index === totalCount - 1}
            title="Di chuyển xuống dưới"
          >
            <ArrowDown size={14} />
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => onDelete(candidate.id)}
            title="Xóa đoạn này"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ display: 'flex', gap: 18 }}>
        {/* Thumbnail with Play preview overlay */}
        <div
          style={{
            width: 140,
            height: 90,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: '#0F1420',
            position: 'relative',
            flexShrink: 0,
            cursor: 'pointer',
            border: '1px solid var(--border-subtle)',
          }}
          onClick={() => onPreview(candidate)}
          title="Bấm để xem thử đoạn gốc"
        >
          {candidate.thumbnailPath ? (
            <img
              src={`file://${candidate.thumbnailPath}`}
              alt="Thumbnail"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
              No Thumb
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.85)',
                color: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Play size={16} style={{ marginLeft: 2 }} />
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 4,
              right: 6,
              background: 'rgba(0, 0, 0, 0.8)',
              padding: '1px 5px',
              borderRadius: 3,
              fontSize: '0.68rem',
              fontFamily: 'var(--font-mono)',
              color: '#FFF',
            }}
          >
            {candidate.duration.toFixed(0)}s
          </div>
        </div>

        {/* Details & Badges */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Timestamps */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isEditingTimes ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <Clock size={14} color="var(--text-muted)" />
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                  {formatTime(candidate.start)} ({candidate.start.toFixed(1)}s) ➔ {formatTime(candidate.end)} ({candidate.end.toFixed(1)}s)
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                  ({candidate.duration.toFixed(1)} giây)
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                  onClick={() => setIsEditingTimes(true)}
                  title="Chỉnh sửa giây bắt đầu và kết thúc"
                >
                  <Edit2 size={11} /> Sửa mốc
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  className="text-input"
                  style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                  value={startInput}
                  step="0.5"
                  onChange={(e) => setStartInput(e.target.value)}
                  placeholder="Start (s)"
                />
                <span style={{ color: 'var(--text-dim)' }}>➔</span>
                <input
                  type="number"
                  className="text-input"
                  style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                  value={endInput}
                  step="0.5"
                  onChange={(e) => setEndInput(e.target.value)}
                  placeholder="End (s)"
                />
                <button className="btn btn-primary btn-sm" onClick={handleSaveTimes} style={{ padding: '4px 10px' }}>
                  <Check size={13} /> Lưu
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setIsEditingTimes(false)} style={{ padding: '4px 10px' }}>
                  Hủy
                </button>
              </div>
            )}
          </div>

          {/* Scores breakdown */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            <span className="badge badge-hook" title="Năng lượng và nhịp mở đầu 3-5 giây">
              Hook: {candidate.scoreBreakdown.hook}/100
            </span>
            <span className="badge badge-pacing" title="Nhịp độ lời nói, khoảng im lặng tự nhiên">
              Pacing: {candidate.scoreBreakdown.pacing}/100
            </span>
            <span className="badge badge-payoff" title="Mức độ trọn vẹn ngữ nghĩa khi kết thúc">
              Payoff: {candidate.scoreBreakdown.payoff}/100
            </span>
          </div>

          {/* Transcript excerpt */}
          <div
            style={{
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              background: 'rgba(0, 0, 0, 0.2)',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              marginTop: 4,
            }}
          >
            "{candidate.transcriptExcerpt}"
          </div>

          {/* Reason */}
          <div style={{ fontSize: '0.76rem', color: 'var(--text-dim)', marginTop: 2 }}>
            <strong>Đánh giá biên tập:</strong> {candidate.reason}
          </div>
        </div>
      </div>
    </div>
  );
};
