import { useEffect, useRef, useState } from 'react'
import { api, copyText, shareLink, store } from '../api.js'
import Logo from './Logo.jsx'

const DRAFT = 'recase.draft.editor'
const MOODS = ['으스스한', '쓸쓸한', '긴박한', '코믹한', '고전 추리', '누아르']
const TYPES = ['실종', '도난', '살인', '협박', '밀실', '사라진 배·비행기']
const LEVELS = ['쉬움', '보통', '어려움']
const FIELD_NAME = {
  title: '제목', teaser: '소개', briefing: '사건 개요', evidence: '증거', people: '인물', story: '사건의 전말', facts: '사실 목록',
  keys: '핵심 단서', culprit: '범인', examples: '예시 질문', question: '풀어야 할 질문', truth: '진실',
}

// ---------------- 공용 ----------------
function ShareBox({ id, summary, onPlay, toast, showPlay = true }) {
  const link = shareLink(id)
  return (
    <div className="share-box">
      <h3>공유하기</h3>
      <p>이 링크나 코드를 받은 사람은 진실을 모른 채 바로 수사를 시작해요.</p>
      <div className="share-row">
        <input value={link} readOnly aria-label="공유 링크" onFocus={(e) => e.target.select()} />
        <button className="btn red small" onClick={async () => toast((await copyText(link)) ? '공유 링크를 복사했어요.' : '복사하지 못했어요. 링크를 직접 선택해 복사해 주세요.')}>
          복사
        </button>
      </div>
      <div>
        <span className="muted" style={{ fontSize: 13 }}>사건 코드 </span>
        <span className="share-code">{id}</span>
      </div>
      {showPlay && (
        <div className="share-actions">
          <button className="btn ghost-dark" onClick={() => onPlay(summary)}>
            내가 먼저 수사하기
          </button>
        </div>
      )}
    </div>
  )
}

