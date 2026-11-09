import { File, FileArchive, FileAudio, FileBox, FileCode2, FileCog, FileImage, FileJson, FileLock2, FileTerminal, FileText, FileVideo, type LucideIcon } from 'lucide-react'
import { cx } from '../../lib/cx'
import { fileKind, type FileGlyph } from './file-kind'
import styles from './FileIcon.module.css'

const GLYPH: Record<FileGlyph, LucideIcon> = {
  code: FileCode2,
  json: FileJson,
  text: FileText,
  image: FileImage,
  terminal: FileTerminal,
  config: FileCog,
  lock: FileLock2,
  archive: FileArchive,
  video: FileVideo,
  audio: FileAudio,
  container: FileBox,
  file: File
}

/** A file's icon by its type, tinted by language (ADR 0065): the Explorer, Changes, the review pane and file tabs. */
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const [glyph, tone] = fileKind(name)
  const Icon = GLYPH[glyph]
  return <Icon aria-hidden className={cx(styles.icon, className)} data-tone={tone} />
}
