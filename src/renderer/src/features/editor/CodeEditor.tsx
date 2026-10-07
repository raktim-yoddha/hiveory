import { useEffect, useLayoutEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import styles from './Editor.module.css'

/** Colors come from the `--syntax-*` tokens: the terminal palette, or a VS Code theme's own token colors. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syntax-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syntax-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syntax-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syntax-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syntax-property)' },
  { tag: [t.tagName, t.heading], color: 'var(--syntax-tag)', fontWeight: '600' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--syntax-link)', textDecoration: 'underline' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--color-danger)' }
])

/** The editor's chrome, all from design tokens: flat, no gutter border, transparent over the pane. */
const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--color-text)', fontSize: 'var(--text-md)' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--color-accent)', padding: 'var(--space-4) 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--term-selection)' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--color-text-faint)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-text-secondary)' },
    '.cm-activeLine': { backgroundColor: 'var(--color-surface-hover)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--color-surface-active)', border: 'none', color: 'var(--color-text-muted)' },
    '.cm-matchingBracket': { backgroundColor: 'var(--color-surface-active)', outline: 'none' },
    '.cm-selectionMatch': { backgroundColor: 'var(--color-bronze-soft)' },
    '.cm-searchMatch': { backgroundColor: 'var(--color-waiting-soft)', outline: '1px solid var(--color-waiting-edge)' },
    '.cm-panels': { backgroundColor: 'var(--color-surface-raised-solid)', color: 'var(--color-text)', borderTop: 'none' },
    '.cm-panels input, .cm-panels button': { fontFamily: 'var(--font-ui)' },
    '.cm-tooltip': { backgroundColor: 'var(--color-surface-raised-solid)', border: 'none', borderRadius: 'var(--radius-sm)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--color-surface-active)', color: 'var(--color-text)' }
  },
  { dark: true }
)

interface CodeEditorProps {
  /** Shown when the editor mounts (and whenever `revision` changes, e.g. the file changed on disk). */
  value: string
  revision: number
  /** Picks syntax highlighting (languages load on demand). */
  filename: string
  onChange: (value: string) => void
  onSave: () => void
}

/**
 * CodeMirror 6: a few hundred KB, fast on large files, languages loaded only
 * when a file needs them. Presentational: loading and saving belong to the caller.
 */
export function CodeEditor({ value, revision, filename, onChange, onSave }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave })
  useLayoutEffect(() => {
    callbacks.current = { onChange, onSave }
  })

  useEffect(() => {
    const language = new Compartment()
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (callbacks.current.onSave(), true) }])),
          syntaxHighlighting(highlight),
          theme,
          language.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
          })
        ]
      })
    })
    viewRef.current = view
    const description = LanguageDescription.matchFilename(languages, filename)
    let disposed = false
    void description?.load().then((support) => {
      if (!disposed) view.dispatch({ effects: language.reconfigure(support) })
    })
    return () => {
      disposed = true
      view.destroy()
      viewRef.current = null
    }
    // The document is replaced below on `revision`; the view itself lives as long as the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  return <div ref={hostRef} className={styles.editor} />
}
