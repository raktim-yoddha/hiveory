/**
 * Runs inside every browser page, in an isolated JavaScript world: the page's
 * own scripts can neither see nor tamper with it, but it shares the DOM.
 * Installed lazily as `globalThis.__hv` and kept until the page navigates, so
 * snapshot refs (`@12`) stay stable between calls.
 *
 * Plain JavaScript in a string: it must be self-contained (no bundler helpers).
 * Styles go through CSSOM / Web Animations only, which page CSP cannot block.
 */
export const PAGE_SCRIPT = String.raw`(() => {
  const D = document
  const OVERLAY = 'data-hiveory-overlay'
  const refs = new Map()
  const ids = new WeakMap()
  let next = 1

  const norm = (s) => (s || '').replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]+/g, ' ').trim()
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const q = (s) => JSON.stringify(s)
  const refOf = (el) => {
    let n = ids.get(el)
    if (!n) {
      n = next++
      ids.set(el, n)
      refs.set(n, new WeakRef(el))
    }
    return n
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE', 'PARAM', 'SOURCE', 'TRACK'])
  const INPUT_ROLES = { button: 'button', submit: 'button', reset: 'button', image: 'button', file: 'button', color: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox', hidden: 'hidden' }
  const TAG_ROLES = { BUTTON: 'button', SUMMARY: 'button', TEXTAREA: 'textbox', OPTION: 'option', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary', FORM: 'form', DIALOG: 'dialog', UL: 'list', OL: 'list', MENU: 'list', LI: 'listitem', TABLE: 'table', TR: 'row', TD: 'cell', TH: 'columnheader', IFRAME: 'iframe', FRAME: 'iframe', VIDEO: 'video', AUDIO: 'audio', CANVAS: 'canvas', PROGRESS: 'progressbar', ARTICLE: 'article', FIELDSET: 'group', DETAILS: 'group' }
  const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'clickable'])
  const NAME_FROM_CONTENT = new Set(['link', 'button', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'heading', 'clickable', 'cell', 'columnheader', 'checkbox', 'radio', 'switch'])
  const CONTAINERS = new Set(['navigation', 'main', 'banner', 'contentinfo', 'complementary', 'form', 'dialog', 'alertdialog', 'list', 'listitem', 'table', 'row', 'cell', 'columnheader', 'article', 'region', 'group', 'menu', 'menubar', 'tablist', 'tabpanel', 'toolbar', 'grid', 'tree', 'radiogroup', 'search', 'alert', 'status'])
  const PHRASING = new Set(['B', 'I', 'EM', 'STRONG', 'SPAN', 'CODE', 'SMALL', 'MARK', 'SUB', 'SUP', 'ABBR', 'TIME', 'U', 'S', 'Q', 'CITE', 'KBD', 'VAR', 'DFN', 'BDI', 'BDO', 'FONT', 'LABEL', 'DATA', 'DEL', 'INS', 'WBR', 'BR'])
  const HAS_CONTROL = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[contenteditable=""],[contenteditable=true]'

  const editableAttr = (el) => {
    const v = el.getAttribute && el.getAttribute('contenteditable')
    return v === '' || v === 'true' || v === 'plaintext-only'
  }

  const roleOf = (el) => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit.trim().split(/\s+/)[0]
    const tag = el.tagName
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : ''
    if (tag === 'INPUT') return INPUT_ROLES[(el.type || 'text').toLowerCase()] || 'textbox'
    if (tag === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox'
    if (tag === 'IMG') return el.getAttribute('alt') === '' ? '' : 'img'
    if (tag === 'SECTION') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : ''
    if (editableAttr(el)) return 'textbox'
    return TAG_ROLES[tag] || ''
  }

  const textOf = (el) => norm(el.innerText !== undefined ? el.innerText : el.textContent)

  const nameOf = (el, role) => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return norm(aria)
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const root = el.getRootNode()
      const t = by.split(/\s+/).map((id) => (root.getElementById ? root.getElementById(id) : D.getElementById(id))).filter(Boolean).map(textOf).join(' ')
      if (t) return norm(t)
    }
    if (el.labels && el.labels.length) {
      const t = norm([...el.labels].map(textOf).join(' '))
      if (t) return t
    }
    const tag = el.tagName
    if (tag === 'IMG' || (tag === 'INPUT' && el.type === 'image')) return norm(el.getAttribute('alt') || el.getAttribute('title') || '')
    if (tag === 'INPUT' && /^(button|submit|reset)$/.test(el.type)) return norm(el.value || (el.type === 'submit' ? 'Submit' : ''))
    if (tag === 'IFRAME') return norm(el.getAttribute('title') || el.getAttribute('name') || '')
    if (tag === 'svg' || tag === 'SVG') {
      const t = el.querySelector('title')
      return t ? norm(t.textContent) : ''
    }
    if (NAME_FROM_CONTENT.has(role)) {
      const t = textOf(el)
      if (t) return t
      const img = el.querySelector('img[alt],svg title,[aria-label]')
      if (img) return norm(img.getAttribute('alt') || img.getAttribute('aria-label') || img.textContent)
    }
    return norm(el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '')
  }

  const visible = (el) => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0)

  /** Element rect in top-level viewport coordinates (crosses same-origin iframes). */
  const absRect = (el) => {
    const r = el.getBoundingClientRect()
    let x = r.left
    let y = r.top
    let win = el.ownerDocument.defaultView
    while (win && win !== window && win.frameElement) {
      const f = win.frameElement
      const fr = f.getBoundingClientRect()
      x += fr.left + f.clientLeft
      y += fr.top + f.clientTop
      win = f.ownerDocument.defaultView
    }
    return { x, y, width: r.width, height: r.height }
  }

  const inView = (r) => r.y + r.height > 0 && r.x + r.width > 0 && r.y < innerHeight && r.x < innerWidth

  const childrenOf = (node) => {
    if (node.shadowRoot) return node.shadowRoot.childNodes
    if (node.tagName === 'SLOT') {
      const assigned = node.assignedNodes({ flatten: true })
      return assigned.length ? assigned : node.childNodes
    }
    return node.childNodes
  }

  const shortHref = (el) => {
    try {
      const u = new URL(el.href, location.href)
      return cut(u.origin === location.origin ? u.pathname + u.search + u.hash : u.href, 80)
    } catch {
      return ''
    }
  }

  const states = (el, role) => {
    const out = []
    if (role === 'heading') out.push('level=' + (Number(el.getAttribute('aria-level')) || Number(el.tagName.slice(1)) || 2))
    if (el.checked === true || el.getAttribute('aria-checked') === 'true') out.push('checked')
    if (el.getAttribute('aria-pressed') === 'true') out.push('pressed')
    if (el.getAttribute('aria-selected') === 'true') out.push('selected')
    const exp = el.getAttribute('aria-expanded')
    if (exp === 'true') out.push('expanded')
    else if (exp === 'false') out.push('collapsed')
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') out.push('disabled')
    if (el.required === true) out.push('required')
    const root = el.getRootNode()
    if (root.activeElement === el) out.push('focused')
    return out
  }

  const valueOf = (el, role) => {
    if (el.tagName === 'SELECT') return [...el.selectedOptions].map((o) => norm(o.label)).join(', ')
    if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || role === 'combobox' || role === 'slider') {
      if (el.type === 'password') return el.value ? '••••' : ''
      if ('value' in el && typeof el.value === 'string') return el.value
      if (editableAttr(el)) return textOf(el)
    }
    return ''
  }

  function snapshot(full, max) {
    const lines = []
    let size = 0
    let truncated = false
    // Text runs inside one block (a paragraph with <b>, <a>…) share a line; separate blocks get their own.
    const push = (depth, text, block) => {
      if (truncated) return
      const last = lines[lines.length - 1]
      if (block && last && last.block === block && last.depth === depth) {
        last.line += ' ' + text
        size += text.length + 1
      } else {
        const line = '  '.repeat(depth) + '- ' + (block ? 'text: ' : '') + text
        lines.push({ depth, line, block, text: Boolean(block) })
        size += line.length + 1
      }
      if (size > max) truncated = true
    }
    const blockOf = (node) => {
      let el = node.parentElement
      while (el && PHRASING.has(el.tagName) && el.parentElement) el = el.parentElement
      return el || node
    }

    const walk = (node, depth, pointer, ox, oy) => {
      for (const child of childrenOf(node)) {
        if (truncated) return
        if (child.nodeType === 3) {
          const t = norm(child.data)
          if (!t) continue
          if (!full) {
            const range = D.createRange()
            range.selectNodeContents(child)
            const r = range.getBoundingClientRect()
            if (!inView({ x: r.left + ox, y: r.top + oy, width: r.width, height: r.height })) continue
          }
          push(depth, cut(t, 300), blockOf(child))
          continue
        }
        if (child.nodeType !== 1) continue
        const el = child
        if (SKIP.has(el.tagName) || el.hasAttribute(OVERLAY)) continue
        if (el.getAttribute('aria-hidden') === 'true' || el.hidden) continue
        if (!visible(el)) continue
        let role = roleOf(el)
        if (role === 'hidden') continue
        if (role === 'none' || role === 'presentation') role = ''
        const b = el.getBoundingClientRect()
        const r = { x: b.left + ox, y: b.top + oy, width: b.width, height: b.height }
        const boxed = r.width > 0 && r.height > 0
        const seen = full ? boxed : boxed && inView(r)
        let cursorPointer = false
        if (!role && !pointer) {
          cursorPointer = getComputedStyle(el).cursor === 'pointer' || el.hasAttribute('onclick') || (el.hasAttribute('tabindex') && el.tabIndex >= 0)
          if (cursorPointer) role = 'clickable'
        }
        const interactive = INTERACTIVE.has(role)

        if (role === 'iframe') {
          if (!seen) continue
          let doc = null
          try {
            doc = el.contentDocument
          } catch {
            doc = null
          }
          const name = nameOf(el, role)
          if (doc && doc.body) {
            push(depth, 'iframe' + (name ? ' ' + q(cut(name, 80)) : '') + ':')
            walk(doc.body, depth + 1, false, r.x + el.clientLeft, r.y + el.clientTop)
          } else {
            let host = ''
            try {
              host = new URL(el.src).host
            } catch {}
            push(depth, 'iframe ' + q(cut(name || host || 'frame', 80)) + ' [@' + refOf(el) + '] (cross-origin: use mouse coordinates or a screenshot)')
          }
          continue
        }

        if (interactive) {
          const content = NAME_FROM_CONTENT.has(role) && role !== 'checkbox' && role !== 'radio'
          const nested = content && el.querySelector(HAS_CONTROL)
          if (seen) {
            const name = nested ? norm(el.getAttribute('aria-label') || '') : nameOf(el, role)
            let line = role + (name ? ' ' + q(cut(name, 120)) : '') + ' [@' + refOf(el) + ']'
            const st = states(el, role)
            if (st.length) line += ' [' + st.join(', ') + ']'
            const value = valueOf(el, role)
            if (value) line += ' value=' + q(cut(value, 160))
            else if (el.placeholder && el.placeholder !== name) line += ' placeholder=' + q(cut(el.placeholder, 80))
            if (role === 'link') {
              const href = shortHref(el)
              if (href) line += ' → ' + href
            }
            push(depth, line + (nested ? ':' : ''))
          }
          if (nested) walk(el, depth + 1, true, ox, oy)
          continue
        }

        if (role === 'heading') {
          if (!seen) continue
          const st = states(el, role)
          if (el.querySelector(HAS_CONTROL)) {
            push(depth, 'heading [' + st.join(', ') + ']:')
            walk(el, depth + 1, pointer, ox, oy)
          } else {
            const name = nameOf(el, role)
            if (name) push(depth, 'heading ' + q(cut(name, 200)) + ' [' + st.join(', ') + ']')
          }
          continue
        }

        if (role === 'img' || role === 'video' || role === 'audio' || role === 'canvas' || role === 'progressbar') {
          if (!seen) continue
          const name = nameOf(el, role)
          if (role === 'img' && !name) continue
          const extra = role === 'canvas' || role === 'video' ? ' [@' + refOf(el) + '] ' + Math.round(r.width) + '×' + Math.round(r.height) : ''
          push(depth, role + (name ? ' ' + q(cut(name, 120)) : '') + extra)
          continue
        }

        if (CONTAINERS.has(role)) {
          const name = role === 'listitem' || role === 'row' || role === 'cell' || role === 'columnheader' ? '' : nameOf(el, role)
          const start = lines.length
          push(depth, role + (name ? ' ' + q(cut(name, 80)) : '') + ':')
          walk(el, depth + 1, pointer, ox, oy)
          const added = lines.length - start - 1
          if (added <= 0) {
            lines.splice(start)
          } else if (added === 1 && lines[start + 1].text && !name) {
            // A container holding one line of text collapses onto a single line.
            lines[start].line = lines[start].line + ' ' + lines[start + 1].line.trim().replace(/^- text: /, '')
            lines.splice(start + 1, 1)
          } else if (added === 1 && !name) {
            // An unnamed wrapper around one element adds nothing: keep the element, drop the wrapper.
            const child = lines[start + 1]
            child.line = child.line.slice(2)
            child.depth -= 1
            lines.splice(start, 1)
          }
          continue
        }

        walk(el, depth, pointer || cursorPointer, ox, oy)
      }
    }

    if (D.body) walk(D.body, 0, false, 0, 0)
    const docH = Math.max(D.documentElement.scrollHeight, D.body ? D.body.scrollHeight : 0)
    return {
      text: lines.map((l) => l.line).join('\n'),
      truncated,
      scrollY: Math.round(scrollY),
      scrollMax: Math.max(0, Math.round(docH - innerHeight)),
      viewport: innerWidth + '×' + innerHeight
    }
  }

  const deepQueryAll = (selector, root = D) => {
    const out = [...root.querySelectorAll(selector)]
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepQueryAll(selector, el.shadowRoot))
    return out
  }

  const describe = (el) => {
    if (!el) return 'nothing'
    const role = roleOf(el)
    const name = role ? nameOf(el, role) : ''
    if (role && name) return role + ' ' + q(cut(name, 60))
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    return '<' + el.tagName.toLowerCase() + id + cls + '>'
  }

  const byText = (raw) => {
    const exact = /^".*"$/.test(raw)
    const want = exact ? raw.slice(1, -1) : norm(raw).toLowerCase()
    const matches = (el) => {
      const t = textOf(el)
      return exact ? t === want : t.toLowerCase().includes(want)
    }
    const found = []
    const walker = D.createTreeWalker(D.body, NodeFilter.SHOW_ELEMENT)
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (SKIP.has(el.tagName) || el.hasAttribute(OVERLAY)) continue
      if (!(exact ? norm(el.textContent) === want || norm(el.textContent).includes(want) : norm(el.textContent).toLowerCase().includes(want))) continue
      if (!visible(el) || !matches(el)) continue
      found.push(el)
    }
    // Deepest matches only, lifted to their clickable ancestor.
    const deepest = found.filter((el) => !found.some((other) => other !== el && el.contains(other)))
    const lifted = [...new Set(deepest.map((el) => el.closest('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],label,summary') || el))]
    if (!lifted.length) throw new Error('No visible element has the text ' + q(raw) + '.')
    if (lifted.length > 1) throw new Error(lifted.length + ' elements have the text ' + q(raw) + ' (' + lifted.slice(0, 4).map(describe).join(', ') + '). Use a snapshot ref like @12 instead.')
    return lifted[0]
  }

  function resolve(target) {
    const t = String(target).trim()
    const m = /^(?:@|ref=)(\d+)$/.exec(t)
    if (m) {
      const ref = refs.get(Number(m[1]))
      const el = ref && ref.deref()
      if (!el || !el.isConnected) throw new Error('Ref @' + m[1] + ' is gone — the page changed. Take a new browser_snapshot.')
      return el
    }
    if (t.startsWith('text=')) return byText(t.slice(5))
    let list
    try {
      list = deepQueryAll(t.startsWith('css=') ? t.slice(4) : t)
    } catch {
      throw new Error(q(t) + ' is not a snapshot ref (@12), text=… or a CSS selector.')
    }
    const shown = list.filter(visible)
    const pool = shown.length ? shown : list
    if (!pool.length) throw new Error('Nothing matches ' + q(t) + '.')
    if (pool.length > 1) throw new Error(pool.length + ' elements match ' + q(t) + ' (' + pool.slice(0, 4).map(describe).join(', ') + '). Use a snapshot ref like @12 or a more specific selector.')
    return pool[0]
  }

  const within = (node, el) => {
    for (let n = node; n; n = n.parentNode || n.host) if (n === el) return true
    return false
  }

  const deepHit = (x, y) => {
    let doc = D
    let ox = 0
    let oy = 0
    for (let guard = 0; guard < 8; guard++) {
      let hit = doc.elementFromPoint(x - ox, y - oy)
      while (hit && hit.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x - ox, y - oy)
        if (!inner || inner === hit) break
        hit = inner
      }
      if (hit && (hit.tagName === 'IFRAME' || hit.tagName === 'FRAME')) {
        let inner = null
        try {
          inner = hit.contentDocument
        } catch {
          inner = null
        }
        if (inner) {
          const fr = hit.getBoundingClientRect()
          ox += fr.left + hit.clientLeft
          oy += fr.top + hit.clientTop
          doc = inner
          continue
        }
      }
      return hit
    }
    return null
  }

  function point(target) {
    const el = resolve(target)
    let r = absRect(el)
    if (!(r.y >= 0 && r.x >= 0 && r.y + r.height <= innerHeight && r.x + r.width <= innerWidth)) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      r = absRect(el)
    }
    if (r.width === 0 && r.height === 0) throw new Error(describe(el) + ' has no size on screen (it may be collapsed or off-canvas).')
    const candidates = [
      [0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.15], [0.85, 0.85]
    ].map(([fx, fy]) => ({ x: Math.round(r.x + r.width * fx), y: Math.round(r.y + r.height * fy) }))
    const labelled = el.labels ? [...el.labels] : []
    let blocker = null
    for (const p of candidates) {
      if (p.x < 0 || p.y < 0 || p.x >= innerWidth || p.y >= innerHeight) continue
      const hit = deepHit(p.x, p.y)
      if (hit && (within(hit, el) || within(el, hit) && (hit.tagName === 'LABEL' || labelled.includes(hit)) || labelled.some((l) => within(hit, l)))) {
        return { x: p.x, y: p.y, desc: describe(el) }
      }
      blocker = blocker || hit
    }
    const c = candidates[0]
    return { x: c.x, y: c.y, desc: describe(el), covered: describe(blocker) }
  }

  const EDITABLE_INPUT = /^(text|search|email|url|tel|password|number|date|datetime-local|month|time|week)$/
  const isEditable = (el) => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && EDITABLE_INPUT.test(el.type || 'text')) || el.isContentEditable

  function focusEditable(target) {
    let el = resolve(target)
    if (!isEditable(el)) {
      const inner = [...el.querySelectorAll('input,textarea,[contenteditable]')].filter((e) => isEditable(e) && visible(e))
      if (inner.length !== 1) throw new Error(describe(el) + ' is not a text field. Use a textbox ref from the snapshot.')
      el = inner[0]
    }
    if (el.disabled || el.readOnly) throw new Error(describe(el) + ' is disabled or read-only.')
    el.focus()
    if (el.isContentEditable) {
      const range = D.createRange()
      range.selectNodeContents(el)
      const sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      try {
        el.select()
      } catch {
        el.setSelectionRange && el.setSelectionRange(0, el.value.length)
      }
    }
    return describe(el)
  }

  function selectOption(target, values) {
    let el = resolve(target)
    if (el.tagName !== 'SELECT') el = el.querySelector('select') || el
    if (el.tagName !== 'SELECT') throw new Error(describe(el) + ' is not a <select>. For a custom dropdown, click it, then click the option.')
    const options = [...el.options]
    const chosen = values.map((v) => {
      const want = String(v).trim()
      const o = options.find((o) => o.value === want) || options.find((o) => norm(o.label).toLowerCase() === want.toLowerCase()) || options.find((o) => norm(o.label).toLowerCase().includes(want.toLowerCase()))
      if (!o) throw new Error('No option ' + q(want) + '. Options: ' + options.slice(0, 20).map((o) => q(norm(o.label))).join(', '))
      return o
    })
    if (!el.multiple && chosen.length > 1) throw new Error('This select takes one value.')
    for (const o of options) o.selected = chosen.includes(o)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return chosen.map((o) => norm(o.label))
  }

  function quiet(idle, max) {
    return new Promise((done) => {
      let timer = 0
      const finish = () => {
        observer.disconnect()
        clearTimeout(timer)
        clearTimeout(cap)
        done(true)
      }
      const observer = new MutationObserver(() => {
        clearTimeout(timer)
        timer = setTimeout(finish, idle)
      })
      observer.observe(D.documentElement, { subtree: true, childList: true, characterData: true })
      timer = setTimeout(finish, idle)
      const cap = setTimeout(finish, max)
    })
  }

  // ---------- agent cursor & picker overlay ----------
  let host = null
  let ui = null
  let hideTimer = 0
  const css = (el, style) => Object.assign(el.style, style)
  const ensureOverlay = () => {
    if (host && host.isConnected) return ui
    // A custom tag, so page code querying "div" never trips over the overlay.
    host = D.createElement('hiveory-overlay')
    host.setAttribute(OVERLAY, '')
    css(host, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647', contain: 'strict' })
    const root = host.attachShadow({ mode: 'closed' })
    const cursor = D.createElement('div')
    css(cursor, { position: 'absolute', left: '0', top: '0', opacity: '0', transform: 'translate(' + innerWidth / 2 + 'px,' + innerHeight / 2 + 'px)', willChange: 'transform', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.45))' })
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-6.9 1.6L9 20.5z" fill="#0b0b0c" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    const label = D.createElement('span')
    css(label, { position: 'absolute', left: '20px', top: '20px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(12,12,13,.92)', color: '#f2f2f2', font: '500 11px/16px system-ui,-apple-system,Segoe UI,sans-serif', whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,.18)' })
    cursor.appendChild(label)
    const box = D.createElement('div')
    css(box, { position: 'absolute', display: 'none', border: '2px solid #8ab4ff', background: 'rgba(138,180,255,.14)', borderRadius: '3px', boxSizing: 'border-box' })
    const tip = D.createElement('span')
    css(tip, { position: 'absolute', left: '-2px', bottom: '100%', marginBottom: '4px', padding: '2px 6px', borderRadius: '4px', background: '#0b0b0c', color: '#e8e8e8', font: '500 11px/16px system-ui,-apple-system,Segoe UI,sans-serif', whiteSpace: 'nowrap' })
    box.appendChild(tip)
    root.append(box, cursor)
    D.documentElement.appendChild(host)
    ui = { root, cursor, label, box, tip }
    return ui
  }

  function cursorTo(x, y, text, ms) {
    const { cursor, label } = ensureOverlay()
    cursor.style.transition = 'transform ' + ms + 'ms cubic-bezier(.22,.8,.3,1), opacity 160ms'
    cursor.style.opacity = '1'
    cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    label.textContent = text || ''
    label.style.display = text ? '' : 'none'
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => (cursor.style.opacity = '0'), 6000)
    return true
  }

  function ripple(x, y) {
    const { root } = ensureOverlay()
    const dot = D.createElement('div')
    css(dot, { position: 'absolute', left: x - 14 + 'px', top: y - 14 + 'px', width: '28px', height: '28px', borderRadius: '50%', border: '2px solid #8ab4ff', boxSizing: 'border-box' })
    root.appendChild(dot)
    dot.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.4)', opacity: 0 }], { duration: 420, easing: 'ease-out' }).onfinish = () => dot.remove()
    return true
  }

  const cssPath = (el) => {
    if (el.id && D.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id)
    const parts = []
    for (let n = el; n && n.nodeType === 1 && n !== D.documentElement && parts.length < 8; n = n.parentElement) {
      let part = n.tagName.toLowerCase()
      if (n.id) {
        parts.unshift(part + '#' + CSS.escape(n.id))
        break
      }
      const parent = n.parentElement
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === n.tagName)
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'
      }
      parts.unshift(part)
      const path = parts.join(' > ')
      try {
        if (D.querySelectorAll(path).length === 1) return path
      } catch {}
    }
    return parts.join(' > ')
  }

  const info = (el) => {
    const role = roleOf(el)
    return {
      ref: '@' + refOf(el),
      role: role || el.tagName.toLowerCase(),
      name: cut(role ? nameOf(el, role) : '', 160),
      selector: cssPath(el),
      text: cut(textOf(el), 400),
      html: cut(el.outerHTML.replace(/\s+/g, ' '), 1500)
    }
  }

  let cancelPick = null
  function pick() {
    if (cancelPick) cancelPick()
    const { box, tip } = ensureOverlay()
    return new Promise((done) => {
      let current = null
      const target = (e) => {
        const t = e.composedPath ? e.composedPath()[0] : e.target
        return t && t.nodeType === 1 && !(t.hasAttribute && t.hasAttribute(OVERLAY)) ? t : null
      }
      const move = (e) => {
        const el = target(e)
        if (!el || el === current) return
        current = el
        const r = absRect(el)
        css(box, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' })
        tip.textContent = describe(el)
      }
      const block = (e) => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      const click = (e) => {
        block(e)
        const el = target(e) || current
        finish(el ? info(el) : null)
      }
      const key = (e) => {
        if (e.key === 'Escape') {
          block(e)
          finish(null)
        }
      }
      const events = [['mousemove', move], ['pointerdown', block], ['mousedown', block], ['pointerup', block], ['mouseup', block], ['click', click], ['keydown', key]]
      const finish = (value) => {
        for (const [name, fn] of events) window.removeEventListener(name, fn, true)
        box.style.display = 'none'
        cancelPick = null
        done(value)
      }
      cancelPick = () => finish(null)
      for (const [name, fn] of events) window.addEventListener(name, fn, true)
    })
  }

  function rect(target) {
    const el = resolve(target)
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    return absRect(el)
  }

  return {
    snapshot,
    point,
    focusEditable,
    selectOption,
    quiet,
    cursorTo,
    ripple,
    pick,
    cancelPick: () => (cancelPick ? (cancelPick(), true) : false),
    rect,
    links: () => [...new Set([...D.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/.test(h)))],
    describe: (target) => describe(resolve(target)),
    hasText: (text) => norm(D.body ? D.body.innerText : '').toLowerCase().includes(norm(text).toLowerCase()),
    count: (selector) => deepQueryAll(selector).filter(visible).length,
    scroll: () => ({ x: Math.round(scrollX), y: Math.round(scrollY), w: innerWidth, h: innerHeight })
  }
})()`

/** Wraps one call into the page script; failures come back as `{ ok: false, error }` instead of a rejected script. */
export const pageCall = (expression: string): string =>
  `(async () => { try { const hv = (globalThis.__hv ??= ${PAGE_SCRIPT}); return { ok: true, value: await hv.${expression} } } catch (e) { return { ok: false, error: String(e && e.message || e) } } })()`
