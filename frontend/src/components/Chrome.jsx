import { useEffect, useState } from 'react'

// 담당 수사관 이름표 — 이름은 이 브라우저에만 저장된다
export function DetectiveBadge({ name, onChange }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)

  useEffect(() => setValue(name), [name])

  if (editing)
    return (
      <form
        className="badge editing"
        onSubmit={(e) => {
          e.preventDefault()
          onChange(value.replace(/\s+/g, ' ').trim().slice(0, 10))
          setEditing(false)
        }}
      >
        <label htmlFor="detective-name">수사관 이름</label>
        <input
          id="detective-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          maxLength={10}
          placeholder="예) 한준탁"
          autoFocus
          autoComplete="off"
        />
        <button className="btn red small">등록</button>
      </form>
    )

  return (
    <button className="badge" onClick={() => setEditing(true)} title="수사관 이름 바꾸기">
      <svg className="badge-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 2.5 19.5 5v6.2c0 4.6-3.1 8.3-7.5 10.3-4.4-2-7.5-5.7-7.5-10.3V5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m12 7.4 1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4z" fill="currentColor" />
      </svg>
      <span className="badge-role">담당 수사관</span>
      <b>{name || '이름 적기'}</b>
    </button>
  )
}

// 빗소리 켜고 끄기
export function RainToggle({ on, onToggle }) {
  return (
    <button className={`rain-btn ${on ? 'on' : ''}`} onClick={onToggle} aria-pressed={on} title={on ? '빗소리 끄기' : '빗소리 켜기'}>
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M7 15.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.3 1.6A3.8 3.8 0 0 1 17 15.5z" />
        {on ? <path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5" /> : <path d="M4 3l16 18" />}
      </svg>
      <span>{on ? '빗소리 켜짐' : '빗소리'}</span>
    </button>
  )
}
