import { useEffect, useMemo, useState } from 'react'
import { api, store } from '../api.js'
import Logo from './Logo.jsx'

const REVIEWED = 'recase.reviewed' // 이 브라우저에서 후기를 보낸 시각 (중복 안내용)

const empty = (name, preset) => ({
  name: name || '',
  freq: '',
  cases: preset ? [preset] : [],
  studio_used: '',
  ratings: {},
  best: '',
  improve: '',
  website: '', // 사람 눈에는 안 보이는 칸: 채워져 있으면 자동 등록 프로그램으로 본다
})

// 서버와 같은 규칙으로 먼저 검사해서, 보내기 전에 빠진 곳을 알려 준다
function check(form, a) {
  const issues = {}
  const name = a.name.replace(/\s+/g, ' ').trim()
  if (!name) issues.name = '이름이나 닉네임을 적어 주세요.'
  else if (name.length > form.max_name) issues.name = `이름은 ${form.max_name}자 안으로 적어 주세요.`
  if (!a.freq) issues.freq = '하나를 골라 주세요.'
  if (!a.cases.length) issues.cases = '플레이한 사건을 하나 이상 골라 주세요.'
  if (!a.studio_used) issues.studio_used = '하나를 골라 주세요.'
  form.questions.forEach((q, i) => {
    if (q.id === form.studio_question && a.studio_used !== '예') return
    if (q.required && !a.ratings[q.id]) issues[q.id] = `${i + 1}번 문항에 답해 주세요.`
  })
  for (const f of ['best', 'improve']) if (a[f].length > form.max_text) issues[f] = `${form.max_text}자 안으로 적어 주세요.`
  return issues
}

function focusFirst(issues) {
  const first = Object.keys(issues)[0]
  const el = first && document.getElementById(`rv-${first}`)
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  el.querySelector('input, textarea, button')?.focus({ preventScroll: true })
}

function Choice({ id, label, error, children }) {
  return (
    <fieldset className={`rv-field ${error ? 'bad' : ''}`} id={`rv-${id}`}>
      <legend>{label}</legend>
      {children}
      {error && <p className="rv-error">{error}</p>}
    </fieldset>
  )
}

function Rating({ q, n, scale, value, error, onPick }) {
  return (
    <fieldset className={`rv-q ${error ? 'bad' : ''}`} id={`rv-${q.id}`}>
      <legend>
        <span className="rv-qn">{n}</span>
        <span className="rv-qt">
          {q.text}
          {!q.required && <em>선택</em>}
        </span>
      </legend>
      <div className="rv-scale">
        <div className="rv-boxes">
          {scale.map((label, i) => (
            <label key={i} className={value === i + 1 ? 'on' : ''} title={label}>
              <input type="radio" name={q.id} value={i + 1} checked={value === i + 1} onChange={() => onPick(i + 1)} />
              <span aria-hidden="true">{i + 1}</span>
              <span className="sr">{label}</span>
            </label>
          ))}
        </div>
        <p className="rv-ends" aria-hidden="true">
          <span>{scale[0]}</span>
          <b>{value ? scale[value - 1] : ''}</b>
          <span>{scale[scale.length - 1]}</span>
        </p>
      </div>
      {error && <p className="rv-error">{error}</p>}
    </fieldset>
  )
}

