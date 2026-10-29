export default function FictionNote({ motif, compact = false }) {
  return (
    <section className={`fiction ${compact ? 'compact' : ''}`} aria-label="허구 결말 안내">
      <div className="fiction-mark">결말은 허구</div>
      <div>
        <p>
          RE:CASE의 사건은 한국에서 실제로 있었던 <strong>미제사건</strong>에서 모티프를 얻었습니다
          {motif ? ` (모티프: ${motif})` : ''}.
        </p>
        <p>
          미제사건은 아직 결말이 없기 때문에, 게임 속 <strong>인물 · 장소 · 결말은 모두 허구</strong>로 새로
          만들었습니다. 게임의 결말을 실제 사건의 진실로 받아들이지 말아 주세요.
        </p>
        {!compact && <p className="muted">실제 사건의 피해자와 유가족을 존중하는 마음으로 플레이해 주세요.</p>}
      </div>
    </section>
  )
}
