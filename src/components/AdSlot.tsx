/**
 * 정적 광고 슬롯 — MVP는 빈 컴포넌트 (PRD §6 수익화 대비).
 * 자리만 예약해 두어 실집행 시 레이아웃 시프트가 없게 한다.
 */
export default function AdSlot() {
  return <div data-ad-slot aria-hidden="true" className="min-h-14" />;
}
