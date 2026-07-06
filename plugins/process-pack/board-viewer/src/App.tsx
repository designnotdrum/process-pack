import { useCallback, useEffect, useRef, useState } from "react";
import { type BoardData, parseBoard, safeParseJson } from "./lib/board";
import { DropZone } from "./components/DropZone";
import { GanttView } from "./components/GanttView";
import { Header, type ViewMode } from "./components/Header";
import { KanbanView } from "./components/KanbanView";

type Status = "loading" | "empty" | "ready";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<BoardData | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("gantt");
  const headerFileInput = useRef<HTMLInputElement>(null);

  const applyText = useCallback((text: string) => {
    const { value, error: jsonError } = safeParseJson(text);
    if (jsonError) {
      setReason(`That file isn't valid JSON (${jsonError}).`);
      setStatus("empty");
      return;
    }

    const { data: parsed, error: parseError, warnings } = parseBoard(value);
    if (parseError || !parsed) {
      setReason(parseError ?? "Could not read this as board data.");
      setStatus("empty");
      return;
    }

    if (warnings.length > 0) {
      console.warn("board-viewer: tolerated issues while parsing board.json:", warnings);
    }

    setData(parsed);
    setReason(null);
    setStatus("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("./board.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) applyText(text);
      })
      .catch(() => {
        if (cancelled) return;
        setReason(
          "Couldn't fetch board.json automatically — expected when this page was opened directly from disk (file://) rather than served over http. Drop the file below or choose it."
        );
        setStatus("empty");
      });

    return () => {
      cancelled = true;
    };
  }, [applyText]);

  const handleHeaderFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") applyText(reader.result);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex h-full flex-col">
      <input
        ref={headerFileInput}
        type="file"
        accept=".json,application/json"
        onChange={handleHeaderFilePick}
        className="hidden"
      />

      {status === "loading" && (
        <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
          loading board…
        </div>
      )}

      {status === "empty" && (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
          <p className="text-xs font-semibold tracking-wide text-[var(--text-faint)] uppercase">
            board viewer
          </p>
          <div className="w-full max-w-md">
            <DropZone onFile={applyText} reason={reason} />
          </div>
        </div>
      )}

      {status === "ready" && data && (
        <>
          <Header
            board={data.board}
            laneCount={data.lanes.length}
            onRequestFile={() => headerFileInput.current?.click()}
            onViewChange={setView}
            view={view}
          />
          <main className="min-h-0 flex-1">
            {view === "gantt" ? <GanttView lanes={data.lanes} /> : <KanbanView lanes={data.lanes} />}
          </main>
        </>
      )}
    </div>
  );
}
