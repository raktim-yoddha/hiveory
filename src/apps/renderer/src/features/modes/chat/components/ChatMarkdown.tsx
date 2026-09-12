import { useEffect } from 'react'
import Code from '@tiptap/extension-code'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

const markdownExtensions = [
  StarterKit.configure({ link: false, code: false, codeBlock: false }),
  Code,
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  Image.configure({ allowBase64: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Markdown.configure({ markedOptions: { gfm: true } }),
]

export function ChatMarkdown({ text }: { text: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: markdownExtensions,
    content: text,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'hiveory-chat-markdown-content',
        spellcheck: 'false',
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getMarkdown()
    if (current === text) return
    try {
      editor.commands.setContent(text, { contentType: 'markdown', emitUpdate: false })
    } catch {
      editor.commands.setContent(text, { emitUpdate: false })
    }
  }, [editor, text])

  return <div className="hiveory-chat-markdown"><EditorContent editor={editor} /></div>
}
