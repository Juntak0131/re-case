import { useEffect } from 'react'
import FictionNote from './FictionNote.jsx'

const RULES = [
  '질문은 사건마다 20개까지 할 수 있어요.',
  '판정관은 예 · 아니오 · 관계없음 셋 중 하나로만 답해요.',
  '예/아니오로 답할 수 없는 질문과 이미 한 질문은 개수에 넣지 않아요.',
  '언제든 범인을 지목하고 추리를 제출할 수 있어요.',
]

export default function Gate({ caseInfo, busy, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="modal paper">
        <p className="modal-kicker">No.{caseInfo.number} · {caseInfo.title}</p>
        <h2 id="gate-title">수사를 시작하기 전에</h2>
        <FictionNote motif={caseInfo.motif} />
        <ul className="rules">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button className="btn red" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? '사건 파일 여는 중…' : '확인했어요, 수사 시작'}
          </button>
        </div>
      </div>
    </div>
  )
}
