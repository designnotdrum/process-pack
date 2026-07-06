import { useRef, useState } from "react";
import { IconFile, IconUpload } from "./icons";

interface DropZoneProps {
  reason: string | null;
  onFile: (text: string) => void;
  compact?: boolean;
}

/**
 * Drag-and-drop + file-picker fallback for loading board.json.
 *
 * `fetch('./board.json')` only works when the page is served over http(s);
 * opened via file:// it fails with a CORS error in every major browser. This
 * is the fallback that keeps a built, standalone dist/index.html usable:
 * drop the file anywhere on it, or pick it from disk.
 */
export function DropZone({ reason, onFile, compact = false }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onFile(reader.result);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  };

  return (
    <div
      data-testid="board-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 text-center transition-colors ${
        dragging ? "border-[var(--state-running)] bg-[var(--bg-raised)]" : "border-[var(--border)]"
      } ${compact ? "py-6" : "py-16"}`}
    >
      <IconUpload width={compact ? 20 : 28} height={compact ? 20 : 28} className="text-[var(--text-faint)]" />
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-[var(--text)]">
          {compact ? "Load a board.json" : "No board data loaded"}
        </p>
        {reason && <p className="text-xs text-[var(--text-muted)]">{reason}</p>}
        <p className="text-xs text-[var(--text-faint)]">Drop a board.json file here, or</p>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--state-running)]"
      >
        <IconFile width={13} height={13} />
        Choose file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={handlePick}
        className="hidden"
        data-testid="board-file-input"
      />
    </div>
  );
}
