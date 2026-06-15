import { useRef, useState } from "react";

interface Props {
  onSubmit: (url: string) => void;
  busy: boolean;
}

/**
 * 클라이언트 즉시 검증 (PRD §6a — 서버 왕복 전 하이라이트).
 * goo.gl/maps(폐기 링크)는 통과시켜 서버의 dead_shortener 안내를 받게 한다.
 */
export function looksLikeGoogleMapsLink(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl" || host === "www.goo.gl") {
    return u.pathname.startsWith("/maps");
  }
  const isGoogle =
    host === "google.com" ||
    host === "google.co.kr" ||
    host.endsWith(".google.com") ||
    host.endsWith(".google.co.kr");
  return isGoogle && (host.startsWith("maps.") || u.pathname.includes("/maps"));
}

export default function LinkInput({ onSubmit, busy }: Props) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;
    if (!looksLikeGoogleMapsLink(trimmed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setHint(null);
    onSubmit(trimmed);
  }

  /** 수동 붙여넣기 폴백 (PRD §5.2 — iOS 권한 거부/미지원 대비). */
  function manualPasteFallback() {
    setHint(
      "Couldn't read the clipboard — tap the box above, long-press, then Paste.",
    );
    inputRef.current?.focus();
  }

  /**
   * ClipboardItem들에서 URL/텍스트 추출.
   * ⚠️ iOS 실측: 구글맵 앱 "링크 복사"는 URL 타입(text/uri-list)으로 들어가
   * readText()(text/plain 전용)가 빈 문자열을 반환한다 → uri-list를 먼저 본다.
   * 타입별 getType()이 iOS에서 간헐 실패하므로 각 타입을 try/catch로 감싸 넘어간다.
   */
  async function extractFromItems(items: ClipboardItems): Promise<string> {
    for (const item of items) {
      for (const type of ["text/uri-list", "text/plain", "text/html"]) {
        if (!item.types.includes(type)) continue;
        try {
          let text = (await (await item.getType(type)).text()).trim();
          if (type === "text/uri-list") {
            text =
              text
                .split("\n")
                .map((l) => l.trim())
                .find((l) => l && !l.startsWith("#")) ?? "";
          } else if (type === "text/html") {
            const href = text.match(/href="([^"]+)"/);
            text = href ? href[1] : text.replace(/<[^>]+>/g, " ").trim();
          }
          if (text) return text;
        } catch {
          /* 이 타입 실패 → 다음 타입 시도 */
        }
      }
    }
    return "";
  }

  async function pasteFromClipboard() {
    setHint(null);
    setInvalid(false);
    const clip = navigator.clipboard;
    if (!clip) {
      manualPasteFallback();
      return;
    }
    // iOS는 "붙여넣기" 말풍선을 띄우고 탭을 기다린다. 타임아웃으로 race하면
    // 사용자가 탭하기 전에 실패로 떨어지므로(이전 버그) 절대 race하지 않는다.
    // 말풍선이 떴을 때를 대비한 안내만 살짝 띄운다.
    const bubbleHint = window.setTimeout(
      () => setHint('If a "Paste" button appears, tap it to allow.'),
      600,
    );
    try {
      let text = "";
      // 1) read() — URL 타입(구글맵 링크 복사) 처리
      if (clip.read) {
        try {
          text = await extractFromItems(await clip.read());
        } catch {
          /* read 거부/실패 → readText로 폴백 */
        }
      }
      // 2) readText() — 일반 텍스트 클립보드 / read() 미지원 브라우저(데스크톱 등)
      if (!text && clip.readText) {
        try {
          text = (await clip.readText()).trim();
        } catch {
          /* 무시 → 수동 폴백 */
        }
      }
      window.clearTimeout(bubbleHint);
      setHint(null);
      if (!text) {
        manualPasteFallback();
        return;
      }
      setValue(text);
      submit(text);
    } catch {
      window.clearTimeout(bubbleHint);
      manualPasteFallback();
    }
  }

  const hasValue = value.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="flex flex-col gap-3"
    >
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        enterKeyHint="go"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://maps.app.goo.gl/…"
        value={value}
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text").trim();
          if (text) {
            e.preventDefault();
            setValue(text);
            submit(text);
          }
        }}
        aria-invalid={invalid}
        aria-label="Google Maps share link"
        className={`w-full rounded-xl border bg-white px-4 py-3.5 text-[15px] text-stone-900 placeholder:text-stone-400 outline-none transition-shadow disabled:opacity-60 ${
          invalid
            ? "border-rose-400 ring-2 ring-rose-200"
            : "border-stone-200 shadow-sm focus:border-stone-400 focus:ring-2 focus:ring-stone-200"
        }`}
      />

      {invalid && (
        <p role="alert" className="text-sm text-rose-600">
          Please enter a valid Google Maps share link.
        </p>
      )}
      {hint && <p className="text-sm text-stone-500">{hint}</p>}

      {hasValue ? (
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-stone-900 py-3.5 font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
        >
          Get directions →
        </button>
      ) : (
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={busy}
          className="w-full rounded-xl bg-stone-900 py-3.5 font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
        >
          📋 Paste from clipboard
        </button>
      )}
    </form>
  );
}
