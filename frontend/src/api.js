export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('서버에 연결하지 못했어요. 백엔드 서버가 켜져 있는지 확인해 주세요.', 0)
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : '입력 형식이 올바르지 않아요.'
    throw new ApiError(detail || `요청이 실패했어요. (${res.status})`, res.status)
  }
  return data
}

export const api = {
  health: () => request('/health'),
  cases: () => request('/cases'),
  newGame: (caseId) => request('/games', { method: 'POST', body: { case_id: caseId } }),
  game: (id) => request(`/games/${id}`),
  ask: (id, question) => request(`/games/${id}/questions`, { method: 'POST', body: { question } }),
  accuse: (id, culpritId, explanation) =>
    request(`/games/${id}/accusation`, { method: 'POST', body: { culprit_id: culpritId, explanation } }),
}

// 브라우저 저장소는 막혀 있을 수 있어서 항상 try/catch로 감싼다.
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key)
      return v == null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 무시 */
    }
  },
}
