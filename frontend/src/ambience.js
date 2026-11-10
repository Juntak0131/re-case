// 빗소리 — 음원 파일 없이 브라우저에서 직접 만든다 (기본은 꺼짐, 버튼을 눌러야 켜진다)
let ctx = null
let master = null
let source = null

function rainBuffer(ac, seconds = 6) {
  const rate = ac.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ac.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    // 바탕: 부드러운 노이즈(빗줄기)
    let b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.997 * b0 + w * 0.029
      b1 = 0.985 * b1 + w * 0.032
      b2 = 0.95 * b2 + w * 0.048
      d[i] = (b0 + b1 + b2 + w * 0.05) * 0.32
    }
    // 창문에 떨어지는 빗방울
    const drops = seconds * 70
    for (let k = 0; k < drops; k++) {
      const at = Math.floor(Math.random() * (len - rate * 0.02))
      const f = 1800 + Math.random() * 4200
      const amp = 0.04 + Math.random() * 0.16
      const n = Math.floor(rate * (0.004 + Math.random() * 0.01))
      for (let j = 0; j < n; j++) {
        d[at + j] += Math.sin((2 * Math.PI * f * j) / rate) * amp * Math.exp(-j / (n / 5))
      }
    }
    // 이음매가 튀지 않게 끝을 처음과 섞는다
    const fade = Math.floor(rate * 0.25)
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      d[i] = d[i] * t + d[len - fade + i] * (1 - t)
    }
  }
  return buf
}

export function rainOn() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    if (!ctx) {
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0
      const low = ctx.createBiquadFilter()
      low.type = 'lowpass'
      low.frequency.value = 5200
      const high = ctx.createBiquadFilter()
      high.type = 'highpass'
      high.frequency.value = 120
      low.connect(high).connect(master).connect(ctx.destination)
      source = ctx.createBufferSource()
      source.buffer = rainBuffer(ctx)
      source.loop = true
      source.connect(low)
      source.start()
    }
    ctx.resume()
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.6)
    return true
  } catch {
    return false
  }
}

export function rainOff() {
  if (!ctx || !master) return
  master.gain.cancelScheduledValues(ctx.currentTime)
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.25)
  setTimeout(() => ctx && master.gain.value < 0.01 && ctx.suspend(), 1500)
}
