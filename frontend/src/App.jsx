import { useCallback, useEffect, useState } from 'react'
import { api, store } from './api.js'
import Home from './components/Home.jsx'
import Gate from './components/Gate.jsx'
import Play from './components/Play.jsx'
import Result from './components/Result.jsx'
import Studio from './components/Studio.jsx'
import { rainOff, rainOn } from './ambience.js'

const SAVED = 'recase.games' // { caseId: gameId } 진행 중인 게임
const MINE = 'recase.mine' // [{ id, key, title, source, created }] 내가 만든 사건 (수정 키는 이 브라우저에만)
const DETECTIVE = 'recase.detective' // 담당 수사관 이름

export default function App() {
  const [screen, setScreen] = useState('home')
  const [cases, setCases] = useState(null)
  const [health, setHealth] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [game, setGame] = useState(null)
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [saved, setSaved] = useState(() => store.get(SAVED, {}))
  const [mine, setMine] = useState(() => store.get(MINE, []))
  const [studio, setStudio] = useState({ mode: 'ai', editing: null })
  const [detective, setDetective] = useState(() => store.get(DETECTIVE, ''))
  const [rain, setRain] = useState(false)

  const nameDetective = (name) => {
    setDetective(name)
    store.set(DETECTIVE, name || null)
  }
  const toggleRain = () => {
    if (rain) {
      rainOff()
      setRain(false)
    } else if (rainOn()) setRain(true)
    else setToast('이 브라우저에서는 빗소리를 재생할 수 없어요.')
  }
  const desk = { detective, rain, onDetective: nameDetective, onRain: toggleRain }

  const remember = useCallback((caseId, gameId) => {
    setSaved((prev) => {
      const next = { ...prev }
      if (gameId) next[caseId] = gameId
      else delete next[caseId]
      store.set(SAVED, next)
      return next
    })
  }, [])

  const updateMine = useCallback((fn) => {
    setMine((prev) => {
      const next = fn(prev)
      store.set(MINE, next)
      return next
    })
  }, [])

  const load = useCallback(() => {
    setLoadError('')
    Promise.all([api.cases(), api.health()])
      .then(([c, h]) => {
        setCases(c)
        setHealth(h)
      })
      .catch((e) => setLoadError(e.message))
  }, [])

  useEffect(load, [load])

  // 공유 링크(/?case=코드)로 들어오면 바로 그 사건의 안내 창을 연다
  const openById = useCallback(async (id) => {
    const code = (id || '').trim().toLowerCase()
    if (!code) return
    try {
      setGate(await api.caseSummary(code))
    } catch (e) {
      setToast(e.status === 404 ? '그 코드의 사건을 찾지 못했어요. 코드를 다시 확인해 주세요.' : e.message)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const shared = params.get('case')
    if (shared) {
      window.history.replaceState(null, '', window.location.pathname)
      openById(shared)
    }
  }, [openById])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4200)
    return () => clearTimeout(t)
  }, [toast])

  const go = (next) => {
    setScreen(next)
    window.scrollTo(0, 0)
  }

  const start = async (caseInfo) => {
    setBusy(true)
    try {
      const state = await api.newGame(caseInfo.id)
      remember(caseInfo.id, state.game_id)
      setGame(state)
      setGate(null)
      go('play')
    } catch (e) {
      setToast(e.message)
    } finally {
      setBusy(false)
    }
  }

  const resume = async (caseInfo) => {
    const id = saved[caseInfo.id]
    try {
      const state = await api.game(id)
      setGame(state)
      go(state.finished ? 'result' : 'play')
    } catch (e) {
      remember(caseInfo.id, null)
      if (e.status === 404) {
        setToast('이전 수사 기록이 만료되어 새로 시작해요.')
        setGate(caseInfo)
      } else setToast(e.message)
    }
  }

  const finished = (result) => {
    remember(game.case.id, null)
    setGame((g) => ({ ...g, finished: true, result }))
    go('result')
  }

  const openStudio = (mode = 'ai', editing = null) => {
    setStudio({ mode, editing })
    go('studio')
  }

  const created = (summary, key) =>
    updateMine((prev) => [
      { id: summary.id, key, title: summary.title, source: summary.basis, created: Date.now() },
      ...prev.filter((m) => m.id !== summary.id),
    ])

  const renamed = (id, title) => updateMine((prev) => prev.map((m) => (m.id === id ? { ...m, title } : m)))
  const removed = (id) => updateMine((prev) => prev.filter((m) => m.id !== id))

  return (
    <>
      {screen === 'home' && (
        <Home
          {...desk}
          cases={cases}
          health={health}
          error={loadError}
          saved={saved}
          mine={mine}
          onRetry={load}
          onStart={(c) => setGate(c)}
          onResume={resume}
          onOpenCode={openById}
          onStudio={openStudio}
          onForget={removed}
          toast={setToast}
        />
      )}
      {screen === 'play' && game && (
        <Play {...desk} game={game} setGame={setGame} health={health} onHome={() => go('home')} onFinished={finished} />
      )}
      {screen === 'result' && game?.result && (
        <Result
          detective={detective}
          game={game}
          onHome={() => go('home')}
          onReplay={() => setGate(cases?.find((c) => c.id === game.case.id) || game.case)}
        />
      )}
      {screen === 'studio' && (
        <Studio
          key={`${studio.mode}-${studio.editing?.id || 'new'}`}
          initialMode={studio.mode}
          editing={studio.editing}
          health={health}
          onHome={() => go('home')}
          onPlay={(summary) => setGate(summary)}
          onCreated={created}
          onRenamed={renamed}
          onRemoved={(id) => {
            removed(id)
            go('home')
            setToast('사건을 삭제했어요.')
          }}
          toast={setToast}
        />
      )}
      {gate && <Gate caseInfo={gate} detective={detective} busy={busy} onCancel={() => setGate(null)} onConfirm={() => start(gate)} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
