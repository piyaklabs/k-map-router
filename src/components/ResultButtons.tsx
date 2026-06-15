import { useState } from "react";
import {
  type Destination,
  type Mode,
  defaultMode,
  haversineKm,
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
 * 목적지 카드 + 이동수단 토글 + 네이버(primary)/카카오(secondary) 실행 버튼.
 * 이동수단: 출발지가 있고 가까우면(≤1.2km) 도보가 기본, 아니면 대중교통. 토글로 1탭 전환.
 */
export default function ResultButtons({ dest, origin, onRemoveOrigin }: Props) {
  const platform = detectPlatform();
  const isMobile = platform !== "desktop";
  const [mode, setMode] = useState<Mode>(() => defaultMode(dest, origin));

  const km = origin ? haversineKm(origin, dest) : null;

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
              {km !== null && (
                <span className="ml-1 text-stone-400">· {km.toFixed(1)} km</span>
              )}
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

      {/* 이동수단 토글 */}
      <div
        role="group"
        aria-label="Travel mode"
        className="flex gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1"
      >
        {(
          [
            { key: "walk", label: "🚶 Walk" },
            { key: "transit", label: "🚌 Transit" },
          ] as { key: Mode; label: string }[]
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            aria-pressed={mode === m.key}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              mode === m.key
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => openNaver(dest, origin, mode, platform)}
        className="w-full rounded-xl bg-naver py-4 font-semibold text-white shadow-lg shadow-naver/25 transition active:scale-[0.98] active:bg-naver-deep"
      >
        Open in NAVER Map →
      </button>

      <button
        type="button"
        onClick={() => openKakao(dest, origin, mode, platform)}
        className="w-full rounded-xl bg-kakao py-3.5 font-semibold text-stone-900 transition active:scale-[0.98] active:bg-kakao-deep"
      >
        Open in KakaoMap
      </button>
    </div>
  );
}
