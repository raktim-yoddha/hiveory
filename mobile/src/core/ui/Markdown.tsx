import { memo, useMemo, type ReactNode } from 'react'
import { Linking, ScrollView, StyleSheet, View, type TextStyle } from 'react-native'
import { marked, type Token, type Tokens } from 'marked'
import { font, radius, space, useTheme, type Palette } from '../theme'
import { Text } from './Text'

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
const decode = (text: string): string => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)

/** Only web links open, in the system browser. */
const open = (href: string): void => {
  if (/^https?:\/\//i.test(href)) void Linking.openURL(href)
}

/** Inline runs (bold, italic, code, links) as nested Text, so they wrap like one paragraph. */
function inline(tokens: Token[] | undefined, colors: Palette): ReactNode[] {
  return (tokens ?? []).map((t, i) => {
    switch (t.type) {
      case 'strong':
        return <Text key={i} style={styles.strong}>{inline((t as Tokens.Strong).tokens, colors)}</Text>
      case 'em':
        return <Text key={i} style={styles.em}>{inline((t as Tokens.Em).tokens, colors)}</Text>
      case 'del':
        return <Text key={i} style={styles.del}>{inline((t as Tokens.Del).tokens, colors)}</Text>
      case 'codespan':
        return <Text key={i} style={[styles.codespan, { backgroundColor: colors.surfaceRaised }]}>{decode((t as Tokens.Codespan).text)}</Text>
      case 'link': {
        const link = t as Tokens.Link
        return (
          <Text key={i} tone="accent" style={styles.link} accessibilityRole="link" onPress={() => open(link.href)}>
            {inline(link.tokens, colors)}
          </Text>
        )
      }
      case 'br':
        return '\n'
      case 'text': {
        const text = t as Tokens.Text
        return text.tokens ? <Text key={i}>{inline(text.tokens, colors)}</Text> : decode(text.text)
      }
      default:
        return 'text' in t ? decode(String(t.text)) : null
    }
  })
}

function Block({ token, colors }: { token: Token; colors: Palette }): ReactNode {
  switch (token.type) {
    case 'space':
    case 'hr':
      return token.type === 'hr' ? <View style={[styles.hr, { backgroundColor: colors.border }]} /> : null
    case 'heading': {
      const h = token as Tokens.Heading
      return (
        <Text selectable accessibilityRole="header" style={HEADING[Math.min(h.depth, 3) - 1]}>
          {inline(h.tokens, colors)}
        </Text>
      )
    }
    case 'paragraph':
      return <Text selectable>{inline((token as Tokens.Paragraph).tokens, colors)}</Text>
    case 'text': {
      const t = token as Tokens.Text
      return <Text selectable>{t.tokens ? inline(t.tokens, colors) : decode(t.text)}</Text>
    }
    case 'code':
      return (
        <ScrollView horizontal style={[styles.code, { backgroundColor: colors.surfaceInset, borderColor: colors.border }]} contentContainerStyle={styles.codeInner}>
          <Text selectable variant="mono">
            {(token as Tokens.Code).text}
          </Text>
        </ScrollView>
      )
    case 'blockquote':
      return (
        <View style={[styles.quote, { borderLeftColor: colors.borderStrong }]}>
          <Blocks tokens={(token as Tokens.Blockquote).tokens} colors={colors} />
        </View>
      )
    case 'list': {
      const list = token as Tokens.List
      const start = typeof list.start === 'number' ? list.start : 1
      return (
        <View style={styles.list}>
          {list.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text tone="muted" style={styles.bullet}>
                {item.task ? (item.checked ? '☑' : '☐') : list.ordered ? `${start + i}.` : '•'}
              </Text>
              <View style={styles.itemBody}>
                <Blocks tokens={item.tokens} colors={colors} />
              </View>
            </View>
          ))}
        </View>
      )
    }
    case 'table': {
      const table = token as Tokens.Table
      const row = (cells: Tokens.TableCell[], head: boolean, key: number) => (
        <View key={key} style={[styles.tr, { borderColor: colors.border }]}>
          {cells.map((cell, i) => (
            <Text key={i} selectable style={[styles.td, head && styles.strong]}>
              {inline(cell.tokens, colors)}
            </Text>
          ))}
        </View>
      )
      return (
        <ScrollView horizontal>
          <View style={[styles.table, { borderColor: colors.border }]}>
            {row(table.header, true, -1)}
            {table.rows.map((r, i) => row(r, false, i))}
          </View>
        </ScrollView>
      )
    }
    default:
      return 'text' in token && token.text ? <Text selectable>{decode(String(token.text))}</Text> : null
  }
}

function Blocks({ tokens, colors }: { tokens: Token[]; colors: Palette }) {
  return (
    <View style={styles.blocks}>
      {tokens.map((t, i) => (
        <Block key={i} token={t} colors={colors} />
      ))}
    </View>
  )
}

/**
 * An agent's markdown as native text: the same GFM parser the computer uses (marked), drawn with
 * the phone's type scale. No HTML is ever run; raw HTML shows as its text.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const { colors } = useTheme()
  const tokens = useMemo(() => marked.lexer(text, { gfm: true, breaks: true }), [text])
  return <Blocks tokens={tokens} colors={colors} />
})

const HEADING: TextStyle[] = [
  { fontSize: font.size.title, fontWeight: font.weight.semibold },
  { fontSize: font.size.lead, fontWeight: font.weight.semibold },
  { fontSize: font.size.body, fontWeight: font.weight.semibold }
]

const styles = StyleSheet.create({
  blocks: { gap: space[4] },
  strong: { fontWeight: font.weight.bold },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  codespan: { fontFamily: font.mono, fontSize: font.size.label },
  code: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, flexGrow: 0 },
  codeInner: { padding: space[5] },
  quote: { borderLeftWidth: 3, paddingLeft: space[5] },
  list: { gap: space[2] },
  item: { flexDirection: 'row', gap: space[3] },
  bullet: { minWidth: 16 },
  itemBody: { flex: 1 },
  hr: { height: StyleSheet.hairlineWidth },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  td: { minWidth: 96, maxWidth: 240, padding: space[4] }
})
