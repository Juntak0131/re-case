import React from 'react'
import { createRoot } from 'react-dom/client'
// 글꼴은 모두 패키지로 묶어 두어 인터넷이 없어도 화면이 깨지지 않는다
// 송명: 인쇄된 문서(제목 · 기록 본문) / 나눔고딕코딩: 타자기로 친 조서 / 독도: 형사의 손글씨 / Pretendard: 화면 조작
import '@fontsource/song-myung/400.css'
import '@fontsource/nanum-gothic-coding/400.css'
import '@fontsource/nanum-gothic-coding/700.css'
import '@fontsource/dokdo/400.css'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
