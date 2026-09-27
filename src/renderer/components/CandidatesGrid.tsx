import React, { useState } from 'react';
import { Sparkles, Plus, Film, X, Play, Wand2 } from 'lucide-react';
import { ClipCandidate } from '../../main/types';
import { CandidateCard } from './CandidateCard';
import { formatTime } from '../../shared/formatTime';

interface CandidatesGridProps {
  candidates: ClipCandidate[];
  sourceVideoPath: string;
  onUpdateCandidate: (updated: ClipCandidate) => void;
  onDeleteCandidate: (id: string) => void;
  onReorder: (candidates: ClipCandidate[]) => void;
  onAddManual: (candidate: ClipCandidate) => void;
  onStartRender: () => void;
  isRendering: boolean;
  onEditAssetPlan?: (candidate: ClipCandidate) => void;
}

export const CandidatesGrid: React.FC<CandidatesGridProps> = ({
  candidates,
  sourceVideoPath,
  onUpdateCandidate,
  onDeleteCandidate,
  onReorder,
  onAddManual,
  onStartRender,
  isRendering,
  onEditAssetPlan,
}) => {
  const [previewingCandidate, setPreviewingCandidate] = useState<ClipCandidate | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualTitle, setManualTitle] = useState('Đoạn shorts tùy chỉnh');
  const [manualStart, setManualStart] = useState('0');
  const [manualEnd, setManualEnd] = useState('30');

  const selectedCount = candidates.filter((c) => c.selected).length;

  const handleMoveUp = (idx: number) => {
    if (idx <= 0) return;
    const copy = [...candidates];
    const temp = copy[idx];
    copy[idx] = copy[idx - 1];
    copy[idx - 1] = temp;
    onReorder(copy);
  };

  const handleMoveDown = (idx: number) => {
    if (idx >= candidates.length - 1) return;
    const copy = [...candidates];
    const temp = copy[idx];
    copy[idx] = copy[idx + 1];
    copy[idx + 1] = temp;
    onReorder(copy);
  };

  const handleCreateManual = () => {
    const s = parseFloat(manualStart) || 0;
    const e = parseFloat(manualEnd) || 30;
    if (e > s) {
      const newCand: ClipCandidate = {
        id: `cand_manual_${Date.now()}`,
        title: manualTitle.trim() || 'Clip thủ công',
        start: s,
        end: e,
        duration: Math.round((e - s) * 100) / 100,
        score: 75,
        scoreBreakdown: { hook: 75, pacing: 75, payoff: 75 },
        reason: 'Đoạn clip do người dùng thêm thủ công theo ý muốn.',
        transcriptExcerpt: '(Đoạn chọn thủ công)',
        selected: true,
      };
      onAddManual(newCand);
      setShowAddModal(false);
    }
  };

  return (
    <div style={{ marginBottom: 30 }}>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={20} color="var(--accent-primary)" />
            3. Danh Sách Đề Xuất Shorts ({candidates.length} đoạn đã tìm thấy)
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>
            Đã chọn {selectedCount} / {candidates.length} clip. Bạn có thể sửa thời gian, sắp xếp thứ tự hoặc xóa bớt trước khi dựng.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={15} /> Thêm đoạn thủ công
          </button>

          <button
            className="btn btn-primary btn-lg"
            onClick={onStartRender}
            disabled={selectedCount === 0 || isRendering}
          >
            <Wand2 size={18} />
            Dựng {selectedCount} Clip Ngay
          </button>
        </div>
      </div>

      {/* Grid of candidate cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {candidates.map((cand, idx) => (
          <CandidateCard
            key={cand.id}
            candidate={cand}
            index={idx}
            totalCount={candidates.length}
            onUpdate={onUpdateCandidate}
            onDelete={onDeleteCandidate}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onPreview={(c) => setPreviewingCandidate(c)}
            onEditAssetPlan={onEditAssetPlan}
          />
        ))}

        {candidates.length === 0 && (
          <div className="glass-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)' }}>
            Chưa có đoạn đề xuất nào. Bấm "Phân Tích Video" ở trên để hệ thống tự động tìm các khoảnh khắc hay nhất.
          </div>
        )}
      </div>

      {/* Video Preview Modal */}
      {previewingCandidate && (
        <div className="modal-overlay" onClick={() => setPreviewingCandidate(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 750 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                Xem trước đoạn gốc: {previewingCandidate.title}
              </h4>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPreviewingCandidate(null)}
                style={{ padding: '4px 8px' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ position: 'relative', width: '100%', height: 400, background: '#000', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <video
                src={`file://${sourceVideoPath}#t=${previewingCandidate.start},${previewingCandidate.end}`}
                controls
                autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Thời gian: <strong>{formatTime(previewingCandidate.start)}</strong> đến <strong>{formatTime(previewingCandidate.end)}</strong> ({previewingCandidate.duration.toFixed(1)}s)
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => setPreviewingCandidate(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Add Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                Thêm Đoạn Shorts Thủ Công
              </h4>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAddModal(false)}
                style={{ padding: '4px 8px' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="input-label">Tên đoạn clip</label>
                <input
                  type="text"
                  className="text-input"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="input-label">Giây bắt đầu (s)</label>
                  <input
                    type="number"
                    className="text-input"
                    value={manualStart}
                    step="0.5"
                    onChange={(e) => setManualStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="input-label">Giây kết thúc (s)</label>
                  <input
                    type="number"
                    className="text-input"
                    value={manualEnd}
                    step="0.5"
                    onChange={(e) => setManualEnd(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Hủy
                </button>
                <button className="btn btn-primary" onClick={handleCreateManual}>
                  Thêm vào danh sách
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
