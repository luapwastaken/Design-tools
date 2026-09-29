import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Theme } from '../../shared/types.ts';
import { Button, FieldError, IconButton, Module, PICKER_STYLE_OPTIONS, Segmented, Tooltip, usePickerStyle } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import { ipc } from './core/ipc.ts';
import s from './SettingsScreen.module.css';

const THEMES: { value: Theme; label: string; icon: 'dark_mode' | 'light_mode' }[] = [
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
];

/** Theme, colour picker, Library folder and version (spec §4). Shown in the work area in place of the tools. */
export function SettingsScreen() {
  const settings = useShell((st) => st.settings);
  const pickerStyle = usePickerStyle();
  const library = useShell((st) => st.library);
  const [version, setVersion] = useState<string | null>(null);
  const page = useRef<HTMLDivElement>(null);
  // focus moves in with the screen (the theme first), and back out to whatever opened it when the
  // screen goes with focus inside it; a click on the rail keeps its own focus
  const [back] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    page.current?.querySelector<HTMLElement>('button:not([disabled]):not([tabindex="-1"])')?.focus();
    return () => {
      if (document.activeElement === document.body && back?.isConnected) back.focus();
    };
  }, [back]);
  useEffect(() => {
    ipc.invoke('app.info').then(
      (i) => setVersion(`${i.version}${i.isPackaged ? '' : ' · development build'}`),
      () => setVersion('unknown'),
    );
  }, []);
  const root = settings?.libraryRoot ?? '';

  return (
    <div className={s.screen}>
      <Module
        title="Settings"
        scroll
        className={s.mod}
        actions={<IconButton icon="close" label="Close settings" size="sm" shortcut="Ctrl+," onClick={() => shell.openSettings(false)} />}
      >
        <div ref={page} className={s.page}>
          <Section title="Appearance">
            <Row label="Theme">
              <Segmented options={THEMES} value={settings?.theme ?? 'dark'} fit onChange={(t) => void shell.setTheme(t)} />
            </Row>
            <Row label="Colour picker">
              <Segmented options={PICKER_STYLE_OPTIONS} value={pickerStyle} fit onChange={(style) => void shell.setPicker({ pickerStyle: style })} />
            </Row>
            <p className={s.hint}>Every colour picker in the app uses this style. The switch at the top of any picker changes it too.</p>
          </Section>

          <Section title="Library">
            <Row label="Folder">
              <div className={s.folder}>
                <Tooltip overflowOnly>
                  <span className={s.path}>
                    <bdi>{root}</bdi>
                  </span>
                </Tooltip>
                <Button icon="folder_open" onClick={() => void shell.chooseLibraryRoot()}>
                  Change
                </Button>
                <Button variant="ghost" onClick={() => void ipc.invoke('shell.reveal', root)} disabled={!root || library?.ok === false}>
                  Reveal in Explorer
                </Button>
              </div>
            </Row>
            {library?.ok === false && (
              <div className={s.indent}>
                <FieldError>{library.error ?? 'The Library folder is missing.'}</FieldError>
              </div>
            )}
            <p className={s.hint}>
              Change points the app at another folder and moves nothing. Documents open from the old folder stay open, detached from their files.
            </p>
          </Section>

          <Section title="About">
            <Row label="Version">
              <span className={s.value}>{version ?? ''}</span>
            </Row>
          </Section>
        </div>
      </Module>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.section}>
      <h3 className={s.title}>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}
