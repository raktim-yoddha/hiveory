import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArrowUpRight, Check, Circle, Eraser, Highlighter, PenLine, Redo2, Square, Type, Undo2, X } from 'lucide-react'
import type { BrowserFrame } from '../../../shared/api/hiveory-client'
import { browserFrameUrl } from '../model/browser-models'

type DrawTool = 'pen' | 'highlight' | 'arrow' | 'rectangle' | 'ellipse' | 'text'
type DrawPoint = { x: number; y: number }
type DrawStroke = {
  tool: DrawTool
  start: DrawPoint
  end?: DrawPoint
  points?: DrawPoint[]
  text?: string
  color: string
  width: number
  fontSize: number
}

interface HiveoryBrowserDrawProps {
  frame: BrowserFrame
  onCancel: () => void
  onCopied: () => void
  onError: (message: string) => void
}

const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#111827', '#ffffff']
const widths = [2, 4, 8]
const fontSizes = [14, 18, 24, 32, 48]

function imageBounds(width: number, height: number, frame: BrowserFrame) {
  const scale = Math.min(width / frame.width, height / frame.height)
  const imageWidth = frame.width * scale
  const imageHeight = frame.height * scale
  return { left: (width - imageWidth) / 2, top: (height - imageHeight) / 2, width: imageWidth, height: imageHeight, scale }
}

function pointFromEvent(event: PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement, frame: BrowserFrame): DrawPoint {
  const bounds = canvas.getBoundingClientRect()
  const display = imageBounds(bounds.width, bounds.height, frame)
  return {
    x: Math.max(0, Math.min(frame.width, (event.clientX - bounds.left - display.left) / display.scale)),
    y: Math.max(0, Math.min(frame.height, (event.clientY - bounds.top - display.top) / display.scale)),
  }
}

function drawStroke(context: CanvasRenderingContext2D, stroke: DrawStroke, scale: number, offsetX: number, offsetY: number): void {
  const map = (point: DrawPoint) => ({ x: offsetX + point.x * scale, y: offsetY + point.y * scale })
  const start = map(stroke.start)
  const end = map(stroke.end ?? stroke.start)
  context.save()
  context.strokeStyle = stroke.color
  context.fillStyle = stroke.color
  context.lineWidth = stroke.width * scale
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (stroke.tool === 'highlight') context.globalAlpha = 0.35
  if (stroke.tool === 'pen' || stroke.tool === 'highlight') {
    const points = stroke.points?.length ? stroke.points.map(map) : [start, end]
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y))
    context.lineWidth = stroke.tool === 'highlight' ? stroke.width * 4 * scale : stroke.width * scale
    context.stroke()
  } else if (stroke.tool === 'rectangle') {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
  } else if (stroke.tool === 'ellipse') {
    const centerX = (start.x + end.x) / 2
    const centerY = (start.y + end.y) / 2
    context.beginPath()
    context.ellipse(centerX, centerY, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2)
    context.stroke()
  } else if (stroke.tool === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    const head = Math.max(10, stroke.width * scale * 3.5)
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    context.moveTo(end.x, end.y)
    context.lineTo(end.x - head * Math.cos(angle - 0.45), end.y - head * Math.sin(angle - 0.45))
    context.moveTo(end.x, end.y)
    context.lineTo(end.x - head * Math.cos(angle + 0.45), end.y - head * Math.sin(angle + 0.45))
    context.stroke()
  } else if (stroke.tool === 'text' && stroke.text) {
    context.font = `600 ${stroke.fontSize * scale}px Inter, Segoe UI, sans-serif`
    if (stroke.color.toLowerCase() === '#ffffff') {
      context.shadowColor = 'rgba(0,0,0,.72)'
      context.shadowBlur = 3 * scale
    }
    context.fillText(stroke.text, start.x, start.y + stroke.fontSize * scale)
  }
  context.restore()
}

