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

  /** 수동 붙여넣기 폴백 (클립보드 읽기 거부/미지원 시 — PRD §5.2). */
  function manualPasteFallback() {
    setHint(
      "Couldn't read the clipboard — tap the field above, long-press, then Paste.",
    );
    inputRef.current?.focus();
  }

  /**
   * 단일 ClipboardItem에서 URL/텍스트 추출. getType은 이미 읽은 item에서 꺼내는 거라
   * 권한 재요청이 없다(여러 번 호출 안전). 우선순위: uri-list → plain → html.
   * ⚠️ 구글맵 "링크 복사"는 iOS에서 text/uri-list 타입으로만 들어온다.
   */
  async function extractUrl(item: ClipboardItem): Promise<string> {
    for (const type of ["text/uri-list", "text/plain", "text/html"]) {
      if (!item.types.includes(type)) continue;
      try {
        const raw = (await (await item.getType(type)).text()).trim();
        if (type === "text/uri-list") {
          const line = raw
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith("#"));
          if (line) return line;
        } else if (type === "text/html") {
          const href = raw.match(/href="([^"]+)"/);
          const t = (href ? href[1] : raw.replace(/<[^>]+>/g, " ")).trim();
          if (t) return t;
        } else if (raw) {
          return raw;
        }
      } catch {
        /* 이 타입 실패 → 다음 타입 */
      }
    }
    return "";
  }

  async function pasteFromClipboard() {
    setHint(null);
    setInvalid(false);
    const clip = navigator.clipboard;
    if (!clip?.read && !clip?.readText) {
      manualPasteFallback();
      return;
    }
    // ⚠️ iOS(WebKit)는 await 이후 user activation이 만료돼 "두 번째" 클립보드 호출이
    //    막힌다. 그래서 read→readText 폴백 체인이 깨졌었다 → 제스처 안에서 딱 한 번만 호출.
    //    "Paste" 권한 말풍선은 iOS가 강제하는 것이라 제거 불가(정상 동작).
    const bubbleHint = window.setTimeout(
      () => setHint('If a "Paste" button appears, tap it to allow.'),
      600,
    );
    try {
      let text = "";
      if (clip.read) {
        const items = await clip.read();
        for (const item of items) {
          text = await extractUrl(item);
          if (text) break;
        }
      } else if (clip.readText) {
        text = (await clip.readText()).trim();
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