export default function Review({ detective, preset, onHome }) {
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [a, setA] = useState(() => empty(detective, preset))
  const [issues, setIssues] = useState({})
  const [tried, setTried] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [done, setDone] = useState(false)
  const [reviewedAt] = useState(() => store.get(REVIEWED, null))

  const load = () => {
    setLoadError('')
    api.feedback
      .form()
      .then(setForm)
      .catch((e) => setLoadError(e.message))
  }
  useEffect(load, [])

  const set = (patch) => setA((prev) => ({ ...prev, ...patch }))
  // 한 번 보내 보려고 한 뒤에는 고치는 즉시 빨간 표시를 지운다
  useEffect(() => {
    if (tried && form) setIssues(check(form, a))
  }, [a, tried, form])

  const visible = useMemo(
    () => (form ? form.questions.filter((q) => q.id !== form.studio_question || a.studio_used === '예') : []),
    [form, a.studio_used],
  )
  const answered = visible.filter((q) => a.ratings[q.id]).length

  const submit = async (e) => {
    e.preventDefault()
    setTried(true)
    setSendError('')
    const found = check(form, a)
    setIssues(found)
    if (Object.keys(found).length) {
      focusFirst(found)
      return
    }
    const ratings = { ...a.ratings }
    if (a.studio_used !== '예') delete ratings[form.studio_question]
    setSending(true)
    try {
      await api.feedback.submit({ ...a, name: a.name.trim(), best: a.best.trim(), improve: a.improve.trim(), ratings })
      store.set(REVIEWED, Date.now())
      setDone(true)
      window.scrollTo(0, 0)
    } catch (err) {
      if (err.issues?.length) {
        const map = Object.fromEntries(err.issues.map((i) => [i.field, i.message]))
        setIssues(map)
        focusFirst(map)
      }
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  const missing = Object.keys(issues).length

  return (
    <div className="rv-page">
      <header className="page-top">
        <button className="logo-btn" onClick={onHome} title="사건 목록으로">
          <Logo />
        </button>
        <button className="btn ghost-dark small" onClick={onHome}>
          사건 목록으로
        </button>
      </header>

      <main className="rv-main">
        {done ? (
          <section className="rv-done paper">
            <span className="rv-stamp" aria-hidden="true">
              접수
            </span>
            <p className="modal-kicker">수사 후기 · 접수 완료</p>
            <h1>후기를 보냈어요</h1>
            <p>{a.name.trim()} 님, 남겨 주신 의견은 다음 사건과 판정관을 고치는 데 씁니다. 참여해 주셔서 고맙습니다.</p>
            <button className="btn red" onClick={onHome}>
              사건 목록으로
            </button>
          </section>
        ) : (
          <>
            <h1 className="studio-title">수사 후기</h1>
            <p className="studio-lead">RE:CASE를 해 본 느낌을 알려 주세요. 2~3분이면 끝나요. 로그인 없이 이름이나 닉네임만 적으면 됩니다.</p>
            {reviewedAt && (
              <p className="banner rv-note">이 브라우저에서 이미 후기를 보냈어요. 다시 보내면 한 번 더 기록돼요.</p>
            )}

            {loadError && (
              <div className="banner warn">
                설문을 불러오지 못했어요. {loadError}{' '}
                <button className="link" onClick={load}>
                  다시 불러오기
                </button>
              </div>
            )}
            {!form && !loadError && <p className="rv-loading">설문지를 꺼내는 중…</p>}

            {form && (
              <form className="rv-sheet sheet paper" onSubmit={submit} noValidate>
                <section className="rv-part">
                  <h2>응답자</h2>
                  <div className={`field rv-name ${issues.name ? 'bad' : ''}`} id="rv-name">
                    <label htmlFor="rv-name-input">
                      <span>이름 또는 닉네임</span>
                    </label>
                    <input
                      id="rv-name-input"
                      value={a.name}
                      maxLength={form.max_name + 5}
                      onChange={(e) => set({ name: e.target.value })}
                      placeholder="예) 한준탁"
                      autoComplete="nickname"
                    />
                    {issues.name ? (
                      <p className="rv-error">{issues.name}</p>
                    ) : (
                      <p className="rv-help">응답 확인용으로만 쓰고 화면에 공개하지 않아요.</p>
                    )}
                  </div>
                  <div className="rv-hp" aria-hidden="true">
                    <label>
                      홈페이지
                      <input tabIndex={-1} autoComplete="off" value={a.website} onChange={(e) => set({ website: e.target.value })} />
                    </label>
                  </div>

                  <Choice id="freq" label="평소 추리 게임이나 추리물을 얼마나 즐기나요?" error={issues.freq}>
                    <div className="chips">
                      {form.freq.map((f) => (
                        <button type="button" key={f} className={`chip-btn ${a.freq === f ? 'on' : ''}`} aria-pressed={a.freq === f} onClick={() => set({ freq: f })}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </Choice>

                  <Choice id="cases" label="플레이한 사건을 모두 골라 주세요." error={issues.cases}>
                    <div className="chips">
                      {form.cases.map((c) => {
                        const on = a.cases.includes(c.id)
                        return (
                          <button
                            type="button"
                            key={c.id}
                            className={`chip-btn ${on ? 'on' : ''}`}
                            aria-pressed={on}
                            onClick={() => set({ cases: on ? a.cases.filter((x) => x !== c.id) : [...a.cases, c.id] })}
                          >
                            {c.title}
                          </button>
                        )
                      })}
                    </div>
                  </Choice>

                  <Choice id="studio_used" label="사건 제작실에서 사건을 만들어 봤나요?" error={issues.studio_used}>
                    <div className="chips">
                      {form.yes_no.map((v) => (
                        <button type="button" key={v} className={`chip-btn ${a.studio_used === v ? 'on' : ''}`} aria-pressed={a.studio_used === v} onClick={() => set({ studio_used: v })}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </Choice>
                </section>

                <section className="rv-part">
                  <h2>플레이 평가</h2>
                  <p className="hint">각 문장에 얼마나 동의하는지 1~5 중에서 골라 주세요.</p>
                  {form.questions.map((q, i) =>
                    q.id === form.studio_question && a.studio_used !== '예' ? null : (
                      <Rating
                        key={q.id}
                        q={q}
                        n={i + 1}
                        scale={form.scale}
                        value={a.ratings[q.id]}
                        error={issues[q.id]}
                        onPick={(v) => set({ ratings: { ...a.ratings, [q.id]: v } })}
                      />
                    ),
                  )}
                </section>

                <section className="rv-part">
                  <h2>하고 싶은 말</h2>
                  {[
                    ['best', '가장 좋았던 점은 무엇인가요?', '예) 질문할수록 단서가 맞춰지는 게 재밌었다'],
                    ['improve', '불편했거나 고쳤으면 하는 점이 있나요?', '예) 판정관 답이 조금 늦게 나왔다'],
                  ].map(([f, label, ph]) => (
                    <div className={`field full ${issues[f] ? 'bad' : ''}`} id={`rv-${f}`} key={f}>
                      <label htmlFor={`rv-${f}-input`}>
                        <span>
                          {label}
                          <em>선택</em>
                        </span>
                      </label>
                      <textarea id={`rv-${f}-input`} rows={3} value={a[f]} placeholder={ph} onChange={(e) => set({ [f]: e.target.value })} />
                      <p className={issues[f] ? 'rv-error' : 'rv-count'}>
                        {issues[f] || `${a[f].length} / ${form.max_text}자`}
                      </p>
                    </div>
                  ))}
                </section>

                <div className="rv-submit">
                  <p className={missing ? 'bad' : ''} role="status">
                    {sendError && !missing
                      ? sendError
                      : missing
                        ? `빠진 곳이 ${missing}군데 있어요. 빨갛게 표시한 곳을 채워 주세요.`
                        : `평가 ${visible.length}문항 중 ${answered}개 답함`}
                  </p>
                  <button className="btn red" disabled={sending}>
                    {sending ? '보내는 중…' : '후기 보내기'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  )
}
