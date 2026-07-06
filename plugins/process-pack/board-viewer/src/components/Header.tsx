import type { BoardMeta } from "../lib/board";
import type { ThemeMode } from "../lib/theme";
import { isStale, relativeFromNow } from "../lib/time";
import { IconAlert, IconFile, IconGantt, IconKanban, IconMoon, IconSun, IconSystem } from "./icons";

export type ViewMode = "gantt" | "kanban";

interface HeaderProps {
  board: BoardMeta;
  laneCount: number;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onRequestFile: () => void;
  themeMode: ThemeMode;
  onThemeChange: (m: ThemeMode) => void;
}

export function Header({
  board,
  laneCount,
  view,
  onViewChange,
  onRequestFile,
  themeMode,
  onThemeChange,
}: HeaderProps) {
  const stale = isStale(board.updatedAt);

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--bg)]/95 px-3 py-2.5 backdrop-blur sm:px-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-[var(--text)]">
            {board.session ? board.session : "Board"}
          </h1>
          <span className="text-[11px] text-[var(--text-faint)]">
            {laneCount} lane{laneCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span>updated {relativeFromNow(board.updatedAt)}</span>
          {stale && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
              style={{
                color: "var(--warn-text)",
                background: "var(--warn-bg)",
                border: "1px solid var(--warn-border)",
              }}
              title="Board data is more than 30 minutes old"
            >
              <IconAlert width={11} height={11} />
              stale
            </span>
          )}
        </div>
      </div>

      <ThemeToggle mode={themeMode} onChange={onThemeChange} />

      <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-0.5">
        <ViewToggleButton
          active={view === "gantt"}
          onClick={() => onViewChange("gantt")}
          icon={<IconGantt width={14} height={14} />}
          label="Gantt"
        />
        <ViewToggleButton
          active={view === "kanban"}
          onClick={() => onViewChange("kanban")}
          icon={<IconKanban width={14} height={14} />}
          label="Kanban"
        />
      </div>

      <button
        type="button"
        onClick={onRequestFile}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        title="Load a different board.json"
      >
        <IconFile width={13} height={13} />
        Load file
      </button>
    </header>
  );
}

function ThemeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const options: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: "system", icon: <IconSystem width={13} height={13} />, label: "System" },
    { mode: "light", icon: <IconSun width={13} height={13} />, label: "Light" },
    { mode: "dark", icon: <IconMoon width={13} height={13} />, label: "Dark" },
  ];

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-0.5"
      role="group"
      aria-label="Theme"
    >
      {options.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          onClick={() => onChange(opt.mode)}
          aria-pressed={mode === opt.mode}
          title={`${opt.label} theme`}
          aria-label={`${opt.label} theme`}
          className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
            mode === opt.mode
              ? "bg-[var(--bg-sunken)] text-[var(--text)] shadow-sm"
              : "text-[var(--text-faint)] hover:text-[var(--text-muted)]"
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
        active
          ? "bg-[var(--bg-sunken)] text-[var(--text)] shadow-sm"
          : "text-[var(--text-muted)] hover:text-[var(--text)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
