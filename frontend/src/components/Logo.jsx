export default function Logo({ large = false }) {
  return (
    <span className={`logo ${large ? 'large' : ''}`} aria-label="RE:CASE">
      RE<span className="logo-colon">:</span>CASE
    </span>
  )
}