async function copyMarkedPng(frame: BrowserFrame, strokes: DrawStroke[]): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard access is unavailable.')
  const image = new Image()
  image.src = browserFrameUrl(frame)
  await image.decode()
  const output = document.createElement('canvas')
  output.width = frame.width
  output.height = frame.height
  const context = output.getContext('2d')
  if (!context) throw new Error('The drawing canvas is unavailable.')
  context.drawImage(image, 0, 0, frame.width, frame.height)
  strokes.forEach((stroke) => drawStroke(context, stroke, 1, 0, 0))
  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The marked screenshot could not be created.')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export function HiveoryBrowserDraw({ frame, onCancel, onCopied, onError }: HiveoryBrowserDrawProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<DrawTool>('pen')
  const [color, setColor] = useState(colors[0])
  const [width, setWidth] = useState(4)
  const [fontSize, setFontSize] = useState(18)
  const [strokes, setStrokes] = useState<DrawStroke[]>([])
  const [redo, setRedo] = useState<DrawStroke[]>([])
  const [draft, setDraft] = useState<DrawStroke | null>(null)
  const [pendingText, setPendingText] = useState<{ point: DrawPoint; display: DrawPoint } | null>(null)
  const [copying, setCopying] = useState(false)
  const image = useMemo(() => browserFrameUrl(frame), [frame])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const bounds = stage.getBoundingClientRect()
    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio))
    canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio))
    canvas.style.width = `${bounds.width}px`
    canvas.style.height = `${bounds.height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, bounds.width, bounds.height)
    const display = imageBounds(bounds.width, bounds.height, frame)
    ;[...strokes, ...(draft ? [draft] : [])].forEach((stroke) => drawStroke(context, stroke, display.scale, display.left, display.top))
  }, [draft, frame, strokes])

  useEffect(() => {
    render()
    const observer = typeof ResizeObserver === 'undefined' || !stageRef.current ? null : new ResizeObserver(render)
    if (stageRef.current) observer?.observe(stageRef.current)
    window.addEventListener('resize', render)
    return () => { observer?.disconnect(); window.removeEventListener('resize', render) }
  }, [render])

  const finishStroke = useCallback((stroke: DrawStroke | null) => {
    if (!stroke) return
    setStrokes((current) => [...current, stroke])
    setRedo([])
    setDraft(null)
  }, [])

  const undo = useCallback(() => {
    setStrokes((current) => {
      const item = current.at(-1)
      if (item) setRedo((items) => [...items, item])
      return current.slice(0, -1)
    })
  }, [])

  const redoLast = useCallback(() => {
    setRedo((current) => {
      const item = current.at(-1)
      if (item) setStrokes((items) => [...items, item])
      return current.slice(0, -1)
    })
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pendingText) setPendingText(null)
        else onCancel()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoLast(); else undo()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel, pendingText, redoLast, undo])

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (copying) return
    const point = pointFromEvent(event, event.currentTarget, frame)
    if (tool === 'text') {
      const canvasBounds = event.currentTarget.getBoundingClientRect()
      setPendingText({ point, display: { x: event.clientX - canvasBounds.left, y: event.clientY - canvasBounds.top } })
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft({ tool, start: point, end: point, points: [point], color, width, fontSize })
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    const point = pointFromEvent(event, event.currentTarget, frame)
    setDraft((current) => current ? { ...current, end: point, points: current.tool === 'pen' || current.tool === 'highlight' ? [...(current.points ?? []), point] : current.points } : null)
  }

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    finishStroke({ ...draft, end: pointFromEvent(event, event.currentTarget, frame) })
  }

  const commitText = (value: string) => {
    const text = value.trim().slice(0, 300)
    if (pendingText && text) finishStroke({ tool: 'text', start: pendingText.point, color, width, fontSize, text })
    setPendingText(null)
  }

  const copy = async () => {
    setCopying(true)
    try {
      await copyMarkedPng(frame, strokes)
      onCopied()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The marked screenshot could not be copied.')
    } finally {
      setCopying(false)
    }
  }

  const tools: Array<{ id: DrawTool; label: string; icon: typeof PenLine }> = [
    { id: 'pen', label: 'Pen', icon: PenLine },
    { id: 'highlight', label: 'Highlighter', icon: Highlighter },
    { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
    { id: 'rectangle', label: 'Rectangle', icon: Square },
    { id: 'ellipse', label: 'Ellipse', icon: Circle },
    { id: 'text', label: 'Text', icon: Type },
  ]

  return (
    <div className="hiveory-browser-draw" ref={stageRef} aria-busy={copying}>
      <img className="hiveory-browser-draw-image" src={image} alt="Current browser page" />
      <canvas ref={canvasRef} className={copying ? 'hiveory-browser-draw-canvas is-busy' : 'hiveory-browser-draw-canvas'} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />
      {pendingText && <input autoFocus className="hiveory-browser-draw-text" aria-label="Annotation text" style={{ left: pendingText.display.x, top: pendingText.display.y, color, fontSize }} onBlur={(event) => commitText(event.currentTarget.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commitText(event.currentTarget.value) } else if (event.key === 'Escape') { event.preventDefault(); setPendingText(null) } }} />}
      <div className="hiveory-browser-draw-controls">
        <div className="hiveory-browser-draw-toolbar" role="toolbar" aria-label="Screenshot drawing tools">
          {tools.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tool === id ? 'is-active' : ''} onClick={() => setTool(id)} aria-label={label} title={label}><Icon size={14} /></button>)}
          <span className="hiveory-browser-draw-separator" />
          <div className="hiveory-browser-color-row" aria-label="Drawing color">{colors.map((item) => <button key={item} type="button" className={color === item ? 'is-active' : ''} style={{ '--hiveory-draw-color': item } as CSSProperties} onClick={() => setColor(item)} aria-label={`Use ${item}`} title={`Color ${item}`} />)}</div>
          <div className="hiveory-browser-draw-options" aria-label="Line width">{widths.map((item) => <button key={item} type="button" className={width === item ? 'is-active' : ''} onClick={() => setWidth(item)} aria-label={`${item} px line`}><span style={{ width: item + 2, height: item + 2 }} /></button>)}</div>
          <div className="hiveory-browser-draw-font" aria-label="Font size"><Type size={12} />{fontSizes.map((item) => <button key={item} type="button" className={fontSize === item ? 'is-active' : ''} onClick={() => setFontSize(item)} aria-label={`${item} px text`}>{item}</button>)}</div>
          <span className="hiveory-browser-draw-separator" />
          <button type="button" onClick={undo} disabled={!strokes.length} aria-label="Undo" title="Undo"><Undo2 size={14} /></button>
          <button type="button" onClick={redoLast} disabled={!redo.length} aria-label="Redo" title="Redo"><Redo2 size={14} /></button>
          <button type="button" onClick={() => { setStrokes([]); setRedo([]); setDraft(null) }} disabled={!strokes.length} aria-label="Clear all" title="Clear all"><Eraser size={14} /></button>
        </div>
        <div className="hiveory-browser-draw-actions"><span>Draw on the page, then copy the markup to paste into your agent.</span><button type="button" onClick={onCancel} disabled={copying}><X size={14} /> Cancel</button><button type="button" className="is-confirm" onClick={() => void copy()} disabled={copying}><Check size={14} /> {copying ? 'Copying…' : 'Copy Markup'}</button></div>
      </div>
    </div>
  )
}
