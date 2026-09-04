import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Ellipsis,
  Eye,
  ExternalLink,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
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
  LoaderCircle,
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
import { hiveoryClient, type CodeDocument } from '../../../../shared/api/hiveory-client'

interface CodeMarkdownPaneProps {
  workspaceId: string
  relativePath: string
  onOpenMarkdown?: (relativePath: string) => void
  onCreateMarkdown?: () => void
  onRenameMarkdown?: (newRelativePath: string, expectedFingerprint: string | null) => Promise<CodeDocument | null>
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

function workspaceImageExtension(workspaceId: string, documentPath: string) {
  return Image.extend({
    addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const frame = document.createElement('figure')
      frame.className = 'hiveory-markdown-image'
      const image = document.createElement('img')
      image.draggable = false
      frame.append(image)

      let loadVersion = 0
      const sync = (current: ProseMirrorNode) => {
        const version = ++loadVersion
        const source = typeof current.attrs.src === 'string' ? current.attrs.src : ''
        if (/^(https?:|data:|blob:|asset:|file:)/i.test(source)) image.src = source
        else if (/^(?:[a-z]:[\\/]|\\\\)/i.test(source)) image.src = convertFileSrc(source)
        else if (source) {
          image.removeAttribute('src')
          void hiveoryClient.readCodeAsset({ workspace_id: workspaceId, document_path: documentPath, source })
            .then((asset) => {
              if (version === loadVersion) image.src = `data:${asset.mime_type};base64,${asset.data_base64}`
            })
            .catch(() => {
              if (version === loadVersion) image.removeAttribute('src')
            })
        } else image.removeAttribute('src')
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
}

const baseMarkdownExtensions = [
  StarterKit.configure({ link: false, code: false, codeBlock: false }),
  Code,
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
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

function FloatingMarkdownMenu({
  anchor,
  className,
  align = 'end',
  children,
}: {
  anchor: React.RefObject<HTMLElement>
  className: string
  align?: 'start' | 'end'
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, visible: false })

  useLayoutEffect(() => {
    const update = () => {
      const anchorElement = anchor.current
      const menu = menuRef.current
      if (!anchorElement || !menu) return
      const anchorRect = anchorElement.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const margin = 8
      const left = align === 'start'
        ? Math.min(window.innerWidth - menuRect.width - margin, Math.max(margin, anchorRect.left))
        : Math.min(window.innerWidth - menuRect.width - margin, Math.max(margin, anchorRect.right - menuRect.width))
      const roomBelow = window.innerHeight - anchorRect.bottom - margin
      const top = roomBelow >= menuRect.height
        ? anchorRect.bottom + 6
        : Math.max(margin, anchorRect.top - menuRect.height - 6)
      setPosition({ top, left, visible: true })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (anchor.current) observer?.observe(anchor.current)
    if (menuRef.current) observer?.observe(menuRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [align, anchor])

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      role="menu"
      style={{ position: 'fixed', top: position.top, left: position.left, visibility: position.visible ? 'visible' : 'hidden' }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}

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

export const CodeMarkdownPane: React.FC<CodeMarkdownPaneProps> = ({ workspaceId, relativePath, onOpenMarkdown, onRenameMarkdown }) => {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const linkPanelRef = useRef<HTMLFormElement>(null)
  const imagePanelRef = useRef<HTMLFormElement>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)
  const markdownFileMenuRef = useRef<HTMLDivElement>(null)
  const moreMenuAnchorRef = useRef<HTMLDivElement>(null)
  const markdownNameInputRef = useRef<HTMLInputElement>(null)
  const nameCommitInProgressRef = useRef(false)
  const skipNameCommitRef = useRef(false)
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
  const [markdownFileMenuOpen, setMarkdownFileMenuOpen] = useState(false)
  const [markdownFiles, setMarkdownFiles] = useState<string[]>([])
  const [markdownFilesLoading, setMarkdownFilesLoading] = useState(false)
  const [markdownFilesError, setMarkdownFilesError] = useState<string | null>(null)
  const [markdownFileQuery, setMarkdownFileQuery] = useState('')
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [draftMode, setDraftMode] = useState(false)

  const persistedDocumentName = fileNameFromPath(relativePath)
  const documentName = draftMode ? (nameDraft || 'Untitled.md') : persistedDocumentName
  const documentDirectory = relativePath.replaceAll('\\', '/').split('/').slice(0, -1).join('/')

  useEffect(() => {
    if (!draftMode) setNameDraft(persistedDocumentName)
    setNameEditing(false)
  }, [draftMode, persistedDocumentName])

  useEffect(() => {
    if (nameEditing) {
      markdownNameInputRef.current?.focus()
      markdownNameInputRef.current?.select()
    }
  }, [nameEditing])

  const updateSlashMenu = useCallback((instance: Editor) => {
    setSlashMenu(editorSlashState(instance, surfaceRef.current))
  }, [])

  const markdownExtensions = useMemo(() => [
    ...baseMarkdownExtensions,
    workspaceImageExtension(workspaceId, relativePath).configure({ allowBase64: true }),
  ], [relativePath, workspaceId])

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
      handleClick: (_view, _position, event) => {
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null
        if (!(target instanceof HTMLAnchorElement)) return false
        const href = target.getAttribute('href') ?? ''
        if (!href) return false
        event.preventDefault()
        setLinkValue(href)
        setLinkPanelOpen(true)
        setImagePanelOpen(false)
        if ((event.ctrlKey || event.metaKey) && /^https?:\/\//i.test(href)) {
          void hiveoryClient.openExternalUrl({ url: href }).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : 'The link could not be opened.')
          })
        }
        return true
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
    setDraftMode(false)
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
      if (markdownFileMenuRef.current && !markdownFileMenuRef.current.contains(target)) setMarkdownFileMenuOpen(false)
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

  const saveDocument = useCallback(async (): Promise<boolean> => {
    const current = documentRef.current
    if (!current) return false
    if (current.read_only || current.binary) {
      setError('This Markdown document is read-only.')
      return false
    }
    const content = viewModeRef.current === 'rich' ? editorRef.current?.getMarkdown() ?? sourceRef.current : sourceRef.current
    if (draftMode) {
      setStatusMessage('Name this document to save it')
      setNameEditing(true)
      return false
    }
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
      return true
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown document could not be saved.')
      return false
    } finally {
      setSaving(false)
    }
  }, [draftMode, relativePath, workspaceId])

  const saveDraft = useCallback(async (requestedName: string): Promise<boolean> => {
    const name = requestedName.trim()
    if (!name || name.includes('/') || name.includes('\\') || !/\.(md|markdown)$/i.test(name)) {
      setError('Use a Markdown filename ending in .md or .markdown without folder separators.')
      setNameEditing(true)
      return false
    }
    const relativeDraftPath = documentDirectory ? `${documentDirectory}/${name}` : name
    const content = viewModeRef.current === 'rich' ? editorRef.current?.getMarkdown() ?? sourceRef.current : sourceRef.current
    setSaving(true)
    setError(null)
    try {
      const created = await hiveoryClient.createCodeFile({
        workspace_id: workspaceId,
        relative_path: relativeDraftPath,
        content,
      })
      documentRef.current = created
      sourceRef.current = created.content
      baselineRef.current = created.content
      setMarkdownDocument(created)
      setMarkdownSource(created.content)
      setDirty(false)
      setDraftMode(false)
      setNameEditing(false)
      setStatusMessage(`Saved ${fileNameFromPath(created.relative_path)}`)
      onOpenMarkdown?.(created.relative_path)
      return true
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown document could not be created.')
      setNameEditing(true)
      return false
    } finally {
      setSaving(false)
    }
  }, [documentDirectory, onOpenMarkdown, workspaceId])

  const createNewDraft = useCallback(() => {
    if (dirty && !window.confirm('Discard the unsaved changes and create a new Markdown document?')) return
    const draft: CodeDocument = {
      workspace_id: workspaceId,
      relative_path: 'Untitled.md',
      content: '',
      language: 'markdown',
      fingerprint: '',
      bytes: 0,
      read_only: false,
      binary: false,
    }
    documentRef.current = draft
    sourceRef.current = ''
    baselineRef.current = ''
    setMarkdownDocument(draft)
    setMarkdownSource('')
    setDirty(false)
    setDraftMode(true)
    setNameDraft('Untitled.md')
    setNameEditing(false)
    setError(null)
    setStatusMessage('New unsaved document')
    syncSourceIntoEditor('')
  }, [dirty, syncSourceIntoEditor, workspaceId])

  const openMarkdownDocument = useCallback((path: string) => {
    if (path === relativePath && !draftMode) return
    if (dirty && !window.confirm('Discard the unsaved changes and open another Markdown document?')) return
    setMarkdownFileMenuOpen(false)
    setMarkdownFileQuery('')
    onOpenMarkdown?.(path)
  }, [dirty, draftMode, onOpenMarkdown, relativePath])

  const reloadDocument = useCallback(async () => {
    if (draftMode) {
      createNewDraft()
      return
    }
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
  }, [createNewDraft, draftMode, relativePath, syncSourceIntoEditor, workspaceId])

  const renameDocument = useCallback(async (requestedName = nameDraft) => {
    if (draftMode) {
      await saveDraft(requestedName)
      return
    }
    if (!onRenameMarkdown) {
      setError('Markdown rename is unavailable in this workspace.')
      return
    }

    let current = documentRef.current
    if (!current) return
    if (dirty && !(await saveDocument())) return
    current = documentRef.current
    if (!current) return

    const name = requestedName.trim()
    if (!name || name === documentName) {
      setNameDraft(documentName)
      setNameEditing(false)
      return
    }
    if (name.includes('/') || name.includes('\\') || !/\.(md|markdown)$/i.test(name)) {
      setError('Use a Markdown filename ending in .md or .markdown without folder separators.')
      return
    }

    try {
      const newRelativePath = documentDirectory ? `${documentDirectory}/${name}` : name
      const result = await onRenameMarkdown(newRelativePath, current.fingerprint)
      if (!result) return
      documentRef.current = result
      sourceRef.current = result.content
      baselineRef.current = result.content
      setMarkdownDocument(result)
      setMarkdownSource(result.content)
      setDirty(false)
      setNameDraft(fileNameFromPath(result.relative_path))
      setNameEditing(false)
      setStatusMessage(`Renamed to ${fileNameFromPath(result.relative_path)}`)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Markdown document could not be renamed.')
    }
  }, [dirty, documentDirectory, documentName, draftMode, nameDraft, onRenameMarkdown, saveDocument, saveDraft])

  const commitNameEdit = useCallback(() => {
    if (nameCommitInProgressRef.current) return
    nameCommitInProgressRef.current = true
    void renameDocument(nameDraft).finally(() => {
      nameCommitInProgressRef.current = false
    })
  }, [nameDraft, renameDocument])

  const refreshMarkdownFiles = useCallback(async () => {
    setMarkdownFilesLoading(true)
    setMarkdownFilesError(null)
    try {
      const files = await hiveoryClient.listCodeMarkdownFiles(workspaceId)
      setMarkdownFiles([...new Set([relativePath, ...files])].sort((left, right) => left.localeCompare(right)))
    } catch (reason: unknown) {
      setMarkdownFilesError(reason instanceof Error ? reason.message : 'Markdown files could not be listed.')
    } finally {
      setMarkdownFilesLoading(false)
    }
  }, [relativePath, workspaceId])

  const toggleMarkdownFileMenu = useCallback(() => {
    setMarkdownFileMenuOpen((open) => {
      if (!open) void refreshMarkdownFiles()
      return !open
    })
  }, [refreshMarkdownFiles])

  const showMarkdownFileMenu = useCallback(() => {
    void refreshMarkdownFiles()
    setMarkdownFileMenuOpen(true)
  }, [refreshMarkdownFiles])

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
    if (draftMode) {
      setError('Save this new Markdown document before adding a local image.')
      setStatusMessage('Save the document first')
      setNameEditing(true)
      return
    }
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
      if (typeof selected === 'string') {
        const imported = await hiveoryClient.importCodeAsset({
          workspace_id: workspaceId,
          source_path: selected,
          target_directory: documentDirectory,
        })
        insertImage(fileNameFromPath(imported.relative_path))
        setStatusMessage(`Imported ${fileNameFromPath(imported.relative_path)}`)
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The image could not be selected.')
    }
  }, [documentDirectory, draftMode, insertImage, workspaceId])

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

  const filteredMarkdownFiles = useMemo(() => {
    const query = markdownFileQuery.trim().toLowerCase()
    if (!query) return markdownFiles
    return markdownFiles.filter((path) => path.toLowerCase().includes(query))
  }, [markdownFileQuery, markdownFiles])

  return (
    <div className="hiveory-markdown-pane">
      <div className="hiveory-markdown-document-header">
        <div className="hiveory-markdown-document-path" ref={markdownFileMenuRef} title={relativePath}>
          <div className="hiveory-markdown-document-name-group">
            {nameEditing ? (
              <input
                ref={markdownNameInputRef}
                type="text"
                className="hiveory-markdown-name-input"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  if (skipNameCommitRef.current) {
                    skipNameCommitRef.current = false
                    return
                  }
                  commitNameEdit()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    skipNameCommitRef.current = true
                    setNameDraft(documentName)
                    setNameEditing(false)
                    event.currentTarget.blur()
                  }
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                aria-label="Markdown filename"
              />
            ) : (
              <button
                type="button"
                className="hiveory-markdown-document-name"
                onClick={(event) => {
                  event.stopPropagation()
                  setNameDraft(documentName)
                  setNameEditing(true)
                }}
                title="Click to rename this Markdown file"
              >
                {documentName}
              </button>
            )}
            {documentDirectory && <span className="hiveory-markdown-document-directory">/{documentDirectory}</span>}
          </div>
          <button
            type="button"
            className={`hiveory-markdown-file-picker-button${markdownFileMenuOpen ? ' is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              toggleMarkdownFileMenu()
            }}
            title="Open Markdown document"
            aria-label="Open Markdown document"
            aria-haspopup="menu"
            aria-expanded={markdownFileMenuOpen}
          >
            <ChevronDown size={14} />
          </button>
          {dirty && <span className="hiveory-markdown-dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />}
          {statusMessage && <span className="hiveory-markdown-status-message" role="status">{statusMessage}</span>}
          {markdownFileMenuOpen && (
            <FloatingMarkdownMenu anchor={markdownFileMenuRef} className="hiveory-markdown-file-menu" align="start">
              <div className="hiveory-markdown-file-menu-title"><FolderOpen size={14} />Markdown files</div>
              <label className="hiveory-markdown-file-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={markdownFileQuery}
                  onChange={(event) => setMarkdownFileQuery(event.target.value)}
                  placeholder="Search Markdown files…"
                  aria-label="Search Markdown files"
                />
              </label>
              <button
                type="button"
                role="menuitem"
                className="hiveory-markdown-file-create"
                onClick={() => {
                  setMarkdownFileMenuOpen(false)
                  setMarkdownFileQuery('')
                  createNewDraft()
                }}
              >
                <FilePlus2 size={14} />Create new Markdown
              </button>
              <div className="hiveory-markdown-file-list">
                {markdownFilesLoading && <div className="hiveory-markdown-file-state"><LoaderCircle size={14} className="hiveory-markdown-spin" />Loading files…</div>}
                {!markdownFilesLoading && markdownFilesError && <div className="hiveory-markdown-file-state is-error">{markdownFilesError}</div>}
                {!markdownFilesLoading && !markdownFilesError && filteredMarkdownFiles.map((path) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={path}
                    className={`hiveory-markdown-file-item${path === relativePath ? ' is-current' : ''}`}
                    onClick={() => openMarkdownDocument(path)}
                    title={path}
                  >
                    <FileText size={14} />
                    <span>{path}</span>
                  </button>
                ))}
                {!markdownFilesLoading && !markdownFilesError && !filteredMarkdownFiles.length && <div className="hiveory-markdown-file-state">No Markdown files found.</div>}
              </div>
            </FloatingMarkdownMenu>
          )}
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
            <FloatingMarkdownMenu anchor={headerMenuRef} className="hiveory-markdown-header-menu">
              <div className="hiveory-markdown-header-menu-title">{documentName}</div>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); createNewDraft() }}><FilePlus2 size={14} />New Markdown</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); showMarkdownFileMenu() }}><FolderOpen size={14} />Open Markdown…</button>
              <button type="button" role="menuitem" disabled={saving} onClick={() => { setHeaderMenuOpen(false); void saveDocument() }}><Save size={14} />{saving ? 'Saving…' : 'Save document'}</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); setNameDraft(documentName); setNameEditing(true) }}><PenLine size={14} />Rename document…</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); void reloadDocument() }}><RotateCcw size={14} />Reload from disk</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); changeViewMode('preview') }}><Eye size={14} />Preview</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); void shareMarkdown() }}><Share2 size={14} />Share Markdown</button>
              <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); void copyMarkdown() }}><Copy size={14} />Copy Markdown</button>
              <button type="button" role="menuitem" onClick={() => runMoreCommand(() => editor?.chain().focus().undo().run())}><Undo2 size={14} />Undo</button>
              <button type="button" role="menuitem" onClick={() => runMoreCommand(() => editor?.chain().focus().redo().run())}><Redo2 size={14} />Redo</button>
            </FloatingMarkdownMenu>
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
        <div className="hiveory-markdown-more-wrap" ref={moreMenuAnchorRef}>
          <MarkdownToolbarButton label="More blocks" icon={Ellipsis} disabled={!editor || viewMode !== 'rich'} onClick={() => setMoreOpen((value) => !value)} active={moreOpen} />
          {moreOpen && (
            <FloatingMarkdownMenu anchor={moreMenuAnchorRef} className="hiveory-markdown-more-menu">
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().toggleHeading({ level: 4 }).run())}><Heading4 size={15} />Heading 4</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().toggleHeading({ level: 5 }).run())}><Heading5 size={15} />Heading 5</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().toggleCodeBlock().run())}><Code2 size={15} />Code block</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => toggleMark('code'))}><Code2 size={15} />Inline code</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().setHorizontalRule().run())}><Minus size={15} />Divider</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={insertTable}><Table2 size={15} />Table</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().insertInlineMath({ latex: 'x^2' }).run())}><Sigma size={15} />Inline math</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().insertBlockMath({ latex: 'x^2 + y^2 = z^2' }).run())}><Sigma size={15} />Math block</button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runMoreCommand(() => editor?.chain().focus().setDetails().run())}><ChevronRight size={15} />Collapsible section</button>
            </FloatingMarkdownMenu>
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
            <span className="hiveory-markdown-link-hint">Ctrl-click linked text to open it in your default browser.</span>
            <div className="hiveory-markdown-popover-actions">
              <button type="button" disabled={!/^https?:\/\//i.test(linkValue.trim())} onClick={() => void hiveoryClient.openExternalUrl({ url: linkValue.trim() }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The link could not be opened.'))}><ExternalLink size={13} />Open</button>
              <button type="button" onClick={() => { editor?.chain().focus().unsetLink().run(); setLinkPanelOpen(false) }}>Remove</button>
              <button type="submit" className="is-primary">Apply</button>
            </div>
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
