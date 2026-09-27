import React, { useState, useEffect, useRef } from 'react';
import {
  RotateCcw,
  XCircle,
  CheckCircle2,
  Clock,
  Terminal,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Play,
  FolderOpen
} from 'lucide-react';
import { LogEntry, RenderedClip } from '../../main/types';

interface RenderProgressProps {
  clips: RenderedClip[];
  logs: LogEntry[];
  onRetryClip: (clipId: string) => void;
  onCancelClip: (clipId: string) => void;
  onPreviewClip?: (outputPath: string) => void;
  onOpenFolder?: () => void;
}

export const RenderProgress: React.FC<RenderProgressProps> = ({
  clips,
  logs,
  onRetryClip,
  onCancelClip,
  onPreviewClip,
  onOpenFolder,
}) => {
  const [showLogs, setShowLogs] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current && showLogs) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  const completedCount = clips.filter((c) => c.status === 'completed').length;
  const overallPercent =
    clips.length > 0
      ? Math.round(
          clips.reduce((acc, c) => acc + (c.status === 'completed' ? 100 : c.progress), 0) /
            clips.length
        )
      : 0;

  const getStatusBadge = (status: RenderedClip['status']) => {
    switch (status) {
      case 'completed':
        return (
          <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <CheckCircle2 size={12} /> Đã Xong
          </span>
        );
      case 'rendering':
        return (
          <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#A5B4FC', border: '1px solid rgba(99, 102, 241, 0.4)' }}>
            <span className="pulse">●</span> Đang Dựng
          </span>
        );
      case 'planning':
        return (
          <span className="badge" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
            Lập Kế Hoạch Hypit
          </span>
        );
      case 'queued':
        return (
          <span className="badge" style={{ background: 'rgba(148, 163, 184, 0.15)', color: '#94A3B8', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
            <Clock size={12} /> Chờ Lượt
          </span>
        );
      case 'failed':
        return (
          <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#F87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <AlertCircle size={12} /> Thất Bại
          </span>
        );
      case 'canceled':
        return (
          <span className="badge" style={{ background: 'rgba(148, 163, 184, 0.15)', color: '#64748B', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
            <XCircle size={12} /> Đã Hủy
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="glass-card" style={{ marginBottom: 24 }}>
      {/* Top summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>
            Tiến Trình Dựng Video ({completedCount}/{clips.length} clip hoàn tất)
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 2 }}>
            Engine Hypit đang xử lý layout, crop reframe 9:16 và đồng bộ phụ đề.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onOpenFolder && (
            <button className="btn btn-secondary btn-sm" onClick={onOpenFolder}>
              <FolderOpen size={14} /> Mở thư mục kết quả
            </button>
          )}
          <span style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)' }}>
            {overallPercent}%
          </span>
        </div>
      </div>

      {/* Overall Progress Bar */}
      <div
        style={{
          width: '100%',
          height: 8,
          background: 'rgba(255, 255, 255, 0.06)',
          borderRadius: 9999,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${overallPercent}%`,
            background: 'var(--accent-gradient)',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* Per-clip list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {clips.map((clip) => (
          <div
            key={clip.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {getStatusBadge(clip.status)}
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{clip.title}</span>
              {clip.duration && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  ({clip.duration.toFixed(0)}s)
                </span>
              )}
              {clip.hdEnhanceFailed && (
                <span
                  className="badge"
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#F87171',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                  }}
                >
                  HD enhance failed, using normal render
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Progress for this clip */}
              {(clip.status === 'rendering' || clip.status === 'planning') && (
                <div style={{ width: 100, height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${clip.progress}%`, background: 'var(--accent-primary)', transition: 'width 0.2s' }} />
                </div>
              )}

              {/* Clip Actions */}
              {clip.status === 'completed' && clip.outputPath && onPreviewClip && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onPreviewClip(clip.outputPath!)}
                  title="Xem clip đã hoàn thành"
                >
                  <Play size={13} /> Xem trước
                </button>
              )}

              {(clip.status === 'failed' || clip.status === 'canceled') && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onRetryClip(clip.id)}
                  title="Thử dựng lại clip này"
                >
                  <RotateCcw size={13} /> Thử lại
                </button>
              )}

              {(clip.status === 'rendering' || clip.status === 'planning' || clip.status === 'queued') && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => onCancelClip(clip.id)}
                  title="Hủy dựng clip này"
                >
                  <XCircle size={13} /> Hủy
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Logs Console Drawer */}
      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: 12,
        }}
      >
        <button
          className="btn btn-secondary btn-sm"
          style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}
          onClick={() => setShowLogs(!showLogs)}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={14} /> Nhật ký thực thi (Hypit & Render Logs)
          </span>
          {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showLogs && (
          <div
            style={{
              maxHeight: 180,
              overflowY: 'auto',
              background: '#06080D',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {logs.map((log, i) => {
              const color =
                log.level === 'error'
                  ? '#F87171'
                  : log.level === 'warn'
                  ? '#FBBF24'
                  : '#94A3B8';
              return (
                <div key={i} style={{ color }}>
                  <span style={{ color: '#475569', marginRight: 6 }}>
                    [{log.timestamp.substring(11, 19)}]
                  </span>
                  {log.message}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
