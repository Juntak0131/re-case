import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, copyText, shareLink } from '../api.js'
import Logo from './Logo.jsx'
import FictionNote from './FictionNote.jsx'
import { DetectiveBadge, RainToggle } from './Chrome.jsx'

const METHOD = [
  ['사건 기록을 읽는다', '개요 · 증거 · 인물 기록에서 수상한 점을 찾아요.'],
  ['예/아니오로 묻는다', '진실을 아는 판정관에게 질문 20개까지 던질 수 있어요.'],
  ['범인을 지목한다', '사건의 전말을 쓰면 채점과 함께 진실이 공개돼요.'],
]
const REGION = { world: '해외', korea: '한국' }
// 증거 보드에 꽂힌 종이의 생김새 (신문 스크랩 · 수사 보고서 · 서류철)
const PAPER = ['news', 'report', 'file', 'report', 'news', 'file']
// 사건끼리 이어 둔 실 (사건 id, 사건 id, 손글씨 메모)
const LINKS = [
  ['zodiac', 'ripper', '편지'],
  ['bermuda', 'alcatraz', '바다'],
]

function status(c) {
  if (c.kind === 'user') return '사용자 사건'
  return c.solved ? '진범 확인' : '미제'
}

export function CaseCard({ c, paper = 'file', slot, lit = false, saved, onStart, onResume, children }) {
  return (
    <article className={`bcard ${paper} ${slot != null ? `slot-${slot}` : ''} ${lit ? 'lit' : ''}`} data-case={c.id}>
      <span className="pin-anchor" aria-hidden="true" />
      <p className="bc-no">No.{c.number}</p>
      <h3>{c.title}</h3>
      <p className="bc-teaser">{c.teaser}</p>
      <p className="bc-tags">
        {REGION[c.region] && <span>{REGION[c.region]}</span>}
        <span className={c.solved ? 'solved' : ''}>{status(c)}</span>
        {c.difficulty && <span className={`bc-diff ${c.difficulty === '어려움' ? 'hard' : ''}`}>{c.difficulty}</span>}
        {c.kind === 'user' && typeof c.plays === 'number' && <span>{c.plays}명 수사</span>}
      </p>
      <div className="bc-actions">
        {saved ? (
          <>
            <button className="btn red small" onClick={() => onResume(c)}>
              이어서 수사
            </button>
            <button className="btn ghost-dark small" onClick={() => onStart(c)}>
              처음부터
            </button>
          </>
        ) : (
          <button className="btn red small bc-open" onClick={() => onStart(c)} aria-label={`${c.title} 수사 시작`}>
            수사 시작
          </button>
        )}
        {children}
      </div>
    </article>
  )
}

