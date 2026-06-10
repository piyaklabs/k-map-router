import {
  type Destination,
  openKakao,
  openNaver,
} from "../lib/deeplink";
import { detectPlatform } from "../lib/ua";

interface Props {
  dest: Destination;
  origin: Destination | null;
  onRemoveOrigin: () => void;
}

/**
 * 목적지 카드 + 네이버(primary)/카카오(secondary) 실행 버튼 (CLAUDE.md §6).
 * A→B 링크면 출발지를 표시하고, ✕로 제거해 "내 위치 출발"로 전환할 수 있다.
 */
export default function ResultButtons({ dest, origin, onRemoveOrigin }: Props) {
  const platform = detectPlatform();
  const isMobile = platform !== "desktop";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        {origin ? (
          <div className="mb-3 flex items-start justify-between gap-2 border-b border-stone-100 pb-3">
            <p className="min-w-0 text-sm text-stone-500">
              <span className="mr-1 font-medium uppercase tracking-wide text-[11px] text-stone-400">
                From
              </span>
              {origin.name ??
                `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`}
            </p>
            <button
              type="button"
              onClick={onRemoveOrigin}
              aria-label="Remove starting point and use my current location"
              title="Use my current location instead"
              className="shrink-0 rounded-full px-2 py-0.5 text-xs text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
            >
              ✕
            </button>
          </div>
        ) : (
          isMobile && (
            <p className="mb-3 border-b border-stone-100 pb-3 text-sm text-stone-400">
              <span className="mr-1 font-medium uppercase tracking-wide text-[11px]">
                From
              </span>
              your current location
            </p>
          )
        )}

        <p className="font-semibold text-stone-900">
          📍 {dest.name ?? "Destination found"}
        </p>
        <p className="mt-1 font-mono text-sm text-stone-500">
          {dest.lat.toFixed(6)}, {dest.lng.toFixed(6)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => openNaver(dest, origin, platform)}
        className="w-full rounded-xl bg-naver py-4 font-semibold text-white shadow-lg shadow-naver/25 transition active:scale-[0.98] active:bg-naver-deep"
      >
        Open in NAVER Map →
      </button>

      <button
        type="button"
        onClick={() => openKakao(dest, origin, platform)}
        className="w-full rounded-xl bg-kakao py-3.5 font-semibold text-stone-900 transition active:scale-[0.98] active:bg-kakao-deep"
      >
        Open in KakaoMap
      </button>
    </div>
  );
}
