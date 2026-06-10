import {
  type Destination,
  openKakao,
  openNaver,
} from "../lib/deeplink";
import { detectPlatform } from "../lib/ua";

interface Props {
  dest: Destination;
}

/** 목적지 카드 + 네이버(primary)/카카오(secondary) 실행 버튼 (CLAUDE.md §6). */
export default function ResultButtons({ dest }: Props) {
  const platform = detectPlatform();

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="font-semibold text-stone-900">
          📍 {dest.name ?? "Destination found"}
        </p>
        <p className="mt-1 font-mono text-sm text-stone-500">
          {dest.lat.toFixed(6)}, {dest.lng.toFixed(6)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => openNaver(dest, platform)}
        className="w-full rounded-xl bg-naver py-4 font-semibold text-white shadow-lg shadow-naver/25 transition active:scale-[0.98] active:bg-naver-deep"
      >
        Open in NAVER Map →
      </button>

      <button
        type="button"
        onClick={() => openKakao(dest, platform)}
        className="w-full rounded-xl bg-kakao py-3.5 font-semibold text-stone-900 transition active:scale-[0.98] active:bg-kakao-deep"
      >
        Open in KakaoMap
      </button>
    </div>
  );
}
