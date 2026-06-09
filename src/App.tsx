import { useState } from "react";
import AdSlot from "./components/AdSlot";
import LinkInput from "./components/LinkInput";
import ResultButtons from "./components/ResultButtons";
import type { Destination } from "./lib/deeplink";

type State =
  | { phase: "idle" }
  | { phase: "resolving" }
  | { phase: "success"; dest: Destination }
  | { phase: "error"; message: string };

const GENERIC_ERROR =
  "We couldn't read that link. Please copy it again from Google Maps and retry.";

export default function App() {
  const [state, setState] = useState<State>({ phase: "idle" });
  // 입력 초기화(PRD §6b): key를 바꿔 LinkInput을 리마운트해 값까지 비운다.
  const [inputKey, setInputKey] = useState(0);

  async function handleSubmit(url: string) {
    setState({ phase: "resolving" });
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data: {
        success: boolean;
        lat?: number;
        lng?: number;
        name?: string | null;
        message?: string;
      } = await res.json();

      if (data.success && data.lat != null && data.lng != null) {
        setState({
          phase: "success",
          dest: { lat: data.lat, lng: data.lng, name: data.name ?? null },
        });
      } else {
        setState({ phase: "error", message: data.message || GENERIC_ERROR });
      }
    } catch {
      setState({
        phase: "error",
        message: "Network error — please check your connection and try again.",
      });
    }
  }

  function reset() {
    setInputKey((k) => k + 1);
    setState({ phase: "idle" });
  }

  const busy = state.phase === "resolving";

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 font-sans text-stone-900 antialiased">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">K-Map Router</h1>
          <p className="mt-2 text-stone-500">
            Google Maps links → Korean navigation
          </p>
        </header>

        {state.phase === "success" ? (
          <div className="flex flex-col gap-4">
            <ResultButtons dest={state.dest} />
            <button
              type="button"
              onClick={reset}
              className="py-2 text-sm font-medium text-stone-500 transition hover:text-stone-700"
            >
              ← Convert another link
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <LinkInput key={inputKey} onSubmit={handleSubmit} busy={busy} />

            {state.phase === "resolving" && (
              <div className="animate-pulse rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-stone-500">
                  Finding your destination…
                </p>
                <div className="mt-3 h-3 w-2/3 rounded bg-stone-200" />
                <div className="mt-2 h-3 w-1/3 rounded bg-stone-200" />
              </div>
            )}

            {state.phase === "error" && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 p-4"
              >
                <p className="text-sm text-rose-700">{state.message}</p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-3 text-sm font-medium text-rose-700 underline underline-offset-2"
                >
                  Try another link
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="mx-auto w-full max-w-md px-5 pb-6">
        <AdSlot />
        <p className="mt-3 text-center text-xs text-stone-400">
          No sign-up · Nothing stored · Works in your browser
        </p>
      </footer>
    </div>
  );
}
