import { useCallback, useEffect, useRef, useState } from 'react'
import { api, copyText } from '../api.js'
import Logo from './Logo.jsx'

const KEY = 'recase.admin' // 관리자 비밀번호: 이 탭을 닫으면 지워진다
const REFRESH = 60 // 자동 새로고침 간격(초)

const session = {
  get() {
    try {
      return sessionStorage.getItem(KEY) || ''
    } catch {
      return ''
    }
  },
  set(v) {
    try {
      if (v) sessionStorage.setItem(KEY, v)
      else sessionStorage.removeItem(KEY)
    } catch {
      /* 무시 */
    }
  },
}

const fmt = (v) => (v == null ? '–' : v.toFixed(2))
const clock = (d) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const day = (s) => (s ? s.slice(5, 16).replace('-', '.') : '')

function Gate({ busy, error, onOpen }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="ad-gate paper"
      onSubmit={(e) => {
        e.preventDefault()
        if (value) onOpen(value)
      }}
    >
      <p className="modal-kicker">관리자 전용</p>
      <h1>후기 관리</h1>
      <p>Render에 넣어 둔 관리자 비밀번호(ADMIN_PASSWORD)를 입력하세요.</p>
      <label className="field">
        <span>관리자 비밀번호</span>
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      {error && <p className="rv-error">{error}</p>}
      <button className="btn red block" disabled={busy || !value}>
        {busy ? '확인 중…' : '열기'}
      </button>
    </form>
  )
}

function Meter({ value, label }) {
  return (
    <span className="ad-meter" role="img" aria-label={label} data-tip={label}>
      <i style={{ width: `${value == null ? 0 : (value / 5) * 100}%` }} />
    </span>
  )
}

function Dist({ dist, scale }) {
  const top = Math.max(1, ...dist)
  return (
    <span className="ad-dist" role="img" aria-label={dist.map((n, i) => `${i + 1}점 ${n}명`).join(', ')}>
      {dist.map((n, i) => (
        <span key={i} className="ad-col" data-tip={`${i + 1}점 ${scale[i]} · ${n}명`}>
          <i style={{ height: `${n ? Math.max(3, (n / top) * 26) : 2}px` }} className={n ? '' : 'zero'} />
          <small>{i + 1}</small>
        </span>
      ))}
    </span>
  )
}

