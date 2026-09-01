import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { Editor } from '@tiptap/core'
import Code from '@tiptap/extension-code'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Details, { DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { createLowlight, common } from 'lowlight'
import {
  ChevronRight,
  Code2,
  Copy,
  Ellipsis,
  Eye,
  FileImage,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Image as ImageIcon,
  Link2,
  List,
  ListTodo,
  ListOrdered,
  Minus,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Pilcrow,
  Quote,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Share2,
  Sigma,
  Table2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { hiveoryClient, type CodeDocument } from '../../api/hiveory-client'

interface CodeMarkdownPaneProps {
  workspaceId: string
  relativePath: string
  paneId: string
  expectedRevision: number
}

type MarkdownViewMode = 'rich' | 'source' | 'preview'

interface SlashMenuState {
  query: string
  from: number
  to: number
  left: number
  top: number
}

interface MarkdownBlockCommand {
  id: string
  label: string
  description: string
  group: string
  icon: LucideIcon
  run: (editor: Editor) => void
}

interface ToolbarButtonProps {
  label: string
  icon?: LucideIcon
  text?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

const lowlight = createLowlight(common)

function resolveMarkdownImageSource(source: string): string {
  if (/^(https?:|data:|blob:|asset:|file:)/i.test(source)) return source
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return convertFileSrc(source)
  return source
}

const WorkspaceImage = Image.extend({
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const frame = document.createElement('figure')
      frame.className = 'hiveory-markdown-image'
      const image = document.createElement('img')
      image.draggable = false
      frame.append(image)

      const sync = (current: ProseMirrorNode) => {
        const source = typeof current.attrs.src === 'string' ? current.attrs.src : ''
        image.src = resolveMarkdownImageSource(source)
        image.alt = typeof current.attrs.alt === 'string' ? current.attrs.alt : ''
        if (typeof current.attrs.title === 'string' && current.attrs.title) image.title = current.attrs.title
        else image.removeAttribute('title')
        if (typeof current.attrs.width === 'number') image.width = current.attrs.width
        if (typeof current.attrs.height === 'number') image.height = current.attrs.height
      }

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (key !== 'src' && value != null) frame.setAttribute(key, String(value))
      })
      sync(node)

      return {
        dom: frame,
        update: (updatedNode: ProseMirrorNode) => {
          if (updatedNode.type !== node.type) return false
          sync(updatedNode)
          return true
        },
      }
    }
  },
})

