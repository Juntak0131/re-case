import { useEffect, useState } from 'react'
import { store } from '../api.js'

export default function Notebook({ game, flash, onJump, onAccuse }) {
  const memoKey = `recase.memo.${game.game_id}`
  const [memo, setMemo] = useState(() => store.get(memoKey, ''))
  const found = new Set(game.found_keys)
  const unlockedAt = Object.fromEntries(game.history.flatMap((e) => e.keys.map((k) => [k, e.n])))

  useEffect(() => store.set(memoKey, memo || null), [memo, memoKey])

  return (
    <section className="notebook" aria-label="수사 수첩">
      <h2>수사 수첩</h2>

      <div className="nb-block">
        <div className="nb-label">
          핵심 단서 <b>{found.size}</b> / {game.case.keys.length}
        </div>
        <ul className="keys">
          {game.case.keys.map((k) => {
            const on = found.has(k.id)
            return (
              <li key={k.id} className={`${on ? 'on' : ''} ${flash.includes(k.id) ? 'flash' : ''}`}>
                <span className="key-box" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                <span className="key-title">{k.title}</span>
                {on && unlockedAt[k.id] && (
                  <button className="key-q" onClick={() => onJump(unlockedAt[k.id])} title="이 단서를 밝힌 질문으로 이동">
                    Q{unlockedAt[k.id]}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="nb-hint">질문으로 확인한 핵심 단서에 표시돼요. 표시되지 않은 단서도 추리 제출 때 직접 써서 점수를 받을 수 있어요.</p>
      </div>

      <div className="nb-block nb-memo">
        <label className="nb-label" htmlFor="memo">
          내 메모
        </label>
        <textarea
          id="memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={'떠오르는 생각을 적어 두세요.\n예) 기계음 = 공장 안?'}
          maxLength={2000}
        />
      </div>

      <button className="btn red block accuse-btn" onClick={onAccuse}>
        추리 제출하기
      </button>
    </section>
  )
}
