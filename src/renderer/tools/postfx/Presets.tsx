// Presets (spec §3, §5 q4): a few built-in starting stacks, your own (save, rename, delete with the
// confirm and an Undo toast), and share codes to copy and paste. A preset replaces the stack in one
// step, which Undo brings back; the presets themselves never enter the document's history.
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Button, ConfirmInline, IconButton, menu, Module, TextInput, toast, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { createStore } from '../common/store.ts';
import { applyPreset, importCode, type Doc } from './actions.ts';
import { BUILT_INS } from './builtins.ts';
import type { Layer, PostFxDoc } from './doc.ts';
import { deletePreset, freeName, loadSaved, renamePreset, saved, savePreset, type Preset } from './presets.ts';
import { decodeStack, encodeStack } from './share.ts';
import s from './Presets.module.css';
import i from './Layer.module.css';

/** the preset the stack last came from (this session), so the readout can say it was changed */
const from = createStore<string | null>(null);

const same = (a: Layer[], b: Layer[]) =>
  a.length === b.length && a.every((l, n) => l.effect === b[n].effect && l.on === b[n].on && l.opacity === b[n].opacity && l.blend === b[n].blend && JSON.stringify(l.params) === JSON.stringify(b[n].params));

function pick(doc: Doc, p: Preset) {
  const d = doc.get();
  const here = [...BUILT_INS, ...saved.get().list].some((x) => same(d.stack, x.layers));
  applyPreset(doc, p, !here);
  from.set(p.id);
}

function Yours({ doc, d, p }: { doc: Doc; d: PostFxDoc; p: Preset }) {
  const [mode, setMode] = useState<'rest' | 'rename' | 'armed'>('rest');
  const on = same(d.stack, p.layers);
  if (mode === 'armed')
    return (
      <div className={s.confirm}>
        <ConfirmInline icon="delete" title={`Delete the ${p.name} preset?`} detail={`${plural(p.layers.length, 'layer')}. The stack stays as it is. Undo brings the preset back.`} confirmLabel="Delete" danger onConfirm={() => void deletePreset(p.id)} onKeep={() => setMode('rest')} />
      </div>
    );
  if (mode === 'rename')
    return (
      <div className={s.mine}>
        <TextInput
          value={p.name}
          autoFocus
          selectOnFocus
          className={i.grow}
          validate={(v) => (v.trim() ? null : 'A preset needs a name.')}
          onCommit={(v) => {
            setMode('rest');
            void renamePreset(p.id, v);
          }}
          onCancel={() => setMode('rest')}
        />
      </div>
    );
  return (
    <div className={cx(s.mine, on && s.on)}>
      <button type="button" className={s.mineName} aria-pressed={on} onClick={() => !on && pick(doc, p)}>
        <Tooltip content={p.name} overflowOnly>
          <span className={s.text}>{p.name}</span>
        </Tooltip>
        <span className={s.count}>{p.layers.length}</span>
      </button>
      <IconButton
        icon="more_horiz"
        label={`More for ${p.name}`}
        size="sm"
        onClick={(e) =>
          menu.open(
            e.currentTarget.getBoundingClientRect(),
            [
              { label: 'Rename', icon: 'edit', onSelect: () => setMode('rename') },
              { label: 'Copy its code', icon: 'content_copy', onSelect: () => void copy(encodeStack(p.layers), p.name) },
              'separator',
              { label: 'Delete', icon: 'delete', danger: true, onSelect: () => setMode('armed') },
            ],
            { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined },
          )
        }
      />
    </div>
  );
}

async function copy(code: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    toast.show({ icon: 'content_copy', message: `Copied the code for ${what}. Paste it into Post FX anywhere to get the same stack.` });
  } catch {
    toast.show({ kind: 'error', message: "Couldn't copy to the clipboard." });
  }
}