// 사건 카드 압정과 가운데 메모를 빨간 실로 잇는다
function useStrings(boardRef, deps) {
  const [lines, setLines] = useState({ w: 0, h: 0, paths: [] })

  const measure = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const box = board.getBoundingClientRect()
    const point = (el) => {
      const r = el.getBoundingClientRect()
      return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]
    }
    const hubEl = board.querySelector('.board-hub')
    const pins = Object.fromEntries([...board.querySelectorAll('.bcard')].map((el) => [el.dataset.case, point(el.querySelector('.pin-anchor'))]))
    if (!hubEl || getComputedStyle(board).getPropertyValue('--strings').trim() === 'off') {
      setLines({ w: box.width, h: box.height, paths: [] })
      return
    }
    // 가운데 메모에는 위아래로 압정이 하나씩: 위쪽 카드는 위 압정, 아래쪽 카드는 아래 압정으로
    const hubTop = point(hubEl.querySelector('.pin-anchor.top'))
    const hubBottom = point(hubEl.querySelector('.pin-anchor.bottom'))
    const hubY = (hubTop[1] + hubBottom[1]) / 2
    const curve = ([x1, y1], [x2, y2], k) => {
      const d = Math.hypot(x2 - x1, y2 - y1)
      const cy = (y1 + y2) / 2 + d * k
      return { d: `M${x1},${y1} Q${(x1 + x2) / 2},${cy} ${x2},${y2}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2 + (d * k) / 2] }
    }
    const paths = Object.entries(pins).map(([id, p]) => {
      const h = p[1] < hubY ? hubTop : hubBottom
      return { id, d: curve(p, h, 0.1).d, ends: [p, h] }
    })
    LINKS.forEach(([a, b, label]) => {
      if (!pins[a] || !pins[b]) return
      // 두 카드 사이의 실은 가운데 쪽으로 늘어진다
      const toward = (pins[a][1] + pins[b][1]) / 2 < hubY ? 1 : -1
      const c = curve(pins[a], pins[b], 0.16 * toward)
      paths.push({ id: `${a}-${b}`, d: c.d, label, at: [c.mid[0], c.mid[1] + (toward > 0 ? 22 : -10)], ends: [pins[a], pins[b]] })
    })
    setLines({ w: box.width, h: box.height, paths })
  }, [boardRef])

  useLayoutEffect(() => {
    measure()
    const board = boardRef.current
    if (!board) return
    const ro = new ResizeObserver(measure)
    ro.observe(board)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps])

  return lines
}

export default function Home({ cases, health, error, saved, mine, detective, rain, onDetective, onRain, onRetry, onStart, onResume, onOpenCode, onStudio, onForget, onReview, toast }) {
  const [code, setCode] = useState('')
  const [mineInfo, setMineInfo] = useState({})
  const [lit, setLit] = useState(null) // 조명을 비춘 사건
  const [opening, setOpening] = useState(null) // 막 고른 사건 (조명이 환해지는 중)
  const wallRef = useRef(null)
  const beamRef = useRef(null)
  const boardRef = useRef(null)

  useEffect(() => {
    let alive = true
    mine.forEach((m) => {
      api
        .caseSummary(m.id)
        .then((s) => alive && setMineInfo((prev) => ({ ...prev, [m.id]: s })))
        .catch((e) => alive && e.status === 404 && setMineInfo((prev) => ({ ...prev, [m.id]: 'gone' })))
    })
    return () => {
      alive = false
    }
  }, [mine])

  const world = cases?.filter((c) => c.region === 'world') || []
  const korea = cases?.filter((c) => c.region === 'korea') || []
  // 왼쪽 두 줄은 해외, 오른쪽 줄은 한국 사건
  const board = [world[0], world[1], korea[0], world[2], world[3], korea[1], ...world.slice(4), ...korea.slice(2)].filter(Boolean)
  const lines = useStrings(boardRef, [board.length])
  const share = async (id) => toast((await copyText(shareLink(id))) ? '공유 링크를 복사했어요.' : shareLink(id))

  // 조명: 평소엔 가운데 메모만 희미하게, 사건 카드를 가리키면 그 카드로 불빛이 옮겨 가 밝아진다
  useLayoutEffect(() => {
    const wall = wallRef.current
    const beam = beamRef.current
    const boardEl = boardRef.current
    if (!wall || !beam || !boardEl) return
    const r = beam.getBoundingClientRect()
    const target = (lit && boardEl.querySelector(`.bcard[data-case="${lit}"]`)) || boardEl.querySelector('.board-hub')
    if (!target) return
    const t = target.getBoundingClientRect()
    const size = Math.max(t.width, t.height)
    const radius = !lit ? size * 0.95 : opening ? size * 2.2 : size * 0.98
    wall.style.setProperty('--fx', `${t.left + t.width / 2 - r.left}px`)
    wall.style.setProperty('--fy', `${t.top + t.height / 2 - r.top}px`)
    wall.style.setProperty('--rest', `${Math.round(radius)}px`)
    wall.style.setProperty('--ax', (t.width / size).toFixed(3))
    wall.style.setProperty('--ay', (t.height / size).toFixed(3))
  }, [lit, opening, lines, cases])

  // 휴대폰: 화면 가운데에 온 카드에 불이 들어온다
  useEffect(() => {
    const boardEl = boardRef.current
    if (!boardEl || !window.matchMedia?.('(max-width: 760px)').matches || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setLit(e.target.dataset.case)),
      { rootMargin: '-42% 0px -42% 0px' },
    )
    boardEl.querySelectorAll('.bcard').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [board.length])

  const pointAt = (e) => {
    if (e.pointerType !== 'mouse') return
    const card = e.target.closest('.bcard')
    if (card && card.dataset.case !== lit) setLit(card.dataset.case)
  }
  const focusAt = (e) => {
    const card = e.target.closest('.bcard')
    if (card) setLit(card.dataset.case)
  }
  const leave = (e) => {
    if (opening || window.matchMedia?.('(max-width: 760px)').matches) return
    if (e.type === 'blur' && boardRef.current?.contains(e.relatedTarget)) return
    setLit(null)
  }

  // 사건을 고르면 그 카드 위 조명이 확 밝아진 뒤 기록이 열린다
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const lightUp = (fn) => (c) => {
    if (reduceMotion) return fn(c)
    if (opening) return
    setLit(c.id)
    setOpening(c.id)
    setTimeout(() => {
      setOpening(null)
      fn(c)
    }, 560)
  }
  const startLit = lightUp(onStart)
  const resumeLit = lightUp(onResume)

  return (
    <div className="home">
      <header className="strip">
        <Logo />
        <div className="strip-tools">
          <button className="rain-btn" onClick={onReview} title="RE:CASE 후기 설문">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
              <path d="M6 3.5h9l3 3v14H6z" />
              <path d="M9 10h6M9 13.5h6M9 17h3.5" strokeLinecap="round" />
            </svg>
            <span>후기 남기기</span>
          </button>
          <RainToggle on={rain} onToggle={onRain} />
          <DetectiveBadge name={detective} onChange={onDetective} />
        </div>
      </header>

      <section className={`wall ${opening ? 'opening' : ''} ${lit ? 'is-lit' : ''}`} ref={wallRef} aria-label="사건 증거 보드">
        <div className="wall-head">
          <h1 className="wall-title">
            닫힌 사건을
            <br />
            다시 연다
          </h1>
          <p className="wall-lead">
            진실을 모두 아는 판정관은 “예”, “아니오”, “관계없음”으로만 답합니다. 질문 20개로 범인과 사건의 전말을 밝혀내세요.
          </p>
          <ol className="method">
            {METHOD.map(([t, d]) => (
              <li key={t}>
                <strong>{t}</strong>
                <span>{d}</span>
              </li>
            ))}
          </ol>
          <button className="btn ghost-dark" onClick={() => onStudio('ai')}>
            직접 사건 만들기
          </button>
        </div>

        <div
          className={`board ${lit ? 'has-lit' : ''}`}
          ref={boardRef}
          id="cases"
          onPointerOver={pointAt}
          onPointerLeave={leave}
          onFocusCapture={focusAt}
          onBlurCapture={leave}
        >
          {!cases && !error && <p className="board-wait">사건 기록을 꺼내는 중…</p>}
          {cases && (
            <div className="board-hub">
              <span className="pin-anchor top" aria-hidden="true" />
              <span className="pin-anchor bottom" aria-hidden="true" />
              <p>다시 열린 사건</p>
              <b>{cases.length}건</b>
            </div>
          )}
          {board.map((c, i) => (
            <CaseCard key={c.id} c={c} paper={PAPER[i % PAPER.length]} slot={i} lit={lit === c.id} saved={saved[c.id]} onStart={startLit} onResume={resumeLit} />
          ))}
          <svg className="strings" width={lines.w} height={lines.h} aria-hidden="true">
            <defs>
              <radialGradient id="pinhead" cx="35%" cy="30%" r="70%">
                <stop offset="0" stopColor="#e2685c" />
                <stop offset=".55" stopColor="#8d1d18" />
                <stop offset="1" stopColor="#3f0a08" />
              </radialGradient>
            </defs>
            {lines.paths.map((p) => (
              <g key={p.id}>
                <path d={p.d} className="string-shadow" />
                <path d={p.d} className={`string ${lit && p.id.split('-').includes(lit) ? 'hot' : ''}`} />
                {p.label && (
                  <text x={p.at[0]} y={p.at[1] - 8} className="string-note">
                    {p.label}
                  </text>
                )}
              </g>
            ))}
            {[...new Map(lines.paths.flatMap((p) => p.ends).map((e) => [e.join(','), e])).values()].map(([x, y]) => (
              <g key={`${x},${y}`}>
                <ellipse cx={x + 2} cy={y + 4} rx="7" ry="4" className="pin-shadow" />
                <circle cx={x} cy={y} r="7" fill="url(#pinhead)" />
              </g>
            ))}
          </svg>
        </div>
        <div className="beam" ref={beamRef} aria-hidden="true" />
      </section>

      <main className="home-main">
        {health && !health.ai_ready && (
          <div className="banner warn">
            서버에 OpenAI API 키가 설정되지 않았어요. <code>backend/.env</code>에 <code>OPENAI_API_KEY</code>를 넣고 서버를 다시 켜면
            질문할 수 있어요.
          </div>
        )}
        {error && (
          <div className="banner warn">
            {error}{' '}
            <button className="link" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        )}

        <FictionNote />

        <section className="section">
          <div className="section-head">
            <h2>사건 제작실</h2>
            <p>내가 만든 미스터리를 친구에게 링크로 보내 보세요. 받은 사람은 진실을 모른 채 바로 수사할 수 있어요.</p>
          </div>
          <div className="studio-cta">
            <button className="cta-card" onClick={() => onStudio('ai')}>
              <strong>키워드로 AI가 만들기</strong>
              <span>시대 · 장소 · 분위기만 고르면 AI가 사건 파일과 진실까지 설계해요.</span>
            </button>
            <button className="cta-card" onClick={() => onStudio('manual')}>
              <strong>직접 쓰고 AI로 검사</strong>
              <span>사건과 진실을 직접 쓰면 AI가 모순과 빠진 사실을 찾아 줘요.</span>
            </button>
            <form
              className="cta-card cta-code"
              onSubmit={(e) => {
                e.preventDefault()
                onOpenCode(code)
              }}
            >
              <strong>공유 코드로 열기</strong>
              <span>친구에게 받은 사건 코드를 넣어 주세요.</span>
              <div className="code-open">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: u7k2m9pq" aria-label="사건 코드" maxLength={12} />
                <button className="btn red small" disabled={!code.trim()}>
                  열기
                </button>
              </div>
            </form>
          </div>
        </section>

        {mine.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>내가 만든 사건</h2>
              <p>수정 키는 이 브라우저에만 저장돼요. 다른 기기에서는 수정할 수 없어요.</p>
            </div>
            <div className="case-grid">
              {mine.map((m) => {
                const info = mineInfo[m.id]
                if (info === 'gone')
                  return (
                    <div key={m.id} className="cta-card">
                      <strong>{m.title}</strong>
                      <span>서버에서 사라진 사건이에요.</span>
                      <button className="btn ghost-dark small" onClick={() => onForget(m.id)}>
                        목록에서 지우기
                      </button>
                    </div>
                  )
                const c = info || { id: m.id, kind: 'user', number: m.id.toUpperCase(), title: m.title, era: '', type: '', difficulty: '', teaser: '불러오는 중…', basis: m.source }
                return (
                  <CaseCard key={m.id} c={c} paper="file" saved={saved[m.id]} onStart={onStart} onResume={onResume}>
                    <button className="btn ghost-dark small" onClick={() => share(m.id)}>
                      링크 복사
                    </button>
                    <button className="btn ghost-dark small" onClick={() => onStudio('manual', m)}>
                      편집
                    </button>
                  </CaseCard>
                )
              })}
            </div>
          </section>
        )}
      </main>

      <footer className="home-foot">
        RE:CASE · 한준탁 · 실제 사건을 바탕으로 재구성한 게임이며, 등장인물 이름은 가상이고 풀리지 않은 사건의 결말은 허구입니다.
      </footer>
    </div>
  )
}
