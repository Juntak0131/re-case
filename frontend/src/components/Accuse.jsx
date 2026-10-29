import { useEffect, useState } from 'react'
import { api, store } from '../api.js'

const MAX = 1200

export default function Accuse({ game, onClose, onFinished }) {
  const draftKey = `recase.draft.${game.game_id}`
  const c = game.case
  const [culprit, setCulprit] = useState(() => store.get(draftKey, {}).culprit || '')
  const [text, setText] = useState(() => store.get(draftKey, {}).text || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => store.set(draftKey, { culprit, text }), [culprit, text, draftKey])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async () => {
    if (!culprit) return setError('지목할 인물을 골라 주세요.')
    setBusy(true)
    setError('')
    try {
      const result = await api.accuse(game.game_id, culprit, text.trim())
      store.set(draftKey, null)
      onFinished(result)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="accuse-title">
      <div className="modal paper wide">
        <p className="modal-kicker">No.{c.number} · {c.title}</p>
        <h2 id="accuse-title">추리 제출</h2>

        <fieldset className="suspects">
          <legend>{c.accuse_label}</legend>
          <div className="suspect-grid">
            {c.people.map((p) => (
              <label key={p.id} className={`suspect ${culprit === p.id ? 'on' : ''}`}>
                <input type="radio" name="culprit" value={p.id} checked={culprit === p.id} onChange={() => setCulprit(p.id)} />
                <span className="avatar" aria-hidden="true">
                  {p.name[0]}
                </span>
                <strong>{p.name}</strong>
                <small>{p.role}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="story-label" htmlFor="story">
          사건의 전말 <span>무엇을, 어떻게, 왜 했는지 아는 만큼 써 주세요.</span>
        </label>
        <div className="story-keys">
          {c.keys.map((k) => (
            <span key={k.id} className={game.found_keys.includes(k.id) ? 'on' : ''}>
              {k.title}
            </span>
          ))}
        </div>
        <textarea
          id="story"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          placeholder="위 핵심 단서 다섯 가지를 떠올리며 써 보세요. 질문으로 확인하지 못한 단서도 여기서 맞히면 점수를 받아요."
          rows={6}
        />
        <div className="story-count">
          {text.length} / {MAX}
        </div>

        <p className="score-rule">범인 40점 · 핵심 단서 하나당 12점 · 제출하면 수사가 끝나고 진실이 공개돼요.</p>
        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            더 수사하기
          </button>
          <button className="btn red" onClick={submit} disabled={busy || !culprit}>
            {busy ? '채점 중…' : '제출하고 진실 보기'}
          </button>
        </div>
      </div>
    </div>
  )
}
