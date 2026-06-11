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

  async function pasteFromClipboard() {
    setHint(null);
    setInvalid(false);
    if (!navigator.clipboard?.readText) {
      manualPasteFallback();
      return;
    }
    // iOS는 허용 말풍선("Paste")을 띄움 — 안 누르면 promise가 조용히 멈춘 것처럼 보임.
    // 잠깐 뒤 안내를 띄우고, 오래 걸리면 타임아웃 후 수동 폴백으로.
    const bubbleHint = window.setTimeout(
      () => setHint('If a "Paste" bubble appeared, tap it to allow.'),
      400,
    );
    try {
      const text = (
        await Promise.race([
          navigator.clipboard.readText(),
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error("timeout")), 4000),
          ),
        ])
      ).trim();
      window.clearTimeout(bubbleHint);
      setHint(null);
      if (!text) {
        setHint("Clipboard is empty — copy a Google Maps link first.");
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
