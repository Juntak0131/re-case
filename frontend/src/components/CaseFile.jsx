import { useState } from 'react'

const TABS = [
  ['brief', '개요'],
  ['evidence', '증거'],
  ['people', '인물'],
]

export default function CaseFile({ c }) {
  const [tab, setTab] = useState('brief')

  return (
    <section className="casefile paper" aria-label="사건 기록철">
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
                <dt>일시</dt>
                <dd>{c.era}</dd>
              </div>
              <div>
                <dt>장소</dt>
                <dd>{c.place}</dd>
              </div>
              <div>
                <dt>유형</dt>
                <dd>{c.type}</dd>
              </div>
            </dl>
            {c.briefing.map((p, i) => (
              <p key={i} className="cf-para">
                {p}
              </p>
            ))}
            <div className="cf-question">
              <span>풀어야 할 질문</span>
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
                    {p.name} <em>{p.age}세 · {p.role}</em>
                  </strong>
                  <p>{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="cf-foot">모티프 · {c.motif} — 인물·장소·결말은 허구입니다.</footer>
    </section>
  )
}
