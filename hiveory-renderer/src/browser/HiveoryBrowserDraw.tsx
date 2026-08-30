import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArrowUpRight, Check, Eraser, MousePointer2, PenLine, Redo2, Square, Type, Undo2, X } from 'lucide-react'
import type { BrowserFrame } from '../api/hiveory-client'
import { browserFrameUrl } from './browser-models'

type DrawTool = 'pointer' | 'pen' | 'highlight' | 'rectangle' | 'arrow' | 'text'
type DrawPoint = { x: number; y: number }
type DrawStroke = {
  tool: Exclude<DrawTool, 'pointer'>
  start: DrawPoint
  end?: DrawPoint
  points?: DrawPoint[]
  text?: string
  color: string
  width: number
}

interface HiveoryBrowserDrawProps {
  frame: BrowserFrame
  onCancel: () => void
  onCopied: () => void
  onError: (message: string) => void
}

const colors = ['#ff5d73', '#ffd166', '#57d3ff', '#ffffff', '#73e09b']

function imageBounds(width: number, height: number, frame: BrowserFrame): { left: number; top: number; width: number; height: number; scale: number } {
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
  if (stroke.tool === 'highlight') context.globalAlpha = 0.32
  if (stroke.tool === 'pen' || stroke.tool === 'highlight') {
    const points = stroke.points?.length ? stroke.points.map(map) : [start, end]
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y))
    context.stroke()
  } else if (stroke.tool === 'rectangle') {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
  } else if (stroke.tool === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    const head = Math.max(8, stroke.width * scale * 4)
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    context.moveTo(end.x, end.y)
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6))
    context.moveTo(end.x, end.y)
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6))
    context.stroke()
  } else if (stroke.tool === 'text' && stroke.text) {
    context.font = `${Math.max(12, stroke.width * 5 * scale)}px Inter, Segoe UI, sans-serif`
    context.fillText(stroke.text, start.x, start.y)
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
  const [strokes, setStrokes] = useState<DrawStroke[]>([])
  const [redo, setRedo] = useState<DrawStroke[]>([])
  const [draft, setDraft] = useState<DrawStroke | null>(null)
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
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', render)
    }
  }, [render])

  const finishStroke = (stroke: DrawStroke | null) => {
    if (!stroke) return
    setStrokes((current) => [...current, stroke])
    setRedo([])
    setDraft(null)
  }

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pointer') return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event, event.currentTarget, frame)
    if (tool === 'text') {
      const label = window.prompt('Text for the screenshot')?.trim()
      if (label) finishStroke({ tool, start: point, text: label.slice(0, 200), color, width })
      return
    }
    setDraft({ tool, start: point, end: point, points: [point], color, width })
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    const point = pointFromEvent(event, event.currentTarget, frame)
    setDraft((current) => current ? { ...current, end: point, points: current.tool === 'pen' || current.tool === 'highlight' ? [...(current.points ?? []), point] : current.points } : null)
  }

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const point = pointFromEvent(event, event.currentTarget, frame)
    finishStroke({ ...draft, end: point })
  }

  const undo = () => {
    setStrokes((current) => {
      const item = current[current.length - 1]
      if (item) setRedo((redoItems) => [...redoItems, item])
      return current.slice(0, -1)
    })
  }

  const redoLast = () => {
    setRedo((current) => {
      const item = current[current.length - 1]
      if (item) setStrokes((items) => [...items, item])
      return current.slice(0, -1)
    })
  }

  const copy = async () => {
    try {
      await copyMarkedPng(frame, strokes)
      onCopied()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The marked screenshot could not be copied.')
    }
  }

  return (
    <div className="hiveory-browser-draw" ref={stageRef}>
      <img className="hiveory-browser-draw-image" src={image} alt="Current browser page" />
      <canvas
        ref={canvasRef}
        className={tool === 'pointer' ? 'hiveory-browser-draw-canvas is-pointer' : 'hiveory-browser-draw-canvas'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => finishStroke(draft)}
      />
      <div className="hiveory-browser-draw-toolbar" role="toolbar" aria-label="Screenshot drawing tools">
        <button type="button" className={tool === 'pointer' ? 'is-active' : ''} onClick={() => setTool('pointer')} aria-label="Pointer" title="Pointer"><MousePointer2 size={14} /></button>
        <button type="button" className={tool === 'pen' ? 'is-active' : ''} onClick={() => setTool('pen')} aria-label="Pen" title="Pen"><PenLine size={14} /></button>
        <button type="button" className={tool === 'highlight' ? 'is-active' : ''} onClick={() => setTool('highlight')} aria-label="Highlighter" title="Highlighter"><span className="hiveory-browser-highlight-swatch" /></button>
        <button type="button" className={tool === 'rectangle' ? 'is-active' : ''} onClick={() => setTool('rectangle')} aria-label="Rectangle" title="Rectangle"><Square size={14} /></button>
        <button type="button" className={tool === 'arrow' ? 'is-active' : ''} onClick={() => setTool('arrow')} aria-label="Arrow" title="Arrow"><ArrowUpRight size={14} /></button>
        <button type="button" className={tool === 'text' ? 'is-active' : ''} onClick={() => setTool('text')} aria-label="Text" title="Text"><Type size={14} /></button>
        <span className="hiveory-browser-draw-separator" />
        <div className="hiveory-browser-color-row" aria-label="Drawing color">
          {colors.map((item) => <button key={item} type="button" className={color === item ? 'is-active' : ''} style={{ '--hiveory-draw-color': item } as CSSProperties} onClick={() => setColor(item)} aria-label={`Use ${item}`} title={`Color ${item}`} />)}
        </div>
        <label className="hiveory-browser-draw-width" title="Line width">
          <span>Width</span>
          <input type="range" min={1} max={16} value={width} onChange={(event) => setWidth(Number(event.target.value))} aria-label="Line width" />
        </label>
        <span className="hiveory-browser-draw-separator" />
        <button type="button" onClick={undo} disabled={!strokes.length} aria-label="Undo" title="Undo"><Undo2 size={14} /></button>
        <button type="button" onClick={redoLast} disabled={!redo.length} aria-label="Redo" title="Redo"><Redo2 size={14} /></button>
        <button type="button" onClick={() => { setStrokes([]); setRedo([]); setDraft(null) }} disabled={!strokes.length} aria-label="Clear drawing" title="Clear drawing"><Eraser size={14} /></button>
        <button type="button" onClick={onCancel} aria-label="Cancel drawing" title="Cancel"><X size={14} /></button>
        <button type="button" className="is-confirm" onClick={() => void copy()} aria-label="Copy marked screenshot" title="Copy marked screenshot"><Check size={14} /> Copy PNG</button>
      </div>
    </div>
  )
}
