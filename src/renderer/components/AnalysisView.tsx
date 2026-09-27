import React, { useState } from 'react';
import { FileText, Upload, Terminal, HelpCircle, CheckCircle, Clock } from 'lucide-react';
import { TranscriptSegment } from '../../main/types';
import { formatTime } from '../../shared/formatTime';

interface AnalysisViewProps {
  transcript: TranscriptSegment[];
  onUploadSrt: (content: string) => void;
  isAnalyzing: boolean;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  transcript,
  onUploadSrt,
  isAnalyzing,
}) => {
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [srtFileName, setSrtFileName] = useState<string | null>(null);

  const handleSelectSrt = async () => {
    try {
      const res = await window.electronAPI.selectSrtFile();
      if (res) {
        setSrtFileName(res.path.split('/').pop() || 'subtitles.srt');
        onUploadSrt(res.content);
      }
    } catch (err) {
      console.error('Failed to select SRT:', err);
    }
  };

  return (
    <div className="glass-card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={18} color="var(--accent-primary)" />
          Phân Tích Lời Thoại & Mốc Thời Gian (Transcript)
        </h3>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSelectSrt}
            title="Nhập file phụ đề SRT hoặc VTT có sẵn"
          >
            <Upload size={14} />
            {srtFileName ? `Đã nạp: ${srtFileName}` : 'Nhập file SRT / VTT'}
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSetupGuide(!showSetupGuide)}
          >
            <HelpCircle size={14} />
            Hướng dẫn Whisper Local
          </button>
        </div>
      </div>

      {/* Guide toggle */}
      {showSetupGuide && (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            marginBottom: 16,
            fontSize: '0.84rem',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--status-info)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Terminal size={16} /> Cấu hình mô hình nhận diện giọng nói cục bộ (Offline Whisper)
          </div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
            AutoClip Studio ưu tiên xử lý 100% trên thiết bị để đảm bảo quyền riêng tư và tốc độ.
          </p>
          <ol style={{ paddingLeft: 20, color: '#CBD5E1' }}>
            <li style={{ marginBottom: 4 }}>
              <strong>Nhập file SRT:</strong> Nếu bạn đã có phụ đề từ CapCut, Premiere, YouTube hoặc Whisper Web, bấm nút <em>"Nhập file SRT / VTT"</em> phía trên.
            </li>
            <li style={{ marginBottom: 4 }}>
              <strong>Tự động phân đoạn qua Audio Silence:</strong> Nếu không nhập SRT, công cụ sẽ tự động quét khoảng lặng bằng FFmpeg <code>silencedetect</code> để chia nhịp nói chính xác.
            </li>
            <li>
              <strong>Chạy Faster-Whisper bằng Terminal:</strong> Bạn có thể tạo file SRT nhanh bằng lệnh:
              <pre style={{ background: '#090D16', padding: '6px 10px', borderRadius: 4, margin: '6px 0', fontFamily: 'var(--font-mono)' }}>
                uvx faster-whisper video.mp4 --language vi --model small --output_format srt
              </pre>
            </li>
          </ol>
        </div>
      )}

      {/* Transcript segments display */}
      {isAnalyzing ? (
        <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text-muted)' }}>
          <div className="pulse" style={{ fontSize: '1.2rem', marginBottom: 8 }}>⚡</div>
          Đang quét dữ liệu âm thanh, phân tích nhịp nói và chia đoạn...
        </div>
      ) : transcript.length > 0 ? (
        <div
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {transcript.map((seg) => (
            <div
              key={seg.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                fontSize: '0.85rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                paddingBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: 'var(--accent-primary)',
                  background: 'rgba(99, 102, 241, 0.1)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTime(seg.start)} - {formatTime(seg.end)}
              </span>
              <span style={{ color: 'var(--text-main)', flex: 1 }}>{seg.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          Chưa có dữ liệu phân tích. Hãy chọn video và bấm <strong>"Phân Tích Video"</strong> để bắt đầu.
        </div>
      )}
    </div>
  );
};
