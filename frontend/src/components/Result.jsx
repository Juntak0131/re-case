import Logo from './Logo.jsx'
import FictionNote from './FictionNote.jsx'

const SOURCE = {
  question: (k) => `Q${k.question_n} 질문으로 밝힘`,
  explanation: () => '추리로 맞힘',
}
const STAMP = { YES: 'yes', NO: 'no', IRRELEVANT: 'irr' }

export default function Result({ game, onHome, onReplay }) {
  const r = game.result
  const c = game.case
  const decisive = new Set(game.history.filter((e) => e.keys.length).map((e) => e.n))
  const keyScore = r.solved_keys * 12

  return (
    <div className="result">
      <header className="result-top">
        <button className="logo-btn" onClick={onHome} title="사건 목록으로">
          <Logo />
        </button>
      </header>

      <main className="result-main">
        <section className="verdict-card paper">
          <span className="closed-stamp">사건 종결</span>
          <p className="modal-kicker">No.{c.number} · {c.title}</p>
          <div className="score">
            <b>{r.score}</b>
            <span>점</span>
          </div>
          <p className="rank">{r.rank}</p>
          <p className="rank-comment">{r.comment}</p>

          <div className="breakdown">
            <div className={r.culprit_correct ? 'ok' : r.accomplice_named ? 'half' : 'miss'}>
              <span>범인 지목</span>
              <strong>
                {r.accused.name}
                {r.culprit_correct ? ' — 정답' : r.accomplice_named ? ' — 공범' : ` — 진범은 ${r.culprit.name}`}
              </strong>
              <em>{r.culprit_score} / 40</em>
            </div>
            <div className={r.solved_keys === r.keys.length ? 'ok' : r.solved_keys ? 'half' : 'miss'}>
              <span>핵심 단서</span>
              <strong>
                {r.solved_keys} / {r.keys.length}개
              </strong>
              <em>{keyScore} / 60</em>
            </div>
            <div>
              <span>사용한 질문</span>
              <strong>
                {r.questions_used} / {game.max_questions}개
              </strong>
            </div>
          </div>
        </section>

        <section className="result-block">
          <h2>핵심 단서</h2>
          <ul className="truth-keys">
            {r.keys.map((k) => (
              <li key={k.id} className={k.source ? 'ok' : 'miss'}>
                <span className="tk-mark" aria-hidden="true">
                  {k.source ? '✓' : '–'}
                </span>
                <div>
                  <strong>{k.title}</strong>
                  <p>{k.fact}</p>
                </div>
                <em>{k.source ? SOURCE[k.source](k) : '놓침'}</em>
              </li>
            ))}
          </ul>
        </section>

        <section className="result-block truth paper">
          <h2>사건의 전말</h2>
          <p className="truth-who">
            {r.accomplice ? '계획한 사람' : '범인'} <b>{r.culprit.name}</b>
            {r.accomplice && <> · 도운 사람 <b>{r.accomplice.name}</b></>}
          </p>
          {r.story.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <p className="epilogue">{r.epilogue}</p>
        </section>

        <FictionNote motif={r.motif} compact />

        {r.explanation && (
          <section className="result-block">
            <h2>내가 제출한 추리</h2>
            <blockquote className="my-story">{r.explanation}</blockquote>
          </section>
        )}

        {game.history.length > 0 && (
          <section className="result-block">
            <h2>
              질문 복기 <small>결정적 질문 {decisive.size}개</small>
            </h2>
            <ol className="replay">
              {game.history.map((e) => (
                <li key={e.n} className={decisive.has(e.n) ? 'decisive' : ''}>
                  <span className="qn">Q{e.n}</span>
                  <span className="rq">{e.question}</span>
                  <span className={`stamp sm ${STAMP[e.answer]}`}>{e.label}</span>
                  {decisive.has(e.n) && <span className="tag">결정적 질문</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="result-actions">
          <button className="btn ghost-dark" onClick={onReplay}>
            이 사건 다시 하기
          </button>
          <button className="btn red" onClick={onHome}>
            다른 사건 수사하기
          </button>
        </div>
      </main>
    </div>
  )
}
