import { useCallback, useEffect, useState } from 'react'
import { api, store } from './api.js'
import Home from './components/Home.jsx'
import Gate from './components/Gate.jsx'
import Play from './components/Play.jsx'
import Result from './components/Result.jsx'

const SAVED = 'recase.games' // { caseId: gameId } 진행 중인 게임

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

  const remember = useCallback((caseId, gameId) => {
    setSaved((prev) => {
      const next = { ...prev }
      if (gameId) next[caseId] = gameId
      else delete next[caseId]
      store.set(SAVED, next)
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

  const caseSummary = (id) => cases?.find((c) => c.id === id)

  return (
    <>
      {screen === 'home' && (
        <Home
          cases={cases}
          health={health}
          error={loadError}
          saved={saved}
          onRetry={load}
          onStart={(c) => setGate(c)}
          onResume={resume}
        />
      )}
      {screen === 'play' && game && (
        <Play game={game} setGame={setGame} health={health} onHome={() => go('home')} onFinished={finished} />
      )}
      {screen === 'result' && game?.result && (
        <Result
          game={game}
          onHome={() => go('home')}
          onReplay={() => setGate(caseSummary(game.case.id) || game.case)}
        />
      )}
      {gate && <Gate caseInfo={gate} busy={busy} onCancel={() => setGate(null)} onConfirm={() => start(gate)} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