function Chips({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o} className={`chip-btn ${value === o ? 'on' : ''}`} onClick={() => onChange(value === o ? '' : o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

// ---------------- AI로 만들기 ----------------
function AiMaker({ onCreated, onPlay, onEdit, toast, aiReady }) {
  const [brief, setBrief] = useState({ era: '', place: '', case_type: '', mood: '', difficulty: '보통', idea: '' })
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [made, setMade] = useState(null)
  const set = (k) => (v) => setBrief((b) => ({ ...b, [k]: typeof v === 'string' ? v : v.target.value }))

  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.studio.generate(brief)
      onCreated(r.case, r.edit_key)
      setMade({ id: r.case_id, key: r.edit_key, summary: r.case })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="sheet paper">
        <h3>어떤 사건을 만들까요?</h3>
        <p className="hint">비워 둔 칸은 AI가 알아서 정해요. 실존 인물의 이름이나 실제 수사 중인 사건은 넣지 마세요.</p>
        <div className="form-grid">
          <label className="field">
            <span>시대</span>
            <input value={brief.era} onChange={set('era')} maxLength={40} placeholder="예: 1930년대 경성, 2049년 화성 기지" />
          </label>
          <label className="field">
            <span>장소</span>
            <input value={brief.place} onChange={set('place')} maxLength={60} placeholder="예: 외딴섬 등대, 야간 열차" />
          </label>
          <div className="field full">
            <span>사건 유형</span>
            <Chips options={TYPES} value={brief.case_type} onChange={set('case_type')} />
          </div>
          <div className="field full">
            <span>분위기</span>
            <Chips options={MOODS} value={brief.mood} onChange={set('mood')} />
          </div>
          <div className="field full">
            <span>난이도</span>
            <Chips options={LEVELS} value={brief.difficulty} onChange={(v) => set('difficulty')(v || '보통')} />
          </div>
          <label className="field full">
            <span>
              아이디어 <em>{brief.idea.length}/500</em>
            </span>
            <textarea value={brief.idea} onChange={set('idea')} maxLength={500} rows={3} placeholder="예: 폭설로 고립된 산장, 매일 밤 한 사람씩 사라진다. 범인은 뜻밖의 인물이었으면 좋겠다." />
          </label>
        </div>
        <div className="gen-actions">
          <button className="btn red" onClick={generate} disabled={busy || !aiReady}>
            {busy ? 'AI가 사건을 설계하는 중…' : made ? '하나 더 만들기' : 'AI로 사건 만들기'}
          </button>
          {busy && <span className="gen-wait">{elapsed}초 · 보통 30초~1분 걸려요. 창을 닫지 마세요.</span>}
          {!busy && !error && <span className="gen-wait">한 시간에 6번까지 만들 수 있어요.</span>}
        </div>
        {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
      </section>

      {made && (
        <div className="made">
          <section className="sheet paper">
            <p className="modal-kicker">No.{made.summary.number} · 새 사건</p>
            <h3 style={{ fontSize: 24, margin: '6px 0' }}>{made.summary.title}</h3>
            <p style={{ margin: '0 0 6px' }}>{made.summary.teaser}</p>
            <p className="hint">
              {made.summary.era} · {made.summary.place} · {made.summary.type} · {made.summary.difficulty}
            </p>
            <div className="card-actions">
              <button className="btn red" onClick={() => onPlay(made.summary)}>
                바로 수사하기
              </button>
              <button className="btn ghost-dark" onClick={() => onEdit({ id: made.id, key: made.key })}>
                진실 보고 고치기 (스포 주의)
              </button>
            </div>
          </section>
          <ShareBox id={made.id} summary={made.summary} onPlay={onPlay} toast={toast} showPlay={false} />
        </div>
      )}
    </>
  )
}

// ---------------- 직접 쓰기 ----------------
const blank = () => ({
  title: '', era: '', place: '', type: '', difficulty: '보통', teaser: '', question: '', accuse_label: '범인은 누구인가요?',
  examples: ['', '', ''],
  briefing: '',
  evidence: [{ title: '', body: '' }, { title: '', body: '' }, { title: '', body: '' }],
  people: [1, 2, 3].map((n) => ({ id: `P${n}`, name: '', age: '', role: '', desc: '' })),
  truth: { culprit: '', accomplice: '', story: '', epilogue: '', facts: '', keys: [1, 2, 3, 4, 5].map(() => ({ title: '', fact: '' })) },
})

const SAMPLE = {
  title: '새벽 세 시의 피아노', era: '2003년 가을', place: '가상의 도시 해온시, 낡은 음악학원', type: '도난', difficulty: '쉬움',
  teaser: '잠긴 학원에서 새벽마다 피아노 소리가 났다. 그리고 금고가 비었다.',
  question: '누가 금고의 악보를 가져갔고, 피아노 소리는 무엇이었을까?', accuse_label: '범인은 누구인가요?',
  examples: ['피아노 소리는 사람이 직접 친 건가요?', '범인은 학원 열쇠가 있었나요?', '악보는 아직 해온시에 있나요?'],
  briefing: '해온시의 낡은 음악학원. 원장 혼자 학원 열쇠를 가지고 있다.\n일주일 동안 새벽 세 시마다 잠긴 학원에서 피아노 소리가 났다.\n여덟째 날 아침, 원장실 금고에서 작곡가의 친필 악보 원본이 사라졌다.',
  evidence: [
    { title: '경비원의 녹음', body: '경비원이 녹음한 새벽 피아노 소리. 매일 같은 곡, 같은 곳에서 똑같이 틀린다.' },
    { title: '창문 먼지', body: '연습실 창문 가운데 하나만 창틀에 먼지가 없다.' },
    { title: '빈 금고', body: '금고는 열쇠로 열렸다. 다른 귀중품은 그대로다.' },
    { title: '조율 일지', body: '조율사는 사건 2주 전 원장실 피아노도 조율했다고 적었다.' },
  ],
  people: [
    { id: 'P1', name: '서은재', age: '41', role: '원장', desc: '학원을 20년째 운영한다. 금고 열쇠를 늘 목에 건다.' },
    { id: 'P2', name: '문태오', age: '38', role: '조율사', desc: '매주 화요일에 온다. 최근 큰 빚이 생겼다는 소문이 있다.' },
    { id: 'P3', name: '이하린', age: '24', role: '강사', desc: '밤늦게까지 남아 연습하는 날이 많다.' },
    { id: 'P4', name: '강두식', age: '63', role: '경비원', desc: '건물 야간 경비. 피아노 소리를 처음 신고했다.' },
  ],
  truth: {
    culprit: 'P2', accomplice: '',
    story: '조율사 문태오는 빚을 갚으려고 악보 원본을 노렸다. 원장실 피아노를 조율하던 날, 원장이 잠시 자리를 비운 사이 금고 열쇠의 본을 떴다.\n새벽의 피아노 소리는 연습실 피아노 안에 숨겨 둔 카세트 녹음기에서 나온 것이다. 경비원과 원장의 눈을 연습실로 돌리려는 속임수였다.\n여덟째 날 새벽, 그는 먼지 없는 연습실 창문으로 들어와 복제 열쇠로 금고를 열었다.',
    epilogue: '악보는 해외 수집가에게 팔렸다는 소문만 남았다.',
    facts: '범인은 조율사 문태오(38, 남성)다. 공범은 없다.\n서은재, 이하린, 강두식은 범행과 무관하다.\n문태오의 동기는 빚을 갚는 것이다.\n문태오는 사건 2주 전 원장실 피아노를 조율하던 날 금고 열쇠의 본을 떴다.\n원장은 그날 10분쯤 자리를 비웠다.\n문태오는 그 본으로 복제 열쇠를 만들었다.\n피아노 소리는 사람이 친 것이 아니다.\n피아노 소리는 연습실 피아노 안에 숨긴 카세트 녹음기에서 나왔다.\n녹음기는 타이머로 새벽 세 시에 켜지게 해 두었다.\n같은 곳에서 똑같이 틀리는 것은 같은 녹음을 반복 재생했기 때문이다.\n피아노 소리는 사람들의 눈을 연습실로 돌리려는 속임수였다.\n여덟째 날 새벽 문태오는 먼지 없는 연습실 창문으로 들어왔다.\n창문은 문태오가 조율하러 온 날 미리 잠금을 풀어 두었다.\n금고는 복제 열쇠로 열었다.\n문태오는 악보 원본만 가져갔다.\n이하린은 밤늦게 연습했지만 새벽 세 시에는 집에 있었다.\n강두식은 정해진 순찰만 했고 사건과 무관하다.\n악보는 해외 수집가에게 팔렸다.',
    keys: [
      { title: '피아노 소리', fact: '새벽 피아노 소리는 숨겨 둔 녹음기를 타이머로 튼 것이다.' },
      { title: '소리의 목적', fact: '사람들의 눈을 연습실로 돌리려는 속임수였다.' },
      { title: '금고 열쇠', fact: '조율하던 날 열쇠의 본을 떠서 복제 열쇠를 만들었다.' },
      { title: '들어온 길', fact: '미리 잠금을 풀어 둔 연습실 창문으로 들어왔다.' },
      { title: '동기', fact: '빚을 갚으려고 악보 원본을 노렸다.' },
    ],
  },
}

function toForm(c) {
  const lines = (v) => (Array.isArray(v) ? v.join('\n') : v || '')
  return {
    ...blank(),
    ...c,
    examples: [...(c.examples || []), '', '', ''].slice(0, 3),
    briefing: lines(c.briefing),
    evidence: (c.evidence || []).map(({ title, body }) => ({ title, body })),
    people: (c.people || []).map((p) => ({ id: p.id, name: p.name, age: p.age ? String(p.age) : '', role: p.role, desc: p.desc })),
    truth: {
      culprit: c.truth?.culprit || '',
      accomplice: c.truth?.accomplice || '',
      story: lines(c.truth?.story),
      epilogue: c.truth?.epilogue || '',
      facts: lines(c.truth?.facts),
      keys: [...(c.truth?.keys || []).map(({ title, fact }) => ({ title, fact })), ...blank().truth.keys].slice(0, 5),
    },
  }
}

const toPayload = (f) => ({
  ...f,
  examples: f.examples.map((s) => s.trim()).filter(Boolean),
  truth: { ...f.truth, accomplice: f.truth.accomplice || null },
})

const countLines = (s) => s.split('\n').filter((l) => l.trim()).length

function Review({ review }) {
  if (!review) return null
  const cls = review.verdict === '좋음' ? 'good' : review.verdict === '플레이 불가' || review.blocked ? 'bad' : ''
  return (
    <section className="review" aria-live="polite">
      <h3>
        AI 검사 결과 <b className={cls}>{review.blocked ? '만들 수 없음' : review.verdict}</b>
      </h3>
      {review.blocked && <p className="form-error">{review.blocked_reason}</p>}
      {review.issues?.length ? (
        <ul className="issues">
          {review.issues.map((i, n) => (
            <li key={n} className={i.severity}>
              <i>{i.severity === 'error' ? '필수' : i.severity === 'warn' ? '권장' : '제안'}</i>
              <span>
                <small>{FIELD_NAME[i.field] || i.field}</small>
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !review.blocked && <p className="muted">고칠 곳을 찾지 못했어요.</p>
      )}
    </section>
  )
}

function Editor({ target, onSaved, onDeleted, onPlay, toast, aiReady }) {
  const [form, setForm] = useState(() => (target ? null : store.get(DRAFT, null) || blank()))
  const [current, setCurrent] = useState(target) // 저장된 사건 { id, key }
  const [summary, setSummary] = useState(null)
  const [review, setReview] = useState(null)
  const [busy, setBusy] = useState('')
  const [loadError, setLoadError] = useState('')
  const topRef = useRef(null)

  useEffect(() => {
    if (!target) return
    api.studio
      .load(target.id, target.key)
      .then((r) => setForm(toForm(r.case)))
      .catch((e) => setLoadError(e.message))
    api.caseSummary(target.id).then(setSummary).catch(() => {})
  }, [target])

  useEffect(() => {
    if (form && !current) store.set(DRAFT, form)
  }, [form, current])

  if (loadError) return <p className="banner warn">{loadError}</p>
  if (!form) return <p className="muted">사건을 불러오는 중…</p>

  const set = (path, value) =>
    setForm((f) => {
      const next = structuredClone(f)
      let o = next
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]]
      o[path[path.length - 1]] = value
      return next
    })
  const bind = (...path) => ({
    value: path.reduce((o, k) => o[k], form),
    onChange: (e) => set(path, e.target.value),
  })
  const addRow = (key, row) => setForm((f) => ({ ...f, [key]: [...f[key], row] }))
  const delRow = (key, i) => setForm((f) => ({ ...f, [key]: f[key].filter((_, n) => n !== i) }))
  const nextPersonId = () => `P${Math.max(0, ...form.people.map((p) => Number(p.id.slice(1)) || 0)) + 1}`
  const named = form.people.filter((p) => p.name.trim())

  const check = async () => {
    setBusy('review')
    try {
      setReview(await api.studio.review(toPayload(form)))
      topRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (e) {
      setReview({ verdict: '플레이 불가', issues: e.issues || [{ severity: 'error', field: '', message: e.message }] })
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    setBusy('save')
    try {
      if (current) {
        const r = await api.studio.update(current.id, current.key, toPayload(form))
        setSummary(r.case)
        onSaved(r.case, current.key, true)
        toast('수정한 내용을 저장했어요.')
      } else {
        const r = await api.studio.save(toPayload(form))
        setCurrent({ id: r.case_id, key: r.edit_key })
        setSummary(r.case)
        store.set(DRAFT, null)
        onSaved(r.case, r.edit_key, false)
        toast('사건을 저장했어요. 링크로 공유해 보세요.')
      }
      setReview(null)
      topRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (e) {
      setReview({ verdict: '플레이 불가', issues: e.issues || [{ severity: 'error', field: '', message: e.message }] })
      topRef.current?.scrollIntoView({ behavior: 'smooth' })
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!current || !window.confirm('이 사건을 삭제할까요? 공유한 링크도 더 이상 열리지 않아요.')) return
    setBusy('delete')
    try {
      await api.studio.remove(current.id, current.key)
      onDeleted(current.id)
    } catch (e) {
      toast(e.message)
      setBusy('')
    }
  }

  return (
    <div className="editor">
      <div ref={topRef} />
      {current && summary && <ShareBox id={current.id} summary={summary} onPlay={onPlay} toast={toast} />}
      <Review review={review} />

      <section className="sheet paper ed-section">
        <h3>1. 사건 기본 정보</h3>
        <p className="hint">플레이어가 사건 목록과 사건 기록철에서 보는 정보예요.</p>
        <div className="form-grid">
          <label className="field full">
            <span>제목</span>
            <input {...bind('title')} maxLength={40} placeholder="예: 새벽 세 시의 피아노" />
          </label>
          <label className="field">
            <span>시대</span>
            <input {...bind('era')} maxLength={40} placeholder="예: 2003년 가을" />
          </label>
          <label className="field">
            <span>장소</span>
            <input {...bind('place')} maxLength={60} placeholder="예: 가상의 도시 해온시, 음악학원" />
          </label>
          <label className="field">
            <span>사건 유형</span>
            <input {...bind('type')} maxLength={30} placeholder="예: 도난" />
          </label>
          <div className="field">
            <span>난이도</span>
            <Chips options={LEVELS} value={form.difficulty} onChange={(v) => set(['difficulty'], v || '보통')} />
          </div>
          <label className="field full">
            <span>한 줄 소개 <em>사건 카드에 보여요</em></span>
            <input {...bind('teaser')} maxLength={120} />
          </label>
          <label className="field full">
            <span>사건 개요 <em>한 줄에 한 문단 · 정답은 쓰지 마세요</em></span>
            <textarea {...bind('briefing')} rows={4} />
          </label>
          <label className="field">
            <span>풀어야 할 질문</span>
            <input {...bind('question')} maxLength={120} placeholder="예: 누가, 왜 악보를 가져갔을까?" />
          </label>
          <label className="field">
            <span>지목 질문</span>
            <input {...bind('accuse_label')} maxLength={60} />
          </label>
          {form.examples.map((_, i) => (
            <label className="field" key={i}>
              <span>예시 질문 {i + 1} <em>선택</em></span>
              <input {...bind('examples', i)} maxLength={100} placeholder="예/아니오로 답할 수 있는 질문" />
            </label>
          ))}
        </div>
      </section>

      <section className="sheet paper ed-section">
        <h3>2. 증거</h3>
        <p className="hint">처음엔 이상해 보이지만, 진실을 알면 설명되는 단서를 넣으면 재밌어요. (2~8개)</p>
        <div className="rows">
          {form.evidence.map((e, i) => (
            <div className="row-item evidence" key={i}>
              <span className="row-id">E{i + 1}</span>
              <input {...bind('evidence', i, 'title')} maxLength={40} placeholder="증거 이름" aria-label={`증거 ${i + 1} 이름`} />
              <textarea {...bind('evidence', i, 'body')} rows={2} placeholder="무엇이 발견됐나요?" aria-label={`증거 ${i + 1} 내용`} />
              <button type="button" className="row-del" onClick={() => delRow('evidence', i)} aria-label="증거 지우기">
                ×
              </button>
            </div>
          ))}
          {form.evidence.length < 8 && (
            <button type="button" className="add-btn" onClick={() => addRow('evidence', { title: '', body: '' })}>
              + 증거 추가
            </button>
          )}
        </div>
      </section>

      <section className="sheet paper ed-section">
        <h3>3. 인물</h3>
        <p className="hint">범인, 의심받지만 무관한 사람을 섞어 주세요. 실존 인물의 이름은 쓸 수 없어요. (3~6명)</p>
        <div className="rows">
          {form.people.map((p, i) => (
            <div className="row-item person" key={p.id}>
              <span className="row-id">{p.id}</span>
              <input {...bind('people', i, 'name')} maxLength={20} placeholder="이름" aria-label={`${p.id} 이름`} />
              <input {...bind('people', i, 'age')} inputMode="numeric" maxLength={3} placeholder="나이" aria-label={`${p.id} 나이`} />
              <input {...bind('people', i, 'role')} maxLength={30} placeholder="역할" aria-label={`${p.id} 역할`} />
              <input {...bind('people', i, 'desc')} maxLength={200} placeholder="공개 소개 (정답 X)" aria-label={`${p.id} 소개`} />
              <button type="button" className="row-del" onClick={() => delRow('people', i)} aria-label="인물 지우기">
                ×
              </button>
            </div>
          ))}
          {form.people.length < 6 && (
            <button type="button" className="add-btn" onClick={() => addRow('people', { id: nextPersonId(), name: '', age: '', role: '', desc: '' })}>
              + 인물 추가
            </button>
          )}
        </div>
      </section>

      <section className="sheet paper ed-section truth-sheet">
        <h3>4. 진실 원장</h3>
        <p className="hint">플레이어에게는 추리를 제출한 뒤에만 공개돼요. AI 판정관은 여기 적힌 내용만으로 예/아니오를 판정해요.</p>
        <div className="form-grid">
          <label className="field">
            <span>범인</span>
            <select {...bind('truth', 'culprit')}>
              <option value="">인물을 고르세요</option>
              {named.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>공범 <em>선택</em></span>
            <select {...bind('truth', 'accomplice')}>
              <option value="">없음</option>
              {named
                .filter((p) => p.id !== form.truth.culprit)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field full">
            <span>사건의 전말 <em>한 줄에 한 문단</em></span>
            <textarea {...bind('truth', 'story')} rows={5} placeholder="누가, 왜, 어떻게 했고, 증거는 왜 그렇게 남았나요?" />
          </label>
          <label className="field full">
            <span>후일담 <em>선택</em></span>
            <input {...bind('truth', 'epilogue')} maxLength={400} />
          </label>
          <label className="field full">
            <span>
              사실 목록 <em>한 줄에 사실 하나 · 지금 {countLines(form.truth.facts)}개 (12개 이상, 20개 넘게 권장)</em>
            </span>
            <textarea
              {...bind('truth', 'facts')}
              rows={10}
              placeholder={'플레이어가 물을 만한 것을 빠짐없이 적어 주세요.\n예) 범인은 조율사 문태오다. 공범은 없다.\n예) 이하린은 새벽 세 시에 집에 있었다.'}
            />
          </label>
        </div>
        <p className="hint" style={{ marginTop: 18 }}>
          핵심 단서 5개 — 사건을 풀려면 꼭 알아야 하는 사실이에요. 제목은 플레이 중에 보이니 답을 암시하지 않게 써 주세요.
        </p>
        <div className="rows">
          {form.truth.keys.map((_, i) => (
            <div className="row-item key" key={i}>
              <span className="row-id">K{i + 1}</span>
              <input {...bind('truth', 'keys', i, 'title')} maxLength={20} placeholder="예: 피아노 소리" aria-label={`핵심 단서 ${i + 1} 제목`} />
              <input {...bind('truth', 'keys', i, 'fact')} maxLength={400} placeholder="핵심 사실 한 문장" aria-label={`핵심 단서 ${i + 1} 내용`} />
            </div>
          ))}
        </div>
      </section>

      <div className="editor-bar">
        {!current && (
          <button className="btn ghost-dark" onClick={() => window.confirm('지금 쓴 내용을 지우고 예시 사건으로 채울까요?') && setForm(toForm(SAMPLE))}>
            예시로 채우기
          </button>
        )}
        <button className="btn ghost-dark" onClick={check} disabled={!!busy || !aiReady}>
          {busy === 'review' ? 'AI가 검사하는 중…' : 'AI 검사'}
        </button>
        <button className="btn red" onClick={save} disabled={!!busy || !aiReady}>
          {busy === 'save' ? '저장하는 중…' : current ? '수정 저장' : '저장하고 공유 링크 만들기'}
        </button>
        {current && (
          <button className="btn ghost-dark" onClick={remove} disabled={!!busy}>
            삭제
          </button>
        )}
      </div>
    </div>
  )
}

export default function Studio({ initialMode, editing, health, onHome, onPlay, onCreated, onRenamed, onRemoved, toast }) {
  const [mode, setMode] = useState(editing ? 'manual' : initialMode)
  const [target, setTarget] = useState(editing)
  const aiReady = !health || health.ai_ready

  return (
    <div className="studio">
      <header className="page-top">
        <button className="logo-btn" onClick={onHome} title="사건 목록으로">
          <Logo />
        </button>
        <button className="btn ghost-dark small" onClick={onHome}>
          사건 목록으로
        </button>
      </header>
      <main className="studio-main">
        <h1 className="studio-title">{target ? '사건 고치기' : '사건 제작실'}</h1>
        <p className="studio-lead">
          {target
            ? '진실 원장까지 보이는 화면이에요. 고친 뒤 저장하면 공유한 링크에도 바로 반영돼요.'
            : '나만의 미스터리를 만들어 친구에게 내 보세요. 받은 사람은 진실을 모른 채 수사를 시작해요.'}
        </p>
        {health && !health.ai_ready && (
          <div className="banner warn">서버에 OpenAI API 키가 없어서 AI 생성·검사·저장을 할 수 없어요. backend/.env를 확인해 주세요.</div>
        )}
        {!target && (
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === 'ai'} className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')}>
              AI로 만들기
            </button>
            <button role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
              직접 쓰기
            </button>
          </div>
        )}
        {mode === 'ai' && !target ? (
          <AiMaker
            aiReady={aiReady}
            toast={toast}
            onPlay={onPlay}
            onCreated={onCreated}
            onEdit={(t) => {
              setTarget(t)
              setMode('manual')
              window.scrollTo(0, 0)
            }}
          />
        ) : (
          <Editor
            key={target?.id || 'new'}
            target={target}
            aiReady={aiReady}
            toast={toast}
            onPlay={onPlay}
            onSaved={(summary, key, isUpdate) => (isUpdate ? onRenamed(summary.id, summary.title) : onCreated(summary, key))}
            onDeleted={onRemoved}
          />
        )}
      </main>
    </div>
  )
}