const markdownExtensions = [
  StarterKit.configure({ link: false, code: false, codeBlock: false }),
  Code,
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  WorkspaceImage.configure({ allowBase64: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Details.configure({ persist: true }),
  DetailsSummary,
  DetailsContent,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  InlineMath.configure({ katexOptions: { throwOnError: false } }),
  BlockMath.configure({ katexOptions: { displayMode: true, throwOnError: false } }),
  Placeholder.configure({ includeChildren: true, placeholder: 'Write markdown… Type / for blocks.' }),
  Markdown.configure({ markedOptions: { gfm: true } }),
]

function MarkdownToolbarButton({ label, icon: Icon, text, active = false, disabled = false, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`hiveory-markdown-toolbar-button${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {Icon ? <Icon size={16} strokeWidth={1.8} aria-hidden="true" /> : <span className="hiveory-markdown-toolbar-text-glyph">{text}</span>}
    </button>
  )
}

function editorSlashState(editor: Editor, surface: HTMLElement | null): SlashMenuState | null {
  if (!surface || !editor.isEditable) return null
  const { selection } = editor.state
  if (!selection.empty || selection.$from.parent.type.name === 'codeBlock') return null
  const textBefore = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\n')
  const match = textBefore.match(/(?:^|\s)\/([a-z\d-]*)$/i)
  if (!match) return null
  const slashOffset = textBefore.lastIndexOf('/')
  const from = selection.$from.start() + slashOffset
  const rect = editor.view.coordsAtPos(from)
  const surfaceRect = surface.getBoundingClientRect()
  return {
    query: match[1].toLowerCase(),
    from,
    to: selection.to,
    left: Math.max(8, rect.left - surfaceRect.left),
    top: Math.max(8, rect.bottom - surfaceRect.top + 6),
  }
}

function fileNameFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'image'
}

function normalizeLink(value: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value
  return `https://${value}`
}

export const CodeMarkdownPane: React.FC<CodeMarkdownPaneProps> = ({ workspaceId, relativePath, paneId, expectedRevision }) => {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const linkPanelRef = useRef<HTMLFormElement>(null)
  const imagePanelRef = useRef<HTMLFormElement>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const documentRef = useRef<CodeDocument | null>(null)
  const sourceRef = useRef('')
  const baselineRef = useRef('')
  const viewModeRef = useRef<MarkdownViewMode>('rich')
  const editorRef = useRef<Editor | null>(null)
  const [markdownDocument, setMarkdownDocument] = useState<CodeDocument | null>(null)
  const [markdownSource, setMarkdownSource] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<MarkdownViewMode>('rich')
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [linkPanelOpen, setLinkPanelOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [imagePanelOpen, setImagePanelOpen] = useState(false)
  const [imageValue, setImageValue] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [selectionTick, setSelectionTick] = useState(0)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const updateSlashMenu = useCallback((instance: Editor) => {
    setSlashMenu(editorSlashState(instance, surfaceRef.current))
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: markdownExtensions,
    content: '',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'hiveory-markdown-content',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (syncingRef.current) return
      const next = instance.getMarkdown()
      sourceRef.current = next
      setMarkdownSource(next)
      setDirty(next !== baselineRef.current)
      setSelectionTick((value) => value + 1)
      updateSlashMenu(instance)
    },
    onSelectionUpdate: ({ editor: instance }) => {
      setSelectionTick((value) => value + 1)
      updateSlashMenu(instance)
    },
  })

  editorRef.current = editor

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    setMarkdownDocument(null)
    documentRef.current = null
    sourceRef.current = ''
    baselineRef.current = ''
    setMarkdownSource('')
    setDirty(false)

    void hiveoryClient.readCodeFile({ workspace_id: workspaceId, relative_path: relativePath })
      .then((next) => {
        if (disposed) return
        documentRef.current = next
        sourceRef.current = next.content
        baselineRef.current = next.content
        setMarkdownDocument(next)
        setMarkdownSource(next.content)
        setDirty(false)
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'The Markdown file could not be opened.')
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [relativePath, workspaceId])

  useEffect(() => {
    if (!editor || !markdownDocument) return
    syncingRef.current = true
    try {
      editor.commands.setContent(markdownDocument.content, { contentType: 'markdown', emitUpdate: false })
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown content could not be parsed.')
    } finally {
      syncingRef.current = false
    }
    setSlashMenu(null)
    setSelectionTick((value) => value + 1)
  }, [editor, markdownDocument])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(viewMode === 'rich')
    viewModeRef.current = viewMode
    if (viewMode !== 'rich') setSlashMenu(null)
  }, [editor, viewMode])

  useEffect(() => {
    const closeTransientMenus = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null
      if (linkPanelRef.current && !linkPanelRef.current.contains(target)) setLinkPanelOpen(false)
      if (imagePanelRef.current && !imagePanelRef.current.contains(target)) setImagePanelOpen(false)
      if (headerMenuRef.current && !headerMenuRef.current.contains(target)) setHeaderMenuOpen(false)
    }
    document.addEventListener('mousedown', closeTransientMenus)
    return () => document.removeEventListener('mousedown', closeTransientMenus)
  }, [])

  const syncSourceIntoEditor = useCallback((source: string) => {
    if (!editorRef.current) return
    syncingRef.current = true
    try {
      editorRef.current.commands.setContent(source, { contentType: 'markdown', emitUpdate: false })
      setError(null)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown content could not be parsed.')
    } finally {
      syncingRef.current = false
    }
    setSelectionTick((value) => value + 1)
  }, [])

  const changeViewMode = useCallback((next: MarkdownViewMode) => {
    if (next === viewModeRef.current) return
    if (next !== 'source') syncSourceIntoEditor(sourceRef.current)
    setViewMode(next)
  }, [syncSourceIntoEditor])

  const saveDocument = useCallback(async () => {
    const current = documentRef.current
    if (!current) return
    if (current.read_only || current.binary) {
      setError('This Markdown document is read-only.')
      return
    }
    const content = viewModeRef.current === 'rich' ? editorRef.current?.getMarkdown() ?? sourceRef.current : sourceRef.current
    setSaving(true)
    setError(null)
    try {
      const saved = await hiveoryClient.saveCodeFile({
        workspace_id: workspaceId,
        relative_path: relativePath,
        content,
        expected_fingerprint: current.fingerprint,
      })
      documentRef.current = saved
      sourceRef.current = saved.content
      baselineRef.current = saved.content
      setMarkdownDocument(saved)
      setMarkdownSource(saved.content)
      setDirty(false)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown document could not be saved.')
    } finally {
      setSaving(false)
    }
  }, [relativePath, workspaceId])

  const reloadDocument = useCallback(async () => {
    try {
      const next = await hiveoryClient.readCodeFile({ workspace_id: workspaceId, relative_path: relativePath })
      documentRef.current = next
      sourceRef.current = next.content
      baselineRef.current = next.content
      setMarkdownDocument(next)
      setMarkdownSource(next.content)
      setDirty(false)
      setError(null)
      if (viewModeRef.current !== 'source') syncSourceIntoEditor(next.content)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown document could not be reloaded.')
    }
  }, [relativePath, syncSourceIntoEditor, workspaceId])

  const renameDocument = useCallback(async () => {
    const current = documentRef.current
    if (!current) return
    const suggested = fileNameFromPath(relativePath)
    const name = window.prompt('Rename Markdown document', suggested)?.trim()
    if (!name || name === suggested) return
    if (name.includes('/') || name.includes('\\') || !name.endsWith('.md')) {
      setError('Use a Markdown filename ending in .md without folder separators.')
      return
    }
    try {
      const parent = relativePath.replaceAll('\\', '/').split('/').slice(0, -1).join('/')
      const result = await hiveoryClient.renameCodeFile({ workspace_id: workspaceId, pane_id: paneId, expected_revision: expectedRevision, relative_path: relativePath, new_relative_path: parent ? `${parent}/${name}` : name, expected_fingerprint: current.fingerprint })
      window.dispatchEvent(new CustomEvent('hiveory-code-layout-updated', { detail: result.layout }))
      setStatusMessage(`Renamed to ${name}`)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown document could not be renamed.')
    }
  }, [expectedRevision, paneId, relativePath, workspaceId])

  const copyMarkdown = useCallback(async () => {
    const content = viewModeRef.current === 'rich' ? editorRef.current?.getMarkdown() ?? sourceRef.current : sourceRef.current
    try {
      await navigator.clipboard.writeText(content)
      setStatusMessage('Markdown copied')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Markdown could not be copied.')
    }
  }, [])

  const shareMarkdown = useCallback(async () => {
    const content = viewModeRef.current === 'rich' ? editorRef.current?.getMarkdown() ?? sourceRef.current : sourceRef.current
    try {
      if (typeof navigator.share === 'function') await navigator.share({ title: fileNameFromPath(relativePath), text: content })
      else await navigator.clipboard.writeText(content)
      setStatusMessage(typeof navigator.share === 'function' ? 'Markdown shared' : 'Markdown copied')
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Markdown could not be shared.')
    }
  }, [relativePath])

  useEffect(() => {
    const handleSaveShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void saveDocument()
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [saveDocument])

  const setSourceValue = (value: string) => {
    sourceRef.current = value
    setMarkdownSource(value)
    setDirty(value !== baselineRef.current)
  }

  const insertImage = useCallback((source: string) => {
    const instance = editorRef.current
    const trimmed = source.trim()
    if (!instance || !trimmed) return
    instance.chain().focus().setImage({ src: trimmed, alt: fileNameFromPath(trimmed) }).run()
    setImageValue('')
    setImagePanelOpen(false)
  }, [])

  const chooseImage = useCallback(async () => {
    if (!hiveoryClient.isTauri) {
      setImagePanelOpen(true)
      return
    }
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      })
      if (typeof selected === 'string') insertImage(selected)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The image could not be selected.')
    }
  }, [insertImage])

  const openLinkPanel = () => {
    const activeLink = editor?.getAttributes('link').href
    setLinkValue(typeof activeLink === 'string' ? activeLink : '')
    setLinkPanelOpen(true)
    setImagePanelOpen(false)
  }

  const applyLink = (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    const value = linkValue.trim()
    if (!value) editor.chain().focus().unsetLink().run()
    else if (editor.state.selection.empty) {
      editor.chain().focus().insertContent({
        type: 'text',
        text: value,
        marks: [{ type: 'link', attrs: { href: normalizeLink(value) } }],
      }).run()
    } else editor.chain().focus().setLink({ href: normalizeLink(value) }).run()
    setLinkPanelOpen(false)
  }

  const applyImage = (event: FormEvent) => {
    event.preventDefault()
    insertImage(imageValue)
  }

  const blockCommands = useMemo<MarkdownBlockCommand[]>(() => {
    const command = (id: string, label: string, description: string, group: string, icon: LucideIcon, run: (instance: Editor) => void): MarkdownBlockCommand => ({ id, label, description, group, icon, run })
    return [
      command('paragraph', 'Text', 'Start with plain text', 'Basic blocks', Pilcrow, (instance) => { instance.chain().focus().setParagraph().run() }),
      command('heading-1', 'Heading 1', 'Large section heading', 'Basic blocks', Heading1, (instance) => { instance.chain().focus().toggleHeading({ level: 1 }).run() }),
      command('heading-2', 'Heading 2', 'Medium section heading', 'Basic blocks', Heading2, (instance) => { instance.chain().focus().toggleHeading({ level: 2 }).run() }),
      command('heading-3', 'Heading 3', 'Small section heading', 'Basic blocks', Heading3, (instance) => { instance.chain().focus().toggleHeading({ level: 3 }).run() }),
      command('heading-4', 'Heading 4', 'Compact section heading', 'Basic blocks', Heading4, (instance) => { instance.chain().focus().toggleHeading({ level: 4 }).run() }),
      command('heading-5', 'Heading 5', 'Smallest section heading', 'Basic blocks', Heading5, (instance) => { instance.chain().focus().toggleHeading({ level: 5 }).run() }),
      command('quote', 'Quote', 'Highlight a quotation', 'Lists and emphasis', Quote, (instance) => { instance.chain().focus().toggleBlockquote().run() }),
      command('bullet-list', 'Bulleted list', 'Create an unordered list', 'Lists and emphasis', List, (instance) => { instance.chain().focus().toggleBulletList().run() }),
      command('numbered-list', 'Numbered list', 'Create an ordered list', 'Lists and emphasis', ListOrdered, (instance) => { instance.chain().focus().toggleOrderedList().run() }),
      command('checklist', 'Checklist', 'Track tasks with checkboxes', 'Lists and emphasis', ListTodo, (instance) => { instance.chain().focus().toggleTaskList().run() }),
      command('code-block', 'Code block', 'Add syntax-highlighted code', 'Media and embeds', Code2, (instance) => { instance.chain().focus().toggleCodeBlock().run() }),
      command('divider', 'Divider', 'Separate sections with a rule', 'Media and embeds', Minus, (instance) => { instance.chain().focus().setHorizontalRule().run() }),
      command('table', 'Table', 'Insert a three by three table', 'Media and embeds', Table2, (instance) => { instance.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }),
      command('inline-math', 'Inline math', 'Insert an inline formula', 'Media and embeds', Sigma, (instance) => { instance.chain().focus().insertInlineMath({ latex: 'x^2' }).run() }),
      command('math-block', 'Math block', 'Insert a centered formula', 'Media and embeds', Sigma, (instance) => { instance.chain().focus().insertBlockMath({ latex: 'x^2 + y^2 = z^2' }).run() }),
      command('collapsible', 'Collapsible section', 'Hide details under a summary', 'Media and embeds', ChevronRight, (instance) => { instance.chain().focus().setDetails().run() }),
      command('image', 'Image', 'Add an image from a file or URL', 'Media and embeds', FileImage, () => { void chooseImage() }),
    ]
  }, [chooseImage])

  const filteredCommands = useMemo(() => {
    const query = slashMenu?.query.trim().toLowerCase() ?? ''
    if (!query) return blockCommands
    return blockCommands.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query))
  }, [blockCommands, slashMenu?.query])

  useEffect(() => {
    setSlashIndex(0)
  }, [slashMenu?.query])

  const executeSlashCommand = useCallback((item: MarkdownBlockCommand) => {
    const instance = editorRef.current
    const menu = slashMenu
    if (!instance || !menu) return
    instance.chain().focus().deleteRange({ from: menu.from, to: menu.to }).run()
    item.run(instance)
    setSlashMenu(null)
  }, [slashMenu])

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!slashMenu || !filteredCommands.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSlashIndex((value) => (value + 1) % filteredCommands.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSlashIndex((value) => (value - 1 + filteredCommands.length) % filteredCommands.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      executeSlashCommand(filteredCommands[slashIndex] ?? filteredCommands[0])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setSlashMenu(null)
    }
  }

  const outlineItems = useMemo(() => {
    void markdownSource
    void selectionTick
    if (!editor) return []
    const items: Array<{ position: number; level: number; text: string }> = []
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'heading') items.push({ position, level: Number(node.attrs.level) || 1, text: node.textContent || 'Untitled heading' })
    })
    return items
  }, [editor, markdownSource, selectionTick])

  const toggleMark = (mark: 'bold' | 'italic' | 'strike' | 'code') => {
    if (!editor) return
    if (mark === 'bold') editor.chain().focus().toggleBold().run()
    else if (mark === 'italic') editor.chain().focus().toggleItalic().run()
    else if (mark === 'strike') editor.chain().focus().toggleStrike().run()
    else editor.chain().focus().toggleCode().run()
  }

  const insertTable = () => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    setMoreOpen(false)
  }

  const runMoreCommand = (run: () => void) => {
    run()
    setMoreOpen(false)
  }

  const documentName = relativePath.replaceAll('\\', '/').split('/').pop() || 'untitled.md'

  return (
    <div className="hiveory-markdown-pane">
      <div className="hiveory-markdown-document-header">
        <div className="hiveory-markdown-document-path" title={relativePath}>
          <span>{relativePath}</span>
          {dirty && <span className="hiveory-markdown-dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />}
          {statusMessage && <span className="hiveory-markdown-status-message" role="status">{statusMessage}</span>}
        </div>
        <div className="hiveory-markdown-header-actions" ref={headerMenuRef}>
          <div className="hiveory-markdown-view-toggle" role="group" aria-label="Markdown editing mode">
            <button type="button" className={`hiveory-markdown-header-button${viewMode === 'source' ? ' is-active' : ''}`} onClick={() => changeViewMode('source')} title="Edit Markdown source" aria-label="Edit Markdown source"><Code2 size={15} /></button>
            <button type="button" className={`hiveory-markdown-header-button${viewMode === 'rich' ? ' is-active' : ''}`} onClick={() => changeViewMode('rich')} title="Edit formatted Markdown" aria-label="Edit formatted Markdown"><PenLine size={15} /></button>
          </div>
          <button type="button" className="hiveory-markdown-header-button" onClick={() => setOutlineOpen((value) => !value)} title="Document outline" aria-label="Document outline" aria-expanded={outlineOpen}><PanelRight size={15} /></button>
          <button type="button" className="hiveory-markdown-header-button" onClick={() => void shareMarkdown()} title="Share Markdown" aria-label="Share Markdown"><Share2 size={15} /></button>
          <button type="button" className={`hiveory-markdown-header-button${headerMenuOpen ? ' is-active' : ''}`} onClick={() => setHeaderMenuOpen((value) => !value)} title="Document options" aria-label="Document options" aria-haspopup="menu" aria-expanded={headerMenuOpen}><MoreHorizontal size={16} /></button>
          {headerMenuOpen && (
            <div className="hiveory-markdown-header-menu" role="menu">
              <div className="hiveory-markdown-header-menu-title">{documentName}</div>
              <button type="button" role="menuitem" disabled={saving} onClick={() => { setHeaderMenuOpen(false); void saveDocument() }}><Save size={14} />{saving ? 'Saving…' : 'Save document'}</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); void renameDocument() }}><PenLine size={14} />Rename document…</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); void reloadDocument() }}><RotateCcw size={14} />Reload from disk</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); changeViewMode('preview') }}><Eye size={14} />Preview</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); void shareMarkdown() }}><Share2 size={14} />Share Markdown</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); void copyMarkdown() }}><Copy size={14} />Copy Markdown</button>
              <button type="button" role="menuitem" onClick={() => runMoreCommand(() => editor?.chain().focus().undo().run())}><Undo2 size={14} />Undo</button>
              <button type="button" role="menuitem" onClick={() => runMoreCommand(() => editor?.chain().focus().redo().run())}><Redo2 size={14} />Redo</button>
            </div>
          )}
        </div>
      </div>

      <div className="hiveory-markdown-formatting-toolbar" role="toolbar" aria-label="Markdown formatting">
        <MarkdownToolbarButton label="Paragraph" icon={Pilcrow} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().setParagraph().run()} active={editor?.isActive('paragraph')} />
        <MarkdownToolbarButton label="Heading 1" icon={Heading1} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive('heading', { level: 1 })} />
        <MarkdownToolbarButton label="Heading 2" icon={Heading2} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive('heading', { level: 2 })} />
        <MarkdownToolbarButton label="Heading 3" icon={Heading3} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={editor?.isActive('heading', { level: 3 })} />
        <span className="hiveory-markdown-toolbar-separator" aria-hidden="true" />
        <MarkdownToolbarButton label="Bold" text="B" disabled={!editor || viewMode !== 'rich'} onClick={() => toggleMark('bold')} active={editor?.isActive('bold')} />
        <MarkdownToolbarButton label="Italic" text="I" disabled={!editor || viewMode !== 'rich'} onClick={() => toggleMark('italic')} active={editor?.isActive('italic')} />
        <MarkdownToolbarButton label="Strikethrough" text="S" disabled={!editor || viewMode !== 'rich'} onClick={() => toggleMark('strike')} active={editor?.isActive('strike')} />
        <span className="hiveory-markdown-toolbar-separator" aria-hidden="true" />
        <MarkdownToolbarButton label="Bulleted list" icon={List} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} />
        <MarkdownToolbarButton label="Numbered list" icon={ListOrdered} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} />
        <MarkdownToolbarButton label="Checklist" icon={ListTodo} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().toggleTaskList().run()} active={editor?.isActive('taskList')} />
        <span className="hiveory-markdown-toolbar-separator" aria-hidden="true" />
        <MarkdownToolbarButton label="Quote" icon={Quote} disabled={!editor || viewMode !== 'rich'} onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive('blockquote')} />
        <MarkdownToolbarButton label="Link" icon={Link2} disabled={!editor || viewMode !== 'rich'} onClick={openLinkPanel} active={editor?.isActive('link')} />
        <MarkdownToolbarButton label="Image" icon={ImageIcon} disabled={!editor || viewMode !== 'rich'} onClick={() => void chooseImage()} />
        <div className="hiveory-markdown-more-wrap">
          <MarkdownToolbarButton label="More blocks" icon={Ellipsis} disabled={!editor || viewMode !== 'rich'} onClick={() => setMoreOpen((value) => !value)} active={moreOpen} />
          {moreOpen && (
            <div className="hiveory-markdown-more-menu" role="menu">
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().toggleHeading({ level: 4 }).run())}><Heading4 size={15} />Heading 4</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().toggleHeading({ level: 5 }).run())}><Heading5 size={15} />Heading 5</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().toggleCodeBlock().run())}><Code2 size={15} />Code block</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => toggleMark('code'))}><Code2 size={15} />Inline code</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().setHorizontalRule().run())}><Minus size={15} />Divider</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={insertTable}><Table2 size={15} />Table</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().insertInlineMath({ latex: 'x^2' }).run())}><Sigma size={15} />Inline math</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().insertBlockMath({ latex: 'x^2 + y^2 = z^2' }).run())}><Sigma size={15} />Math block</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().setDetails().run())}><ChevronRight size={15} />Collapsible section</button>
            </div>
          )}
        </div>
      </div>

      <div className="hiveory-markdown-surface" ref={surfaceRef} onKeyDown={handleEditorKeyDown}>
        {loading && <div className="hiveory-markdown-state">Loading Markdown…</div>}
        {!loading && error && <div className="hiveory-markdown-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={14} /></button></div>}
        {!loading && !markdownDocument && !error && <div className="hiveory-markdown-state">This Markdown document is not available.</div>}
        {!loading && markdownDocument && viewMode === 'source' && (
          <textarea className="hiveory-markdown-source" value={markdownSource} onChange={(event) => setSourceValue(event.target.value)} aria-label="Markdown source" spellCheck={false} />
        )}
        {!loading && markdownDocument && viewMode !== 'source' && (
          <div className={`hiveory-markdown-editor${viewMode === 'preview' ? ' is-preview' : ''}`}>
            <EditorContent editor={editor} />
          </div>
        )}

        {linkPanelOpen && (
          <form className="hiveory-markdown-popover hiveory-markdown-link-popover" ref={linkPanelRef} onSubmit={applyLink} onMouseDown={(event) => event.stopPropagation()}>
            <label><Link2 size={14} />Link address<input autoFocus value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="https://example.com" /></label>
            <div className="hiveory-markdown-popover-actions"><button type="button" onClick={() => { editor?.chain().focus().unsetLink().run(); setLinkPanelOpen(false) }}>Remove</button><button type="submit" className="is-primary">Apply</button></div>
          </form>
        )}
        {imagePanelOpen && (
          <form className="hiveory-markdown-popover hiveory-markdown-image-popover" ref={imagePanelRef} onSubmit={applyImage} onMouseDown={(event) => event.stopPropagation()}>
            <label><ImageIcon size={14} />Image address<input autoFocus value={imageValue} onChange={(event) => setImageValue(event.target.value)} placeholder="https://example.com/image.png" /></label>
            <div className="hiveory-markdown-popover-actions"><button type="button" onClick={() => setImagePanelOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={!imageValue.trim()}>Insert</button></div>
          </form>
        )}
        {slashMenu && viewMode === 'rich' && (
          <div className="hiveory-markdown-slash-menu" role="listbox" aria-label="Markdown blocks" style={{ left: slashMenu.left, top: slashMenu.top }} onMouseDown={(event) => event.preventDefault()}>
            <div className="hiveory-markdown-slash-search"><Search size={14} /><span>{slashMenu.query ? `/${slashMenu.query}` : 'Search blocks'}</span></div>
            {filteredCommands.length ? filteredCommands.map((item, index) => {
              const Icon = item.icon
              const showGroup = index === 0 || filteredCommands[index - 1].group !== item.group
              return <React.Fragment key={item.id}>{showGroup && <div className="hiveory-markdown-slash-group">{item.group}</div>}<button type="button" role="option" aria-selected={index === slashIndex} className={index === slashIndex ? 'is-selected' : ''} onClick={() => executeSlashCommand(item)}><Icon size={16} /><span><strong>{item.label}</strong><small>{item.description}</small></span></button></React.Fragment>
            }) : <div className="hiveory-markdown-slash-empty">No matching blocks</div>}
          </div>
        )}
        {outlineOpen && (
          <div className="hiveory-markdown-outline" role="dialog" aria-label="Document outline">
            <div className="hiveory-markdown-outline-header"><strong>Document outline</strong><button type="button" onClick={() => setOutlineOpen(false)} aria-label="Close outline"><X size={14} /></button></div>
            {outlineItems.length ? outlineItems.map((item) => <button type="button" key={`${item.position}-${item.text}`} style={{ paddingLeft: `${10 + item.level * 10}px` }} onClick={() => { editor?.chain().focus().setTextSelection(item.position + 1).scrollIntoView().run(); setOutlineOpen(false) }}>{item.text}</button>) : <span className="hiveory-markdown-outline-empty">Add a heading to see it here.</span>}
          </div>
        )}
        <button type="button" className={`hiveory-markdown-outline-trigger${outlineOpen ? ' is-active' : ''}`} onClick={() => setOutlineOpen((value) => !value)} title="Document outline" aria-label="Document outline" aria-expanded={outlineOpen}><PanelRight size={17} /></button>
      </div>
    </div>
  )
}
