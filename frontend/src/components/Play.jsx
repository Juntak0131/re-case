import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import Logo from './Logo.jsx'
import CaseFile from './CaseFile.jsx'
import Notebook from './Notebook.jsx'
import Accuse from './Accuse.jsx'

const MAX_LEN = 150
const STAMP = { YES: 'yes', NO: 'no', IRRELEVANT: 'irr' }

export default function Play({ game, setGame, health, onHome, onFinished }) {
  const c = game.case
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(null)
  const [notices, setNotices] = useState([]) // 기록에 남지 않는 안내 (형식 오류, 반복 질문, 오류)
  const [flash, setFlash] = useState([])
  const [panel, setPanel] = useState('qa') // 좁은 화면용 탭
  const [accusing, setAccusing] = useState(false)
  const [freshEntry, setFreshEntry] = useState(null)
  const logRef = useRef(null)
  const inputRef = useRef(null)

  const used = game.history.length
  const out = game.remaining <= 0

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [game.history.length, notices.length, pending])

  useEffect(() => {
    if (!flash.length) return
    const t = setTimeout(() => setFlash([]), 2600)
    return () => clearTimeout(t)
  }, [flash])

  const notice = (kind, text, question) =>
    setNotices((n) => [...n, { id: Date.now() + Math.random(), after: game.history.length, kind, text, question }])

  const ask = async (raw) => {
    const q = raw.replace(/\s+/g, ' ').trim()
    if (!q || pending || out) return
    setPending(q)
    setInput('')
    try {
      const r = await api.ask(game.game_id, q)
      if (r.status === 'answered') {
        setGame((g) => ({ ...g, history: [...g.history, r.entry], remaining: r.remaining, found_keys: r.found_keys }))
        setFreshEntry(r.entry.n)
        if (r.new_keys.length) setFlash(r.new_keys)
      } else if (r.status === 'repeat') {
        notice('repeat', `${r.message} 판정은 “${r.entry.label}”였어요.`, q)
      } else {
        notice('invalid', `${r.message} 질문 수에는 넣지 않았어요.`, q)
      }
    } catch (e) {
      notice('error', e.message, q)
      setInput(q)
    } finally {
      setPending(null)
      inputRef.current?.focus()
    }
  }

  const jump = (n) => {
    setPanel('qa')
    requestAnimationFrame(() => {
      const el = document.getElementById(`q-${n}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('pulse')
      void el.offsetWidth
      el.classList.add('pulse')
    })
  }

  const keyTitle = (id) => c.keys.find((k) => k.id === id)?.title

  const noticesAfter = (i) =>
    notices
      .filter((n) => n.after === i)
      .map((n) => (
        <div key={n.id} className={`notice ${n.kind}`}>
          {n.question && <p className="notice-q">“{n.question}”</p>}
          <p>{n.text}</p>
        </div>
      ))

  return (
    <div className="play">
      <header className="topbar">
        <button className="logo-btn" onClick={onHome} title="사건 목록으로">
          <Logo />
        </button>
        <div className="tb-case">
          <span className="tb-no">No.{c.number}</span>
          <strong>{c.title}</strong>
          <span className="chip">결말은 허구</span>
        </div>
        <div className="tb-count" aria-label={`남은 질문 ${game.remaining}개`}>
          <span className="tb-count-label">남은 질문</span>
          <b>{game.remaining}</b>
          <span className="tb-of">/ {game.max_questions}</span>
          <span className="dots" aria-hidden="true">
            {Array.from({ length: game.max_questions }, (_, i) => (
              <i key={i} className={i < game.remaining ? 'on' : ''} />
            ))}
          </span>
        </div>
      </header>

      <nav className="panel-tabs" role="tablist">
        {[
          ['file', '기록철'],
          ['qa', '질문실'],
          ['note', `수첩 ${game.found_keys.length}/${c.keys.length}`],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={panel === id} className={`${panel === id ? 'on' : ''} ${id === 'note' && flash.length ? 'ping' : ''}`} onClick={() => setPanel(id)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="board" data-panel={panel}>
        <div className="col col-file">
          <CaseFile c={c} />
        </div>

        <section className="col col-qa qa" aria-label="질문실">
          <header className="qa-head">
            <span className="judge-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7zm14 0-3 6a3 3 0 0 0 6 0l-3-6z" />
              </svg>
            </span>
            <div>
              <strong>AI 판정관</strong>
              <small>예 · 아니오 · 관계없음으로만 답합니다</small>
            </div>
          </header>

          <div className="qa-log" ref={logRef} aria-live="polite">
            <div className="intro">
              <p className="intro-q">
                <span>풀어야 할 질문</span>
                {c.question}
              </p>
              <p>
                저는 이 사건의 진실을 모두 알고 있어요. <b>예/아니오로 답할 수 있는 질문</b>만 해 주세요.
              </p>
              {used === 0 && (
                <div className="examples">
                  <span>이렇게 물어보세요</span>
                  {c.examples.map((ex) => (
                    <button key={ex} onClick={() => setInput(ex)} disabled={!!pending}>
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {health && !health.ai_ready && (
              <div className="notice error">
                <p>서버에 OpenAI API 키가 없어서 판정관이 답할 수 없어요. backend/.env를 확인해 주세요.</p>
              </div>
            )}
            {noticesAfter(0)}

            {game.history.map((e, i) => (
              <div key={e.n} className="turn" id={`q-${e.n}`}>
                <div className="bubble">
                  <span className="qn">Q{e.n}</span>
                  {e.question}
                </div>
                <div className={`verdict ${freshEntry === e.n ? 'fresh' : ''}`}>
                  <span className={`stamp ${STAMP[e.answer]}`}>{e.label}</span>
                  {e.keys.map((k) => (
                    <span key={k} className="key-found">
                      핵심 단서 확인 · {keyTitle(k)}
                    </span>
                  ))}
                </div>
                {noticesAfter(i + 1)}
              </div>
            ))}

            {pending && (
              <div className="turn">
                <div className="bubble pending-q">{pending}</div>
                <div className="verdict">
                  <span className="stamp wait">
                    판정 중<i className="dotdot" />
                  </span>
                </div>
              </div>
            )}

            {out && (
              <div className="notice end">
                <p>질문 {game.max_questions}개를 모두 썼어요. 이제 범인을 지목하고 추리를 제출해 주세요.</p>
                <button className="btn red" onClick={() => setAccusing(true)}>
                  추리 제출하기
                </button>
              </div>
            )}
          </div>

          <form
            className="qa-input"
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_LEN))}
              placeholder={out ? '질문을 모두 썼어요' : '예/아니오로 답할 수 있는 질문을 입력하세요'}
              disabled={out}
              aria-label="질문 입력"
              autoComplete="off"
            />
            <span className="qa-len">{input.length}/{MAX_LEN}</span>
            <button className="btn red" disabled={out || !!pending || !input.trim()}>
              질문하기
            </button>
          </form>
        </section>

        <div className="col col-note">
          <Notebook game={game} flash={flash} onJump={jump} onAccuse={() => setAccusing(true)} />
        </div>
      </div>

      {accusing && <Accuse game={game} onClose={() => setAccusing(false)} onFinished={onFinished} />}
    </div>
  )
}
