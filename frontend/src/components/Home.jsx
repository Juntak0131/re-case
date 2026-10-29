import Logo from './Logo.jsx'
import FictionNote from './FictionNote.jsx'

const STEPS = [
  ['사건 기록 읽기', '개요 · 증거 · 인물 기록을 살펴보고 수상한 점을 찾습니다.'],
  ['예/아니오로 묻기', '진실을 모두 아는 AI 판정관에게 질문 20개까지 던질 수 있어요.'],
  ['추리 제출', '범인을 지목하고 사건의 전말을 쓰면 채점과 함께 진실이 공개됩니다.'],
]

export default function Home({ cases, health, error, saved, onRetry, onStart, onResume }) {
  return (
    <div className="home">
      <header className="home-hero">
        <Logo large />
        <p className="home-tag">
          “예” 아니면 “아니오”.
          <br />
          단 두 마디로 미제사건의 진실에 다가가는 AI 추리 게임
        </p>
        <ol className="steps">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="step-n">{i + 1}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </header>

      <main className="home-main">
        <FictionNote />

        {health && !health.ai_ready && (
          <div className="banner warn">
            서버에 OpenAI API 키가 설정되지 않았어요. <code>backend/.env</code>에 <code>OPENAI_API_KEY</code>를 넣고
            서버를 다시 켜면 질문할 수 있어요.
          </div>
        )}

        <h2 className="section-title">
          미제 사건 파일 <span>{cases ? `${cases.length}건` : ''}</span>
        </h2>

        {error && (
          <div className="banner warn">
            {error}{' '}
            <button className="link" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        )}
        {!cases && !error && <p className="muted">사건 파일을 불러오는 중…</p>}

        <div className="case-grid">
          {cases?.map((c) => (
            <article key={c.id} className="folder">
              <div className="folder-tab">No.{c.number}</div>
              <div className="folder-body">
                <div className="folder-meta">
                  <span>{c.era}</span>
                  <span>{c.type}</span>
                  <span className={`diff ${c.difficulty === '어려움' ? 'hard' : ''}`}>{c.difficulty}</span>
                </div>
                <h3>{c.title}</h3>
                <p className="folder-teaser">{c.teaser}</p>
                <p className="folder-motif">모티프 · {c.motif}</p>
                <div className="folder-actions">
                  {saved[c.id] ? (
                    <>
                      <button className="btn red" onClick={() => onResume(c)}>
                        이어서 수사
                      </button>
                      <button className="btn ghost-dark" onClick={() => onStart(c)}>
                        처음부터
                      </button>
                    </>
                  ) : (
                    <button className="btn red" onClick={() => onStart(c)}>
                      수사 시작
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      <footer className="home-foot">
        RE:CASE · 한준탁 · 실제 미제사건에서 모티프를 얻은 가상 시나리오이며, 인물·장소·결말은 모두 허구입니다.
      </footer>
    </div>
  )
}