function Counts({ title, items, total }) {
  const top = Math.max(1, ...items.map((i) => i.n))
  return (
    <section className="ad-panel">
      <h3>{title}</h3>
      <ul className="ad-counts">
        {items.map((it) => (
          <li key={it.label} data-tip={`${it.label} · ${it.n}명${total ? ` (${Math.round((it.n / total) * 100)}%)` : ''}`}>
            <span className="ad-cl">{it.label}</span>
            <span className="ad-bar">
              <i style={{ width: `${(it.n / top) * 100}%` }} />
            </span>
            <b>{it.n}명</b>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Row({ r, questions, open, fresh, onToggle }) {
  return (
    <>
      <tr className={`${open ? 'open' : ''} ${fresh ? 'fresh' : ''}`} onClick={onToggle}>
        <td className="ad-name">
          {r.no}번
          {fresh && <span className="ad-new">새 응답</span>}
        </td>
        <td className="ad-time">{r.submitted_at.slice(0, 16)}</td>
        <td className="ad-cases">{r.cases.join(', ')}</td>
        <td>{r.studio_used}</td>
        <td className="ad-num">{fmt(r.avg)}</td>
        <td className="ad-more">
          <button className="link" aria-expanded={open} onClick={(e) => (e.stopPropagation(), onToggle())}>
            {open ? '접기' : '자세히'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="ad-detail">
          <td colSpan={6}>
            <p className="ad-meta">추리물: {r.freq}</p>
            <ol className="ad-answers">
              {questions.map((q, i) => (
                <li key={q.id} className={r[q.id] == null ? 'none' : ''}>
                  <span className="ad-an">{i + 1}</span>
                  <span>{q.text}</span>
                  <b>{r[q.id] == null ? '응답 없음' : `${r[q.id]}점`}</b>
                </li>
              ))}
            </ol>
            <div className="ad-says">
              <p>
                <span>좋았던 점</span>
                {r.best || '없음'}
              </p>
              <p>
                <span>고칠 점</span>
                {r.improve || '없음'}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function Admin({ onHome, toast }) {
  const [pw, setPw] = useState('')
  const [checking, setChecking] = useState(() => !!session.get())
  const [gateError, setGateError] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(true)
  const [left, setLeft] = useState(REFRESH)
  const [loadedAt, setLoadedAt] = useState(null)
  const [fresh, setFresh] = useState(() => new Set())
  const [open, setOpen] = useState(() => new Set())
  const [tab, setTab] = useState('all')
  const seen = useRef(null)
  const busy = useRef(false)
  const nextAt = useRef(0)

  const lock = useCallback((message = '') => {
    session.set('')
    seen.current = null
    setPw('')
    setData(null)
    setGateError(message)
  }, [])

  const load = useCallback(
    async (password) => {
      if (busy.current) return
      busy.current = true
      setLoading(true)
      try {
        const d = await api.admin.list(password)
        const ids = d.responses.map((r) => r.id)
        if (seen.current) {
          const added = ids.filter((id) => !seen.current.has(id))
          setFresh(new Set(added))
          if (added.length) toast(`새 응답 ${added.length}건이 들어왔어요.`)
        }
        seen.current = new Set(ids)
        session.set(password)
        setPw(password)
        setData(d)
        setError('')
        setGateError('')
        setLoadedAt(new Date())
      } catch (e) {
        if (e.status === 401 || e.status === 503 || (e.status === 429 && !seen.current)) lock(e.message)
        else if (!seen.current) setGateError(e.message)
        else setError(`새로고침하지 못했어요. ${e.message}`)
      } finally {
        busy.current = false
        nextAt.current = Date.now() + REFRESH * 1000
        setLeft(REFRESH)
        setLoading(false)
        setChecking(false)
      }
    },
    [lock, toast],
  )

  useEffect(() => {
    const saved = session.get()
    if (saved) load(saved)
  }, [load])

  // 1분마다 다시 불러온다. 탭이 가려져 있는 동안은 멈췄다가 돌아오면 바로 갱신한다.
  useEffect(() => {
    if (!pw || !auto) return
    const tick = () => {
      if (document.hidden) return
      const remain = Math.max(0, Math.ceil((nextAt.current - Date.now()) / 1000))
      setLeft(remain)
      if (remain <= 0) load(pw)
    }
    const t = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [pw, auto, load])

  const toggleAuto = () => {
    nextAt.current = Date.now() + REFRESH * 1000
    setLeft(REFRESH)
    setAuto((v) => !v)
  }

  const download = async () => {
    try {
      const blob = await api.admin.csv(pw)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const d = new Date()
      a.href = url
      a.download = `RE-CASE_후기_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      if (e.status === 401) lock(e.message)
      else toast(e.message)
    }
  }

  const surveyUrl = `${window.location.origin}/review`
  const copySurvey = async () => toast((await copyText(surveyUrl)) ? '설문 주소를 복사했어요.' : '복사하지 못했어요. 주소를 직접 선택해 주세요.')

  if (!pw)
    return (
      <div className="admin">
        <header className="page-top">
          <button className="logo-btn" onClick={onHome} title="사건 목록으로">
            <Logo />
          </button>
        </header>
        <main className="ad-gate-wrap">
          {checking ? <p className="rv-loading">확인 중…</p> : <Gate busy={loading} error={gateError} onOpen={load} />}
        </main>
      </div>
    )

  const s = data.summary
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const said = data.responses.filter((r) => (tab === 'best' ? r.best : tab === 'improve' ? r.improve : r.best || r.improve))

  return (
    <div className="admin">
      <header className="ad-top">
        <button className="logo-btn" onClick={onHome} title="사건 목록으로">
          <Logo />
        </button>
        <div className="ad-tools">
          <span className="ad-clock" role="status">
            {auto ? `${left}초 뒤 자동 새로고침` : '자동 새로고침 꺼짐'}
            {loadedAt && <em>마지막 갱신 {clock(loadedAt)}</em>}
          </span>
          <button className={`rain-btn ${auto ? 'on' : ''}`} aria-pressed={auto} onClick={toggleAuto}>
            {auto ? '자동 새로고침 끄기' : '자동 새로고침 켜기'}
          </button>
          <button className="btn ghost-dark small" onClick={() => load(pw)} disabled={loading}>
            {loading ? '불러오는 중…' : '지금 새로고침'}
          </button>
          <button className="btn ghost-dark small" onClick={download} disabled={!s.total}>
            CSV 내려받기
          </button>
          <button className="btn ghost-dark small" onClick={() => lock()}>
            잠그기
          </button>
        </div>
        {auto && (
          <span className="ad-tick" aria-hidden="true">
            <i style={{ transform: `scaleX(${left / REFRESH})` }} />
          </span>
        )}
      </header>

      <main className="ad-main">
        <div className="ad-head">
          <div>
            <h1 className="studio-title">후기 관리</h1>
            <p className="studio-lead">
              {s.total ? `${day(s.first)} ~ ${day(s.last)} 사이에 들어온 응답 ${s.total}건` : '아직 들어온 응답이 없어요.'}
            </p>
          </div>
          <div className="ad-share">
            <span>설문 주소</span>
            <code>{surveyUrl}</code>
            <button className="btn ghost-dark small" onClick={copySurvey}>
              복사
            </button>
          </div>
        </div>

        {data.store === 'local' ? (
          <p className="banner warn">
            지금은 서버 임시 저장소에 쌓이고 있어요. Render 무료 서버가 잠들면 지워지니, Render 환경변수에 TiDB 접속 정보(TIDB_HOST 등)를 넣어 주세요.
          </p>
        ) : (
          <p className="ad-store">응답은 TiDB Cloud에 저장돼요. 서버가 잠들거나 다시 배포돼도 남아 있어요.</p>
        )}
        {error && <p className="banner warn">{error}</p>}

        <section className="ad-stats">
          <div>
            <span>응답</span>
            <b>{s.total}</b>
            <em>명</em>
          </div>
          <div>
            <span>전반적 만족 (12번)</span>
            <b>{fmt(s.overall)}</b>
            <em>/ 5</em>
          </div>
          <div>
            <span>추천 의향 (13번)</span>
            <b>{fmt(s.recommend)}</b>
            <em>/ 5</em>
          </div>
          <div>
            <span>전체 문항 평균</span>
            <b>{fmt(s.mean_of_questions)}</b>
            <em>/ 5</em>
          </div>
        </section>

        <div className="ad-grid">
          <section className="ad-panel ad-questions">
            <h3>문항별 평균</h3>
            <p className="ad-legend">막대는 5점 만점 평균, 오른쪽 작은 막대는 1~5점을 고른 사람 수예요.</p>
            <ol>
              {s.questions.map((q, i) => (
                <li key={q.id}>
                  <span className="ad-qn">{i + 1}</span>
                  <span className="ad-qt">
                    {q.text}
                    {!q.required && <em> (사건 제작실을 써 본 사람만)</em>}
                  </span>
                  <span className="ad-qv">
                    <Meter value={q.avg} label={`${i + 1}번 평균 ${fmt(q.avg)}점 · ${q.n}명 응답`} />
                    <b>{fmt(q.avg)}</b>
                    <small>{q.n}명</small>
                  </span>
                  <Dist dist={q.dist} scale={s.scale} />
                </li>
              ))}
            </ol>
          </section>

          <div className="ad-side">
            <Counts title="플레이한 사건" items={s.cases} total={s.total} />
            <Counts title="추리물을 즐기는 정도" items={s.freq} total={s.total} />
            <Counts title="사건 제작실 사용" items={s.studio_used} total={s.total} />
          </div>
        </div>

        <section className="ad-panel ad-voices">
          <div className="ad-voices-head">
            <h3>남긴 의견</h3>
            <div className="seg" role="tablist">
              {[
                ['all', '모두'],
                ['best', '좋았던 점'],
                ['improve', '고칠 점'],
              ].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {said.length ? (
            <ul>
              {said.map((r) => (
                <li key={r.id} className={fresh.has(r.id) ? 'fresh' : ''}>
                  {tab !== 'improve' && r.best && (
                    <p>
                      <span className="ad-tag good">좋았던 점</span>
                      {r.best}
                    </p>
                  )}
                  {tab !== 'best' && r.improve && (
                    <p>
                      <span className="ad-tag fix">고칠 점</span>
                      {r.improve}
                    </p>
                  )}
                  <small>
                    {r.no}번 응답 · {day(r.submitted_at)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ad-empty">아직 적힌 의견이 없어요.</p>
          )}
        </section>

        <section className="ad-panel">
          <h3>응답 목록 <small>최신순 · 줄을 누르면 문항별 답이 보여요</small></h3>
          {data.responses.length ? (
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>제출 시각</th>
                    <th>플레이한 사건</th>
                    <th>제작실</th>
                    <th className="ad-num">평균</th>
                    <th>
                      <span className="sr">자세히</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.responses.map((r) => (
                    <Row key={r.id} r={r} questions={s.questions} open={open.has(r.id)} fresh={fresh.has(r.id)} onToggle={() => toggle(r.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ad-empty">설문 주소를 친구들에게 보내면 여기에 응답이 쌓여요.</p>
          )}
        </section>
      </main>
    </div>
  )
}
