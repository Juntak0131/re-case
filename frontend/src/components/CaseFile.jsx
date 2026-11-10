import { useState } from 'react'

const TABS = [
  ['brief', '개요'],
  ['evidence', '증거'],
  ['people', '인물'],
]
const FOOT = {
  solved: '진범이 밝혀진 실제 사건이에요. 등장인물 이름만 가상입니다.',
  real: '‘실제 기록’ 표시만 사실이에요. 인물 이름은 가상, 가상 단서와 결말은 허구입니다.',
  motif: '인물 · 장소 · 결말은 모두 허구입니다.',
  user: '사용자가 만든 가상 사건입니다.',
}

export default function CaseFile({ c }) {
  const [tab, setTab] = useState('brief')
  const isReal = c.kind === 'real'

  return (
    <section className="casefile paper" aria-label="사건 기록철">
      <span className="clip" aria-hidden="true" />
      <header className="cf-head">
        <h2>사건 기록철</h2>
        <span className="cf-stamp">No.{c.number}</span>
      </header>
      <div className="cf-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'evidence' && <small>{c.evidence.length}</small>}
            {id === 'people' && <small>{c.people.length}</small>}
          </button>
        ))}
      </div>

      <div className="cf-body">
        {tab === 'brief' && (
          <>
            <dl className="cf-meta">
              <div>
                <dt>DATE</dt>
                <dd>{c.era}</dd>
              </div>
              <div>
                <dt>PLACE</dt>
                <dd>{c.place}</dd>
              </div>
              <div>
                <dt>TYPE</dt>
                <dd>{c.type}</dd>
              </div>
            </dl>
            {c.briefing.map((p, i) => (
              <p key={i} className="cf-para">
                {p}
              </p>
            ))}
            <div className="cf-question">
              <span>QUESTION</span>
              {c.question}
            </div>
          </>
        )}

        {tab === 'evidence' && (
          <ul className="cf-list">
            {c.evidence.map((e) => (
              <li key={e.id} className="ev">
                <span className="ev-id">{e.id}</span>
                <div>
                  <strong>{e.title}</strong>
                  {isReal && (e.real ? <span className="tag real">실제 기록</span> : <span className="tag fic">가상 단서</span>)}
                  <p>{e.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {tab === 'people' && (
          <ul className="cf-list">
            {c.people.map((p) => (
              <li key={p.id} className="person">
                <span className="avatar" aria-hidden="true">
                  {p.name[0]}
                </span>
                <div>
                  <strong>
                    {p.name} <em>{[p.age ? `${p.age}세` : null, p.role].filter(Boolean).join(' · ')}</em>
                  </strong>
                  {p.fictional && <span className="tag fic">가상 이름</span>}
                  <p>{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="cf-foot">
        {c.basis} — {(c.kind === 'real' && c.solved ? FOOT.solved : FOOT[c.kind]) || FOOT.motif}
      </footer>
    </section>
  )
}
