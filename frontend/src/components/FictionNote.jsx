// 사건 종류에 따라 '무엇이 사실이고 무엇이 허구인지' 알려 주는 안내
const RESPECT = <p className="muted">실제 사건의 피해자와 유가족을 존중하는 마음으로 플레이해 주세요.</p>

const TEXT = {
  solved: {
    mark: '진범 확인',
    body: (basis) => (
      <>
        <p>
          이 사건은 <strong>진범이 밝혀진 실제 사건</strong>이에요{basis ? ` (${basis})` : ''}. 결말은 공개된 수사 기록을 따랐고,{' '}
          <strong>등장인물 이름만 가상</strong>으로 바꿨어요.
        </p>
        {RESPECT}
      </>
    ),
  },
  real: {
    mark: '결말은 허구',
    body: (basis, region) => (
      <>
        <p>
          사건 이름과 <strong>‘실제 기록’ 표시가 붙은 자료는 사실</strong>이에요{basis ? ` (${basis})` : ''}. 등장인물 이름은 모두 가상이에요.
        </p>
        <p>
          이 사건은 실제로 아직 풀리지 않았기 때문에, <strong>범인과 결말은 허구</strong>로 만들었어요. 게임의 결말을 실제 사건의 진실로 받아들이지
          말아 주세요.
        </p>
        {region === 'korea' && RESPECT}
      </>
    ),
  },
  user: {
    mark: '사용자 사건',
    body: () => (
      <p>
        이 사건은 RE:CASE 사용자가 만든 <strong>가상의 사건</strong>이에요. 실제 인물이나 사건과는 관계가 없어요.
      </p>
    ),
  },
  all: {
    mark: '결말은 허구',
    body: () => (
      <>
        <p>
          RE:CASE의 사건은 모두 <strong>실제 사건</strong>이에요. 사건 이름과 공개된 기록은 그대로 두고, <strong>등장인물 이름은 가상</strong>
          으로 바꿨어요. 아직 풀리지 않은 사건의 <strong>범인과 결말은 허구</strong>이고, 진범이 밝혀진 사건은 기록 그대로예요.
        </p>
        {RESPECT}
      </>
    ),
  },
}

export default function FictionNote({ kind = 'all', basis, solved = false, region, compact = false }) {
  const t = (kind === 'real' && solved ? TEXT.solved : TEXT[kind]) || TEXT.all
  return (
    <section className={`fiction ${compact ? 'compact' : ''}`} aria-label="사실과 허구 안내">
      <div className="fiction-mark">{t.mark}</div>
      <div>{t.body(basis, region)}</div>
    </section>
  )
}