export function PresetsModule({ doc, d }: { doc: Doc; d: PostFxDoc }) {
  const mine = saved.use();
  const last = from.use();
  const [naming, setNaming] = useState(false);
  const [focus, setFocus] = useState(0);
  useEffect(() => void loadSaved(), []);
  const save = (name: string) => {
    setNaming(false);
    void savePreset(name, d.stack).then((p) => p && from.set(p.id));
  };

  const all = [...BUILT_INS, ...mine.list];
  const match = all.find((p) => same(d.stack, p.layers));
  const was = all.find((p) => p.id === last);
  const readout = match ? match.name : was && d.stack.length ? `${was.name}, changed` : undefined;

  // one Tab stop; arrows move, Enter or a click uses the preset (it replaces the stack, so never on a move)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -2, ArrowRight: 1, ArrowDown: 2 }[e.key] ?? 0;
    if (!step) return;
    e.preventDefault();
    const to = Math.min(BUILT_INS.length - 1, Math.max(0, focus + step));
    setFocus(to);
    (e.currentTarget.children[to]?.querySelector('button') ?? (e.currentTarget.children[to] as HTMLElement | undefined))?.focus();
  };

  return (
    <Module title="Presets" readout={readout}>
      <div className={i.stack}>
        <div className={s.grid} role="group" aria-label="Built-in presets" onKeyDown={onKey}>
          {BUILT_INS.map((p, n) => (
            <Tooltip key={p.id} content={p.about}>
              <button type="button" aria-pressed={match?.id === p.id} tabIndex={n === focus ? 0 : -1} className={cx(s.key, match?.id === p.id && s.on)} onFocus={() => setFocus(n)} onClick={() => match?.id !== p.id && pick(doc, p)}>
                <span className={s.text}>{p.name}</span>
                <span className={s.count}>{p.layers.length}</span>
              </button>
            </Tooltip>
          ))}
        </div>

        <div className={cx(i.group, i.rule)}>
          <div className={s.head}>
            <span className="lbl">Yours</span>
            <span className={i.grow} />
            {!naming && (
              <Button size="xs" icon="bookmark_add" disabled={!d.stack.length || !!mine.error} tooltip={mine.error ?? (d.stack.length ? 'Keep this stack as a preset of your own' : 'Add an effect first')} onClick={() => setNaming(true)}>
                Save the stack
              </Button>
            )}
          </div>
          {naming && (
            // Enter on the empty field takes the name it suggests (TextInput treats an unchanged field as Esc)
            <div
              onKeyDownCapture={(e) => {
                if (e.key !== 'Enter' || (e.target as HTMLInputElement).value !== '') return;
                e.preventDefault();
                e.stopPropagation();
                save('');
              }}
            >
              <TextInput value="" label="Name" autoFocus placeholder={freeName('My preset')} onCommit={save} onCancel={() => setNaming(false)} />
            </div>
          )}
          {mine.error ? (
            <p className={i.warn} role="status">
              {mine.error} Saving is off, so nothing is written over them.
            </p>
          ) : mine.list.length ? (
            <div className={s.list}>
              {mine.list.map((p) => (
                <Yours key={p.id} doc={doc} d={d} p={p} />
              ))}
            </div>
          ) : (
            !naming && <p className={i.note}>Stacks you save show here, and stay between sessions.</p>
          )}
        </div>

        <div className={cx(i.group, i.rule)}>
          <div className={s.head}>
            <span className="lbl">Share code</span>
            <span className={i.grow} />
            <Button size="xs" icon="content_copy" disabled={!d.stack.length} tooltip={d.stack.length ? 'A PFX2 code for this stack, to paste into Post FX anywhere' : 'Add an effect first'} onClick={() => void copy(encodeStack(d.stack), 'this stack')}>
              Copy code
            </Button>
          </div>
          <TextInput
            value=""
            mono
            icon="content_paste"
            placeholder="Paste a PFX2 code, then Enter"
            validate={(v) => {
              try {
                decodeStack(v);
                return null;
              } catch (e) {
                return e instanceof Error ? e.message : String(e);
              }
            }}
            onCommit={(v) => {
              importCode(doc, v);
              from.set(null);
            }}
          />
        </div>
      </div>
    </Module>
  );
}
