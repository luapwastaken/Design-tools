import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { MenuHost, ToastHost } from '../ui/index.ts';
import { useShell } from './core/index.ts';
import { LibraryPanel } from './LibraryPanel.tsx';
import { Rail } from './Rail.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';
import { StatusBar } from './StatusBar.tsx';
import { TitleBar } from './TitleBar.tsx';
import { ToolHost } from './ToolHost.tsx';
import s from './App.module.css';

// brief §5: the rail collapses to icons below a 1440px window
const narrow = matchMedia('(max-width: 1439.98px)');
const onNarrow = (fn: () => void) => {
  narrow.addEventListener('change', fn);
  return () => narrow.removeEventListener('change', fn);
};

// below `roomy` the kind filter takes its short labels
const LIB = { min: 240, max: 420, reset: 300, roomy: 290, key: 'dt.libraryWidth' };
// a per-machine view preference; storage failing only means the default width
function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(LIB.key));
    return v >= LIB.min && v <= LIB.max ? v : LIB.reset;
  } catch {
    return LIB.reset;
  }
}

/** Title bar, rail, docked Library, work area and status bar (spec §4, brief §5). */
export function App() {
  const ready = useShell((st) => st.ready);
  const mounted = useShell((st) => st.mounted);
  const active = useShell((st) => st.active);
  const libraryOpen = useShell((st) => st.libraryOpen);
  const settingsOpen = useShell((st) => st.settingsOpen);
  const collapsed = useSyncExternalStore(onNarrow, () => narrow.matches);
  const [libWidth, setLibWidth] = useState(readWidth);
  // the panel stays mounted once opened, so search, scroll and folded collections survive a close
  const [libSeen, setLibSeen] = useState(libraryOpen);
  if (libraryOpen && !libSeen) setLibSeen(true);
  // closing the Library with focus inside it (its Close button, Ctrl+L) hands focus to the rail's
  // Library button, not to the page
  const lib = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!libraryOpen && lib.current?.contains(document.activeElement)) document.querySelector<HTMLElement>('[data-rail="library"]')?.focus();
  }, [libraryOpen]);

  const resize = (w: number) => {
    setLibWidth(w);
    try {
      localStorage.setItem(LIB.key, String(w));
    } catch {}
  };

  const vars = {
    '--rail': collapsed ? 'var(--rail-w-collapsed)' : 'var(--rail-w)',
    '--lib': libraryOpen ? `${libWidth}px` : '0px',
  } as CSSProperties;

  return (
    <div className={s.app} inert={!ready}>
      <TitleBar />
      <div className={libraryOpen ? s.cols : s.colsNoLib} style={vars}>
        <Rail collapsed={collapsed} />
        {libSeen && (
          <div ref={lib} className={s.lib} hidden={!libraryOpen}>
            <LibraryPanel narrow={libWidth < LIB.roomy} />
            <ResizeHandle value={libWidth} min={LIB.min} max={LIB.max} reset={LIB.reset} label="Library width" onChange={resize} />
          </div>
        )}
        <main className={s.work} data-region="work">
          {mounted.map((id) => (
            <ToolHost key={id} id={id} active={id === active && !settingsOpen} />
          ))}
          {settingsOpen && <SettingsScreen />}
          <ToastHost />
        </main>
      </div>
      <StatusBar />
      <MenuHost />
    </div>
  );
}
