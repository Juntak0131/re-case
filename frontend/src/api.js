export class ApiError extends Error {
  constructor(message, status, issues) {
    super(message)
    this.status = status
    this.issues = issues || null
  }
}

async function request(path, { method = 'GET', body, headers } = {}) {
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
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
    throw new ApiError(detail || `요청이 실패했어요. (${res.status})`, res.status, data?.issues)
  }
  return data
}

const key = (k) => ({ 'X-Edit-Key': k })

export const api = {
  health: () => request('/health'),
  cases: () => request('/cases'),
  caseSummary: (id) => request(`/cases/${encodeURIComponent(id)}`),
  newGame: (caseId) => request('/games', { method: 'POST', body: { case_id: caseId } }),
  game: (id) => request(`/games/${id}`),
  ask: (id, question) => request(`/games/${id}/questions`, { method: 'POST', body: { question } }),
  accuse: (id, culpritId, explanation) =>
    request(`/games/${id}/accusation`, { method: 'POST', body: { culprit_id: culpritId, explanation } }),
  studio: {
    generate: (brief) => request('/studio/generate', { method: 'POST', body: brief }),
    review: (c) => request('/studio/review', { method: 'POST', body: { case: c } }),
    save: (c) => request('/studio/cases', { method: 'POST', body: { case: c } }),
    load: (id, k) => request(`/studio/cases/${id}`, { headers: key(k) }),
    update: (id, k, c) => request(`/studio/cases/${id}`, { method: 'PUT', body: { case: c }, headers: key(k) }),
    remove: (id, k) => request(`/studio/cases/${id}`, { method: 'DELETE', headers: key(k) }),
  },
}

// 브라우저 저장소는 막혀 있을 수 있어서 항상 try/catch로 감싼다.
export const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k)
      return v == null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(k, value) {
    try {
      if (value == null) localStorage.removeItem(k)
      else localStorage.setItem(k, JSON.stringify(value))
    } catch {
      /* 무시 */
    }
  },
}

export const shareLink = (id) => `${window.location.origin}/?case=${id}`

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const t = document.createElement('textarea')
      t.value = text
      t.style.position = 'fixed'
      t.style.opacity = '0'
      document.body.appendChild(t)
      t.select()
      const ok = document.execCommand('copy')
      t.remove()
      return ok
    } catch {
      return false
    }
  }
}
