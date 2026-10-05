import type { QueenContext } from './actions'

/**
 * The vocabulary of Queen Bee's rule parser: numbers, Hinglish and multi-word
 * phrasings folded into canonical words, filler, verbs and CLI aliases. Shared by
 * the clause parser (parse.ts) and the addressing rules (address.ts).
 */

export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, couple: 2, pair: 2, few: 3, single: 1, another: 1,
  // Hinglish, as speech recognition writes it.
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, aat: 8
}

/**
 * Hinglish (romanised Hindi, as typed or as Whisper writes it) folded into the
 * same canonical words. Hindi puts the verb last ("do codex kholo"); parseClause
 * moves a trailing verb to the front.
 */
export const HINGLISH: Array<[RegExp, string]> = [
  [/\b(kya chal raha hai|kya ho raha hai|status batao|kya bacha hai|kitna bacha hai|update do)\b/g, 'status'],
  [/\b(kaun wait kar raha hai|kaun ruka hai|kisko meri zarurat hai|kaun atka hai)\b/g, 'who is waiting'],
  [/\b(restart karo|restart kar do|dobara chalao|phir se chalao)\b/g, 'restart'],
  [/\b(rok do|rok de|roko|ruko)\b/g, 'stop'],
  [/\b(khol do|khol de|kholo|kolo|khol|chalu karo|chalu kar do|chalao|start karo|shuru karo)\b/g, 'open'],
  [/\b(band karo|band kar do|band kardo|bandh karo|bund karo|hata do|hatao|band)\b/g, 'close'],
  [/\b(dikhao|dikha do|dikhau|dekhao|par jao|pe jao|jao)\b/g, 'show'],
  [/\baur\b/g, 'and'],
  [/\b(ko|zara|jaldi|bhai|yaar|na)\b/g, ' ']
]

/** Multi-word phrasings folded into one canonical verb before parsing. */
export const PHRASES: Array<[RegExp, string]> = [
  ...HINGLISH,
  [/\b(take me to|bring me to|navigate to|head to|jump to|switch to|move to|go back to|go to)\b/g, 'go'],
  [/\b(spin up|fire up|boot up|bring up|start up|kick off)\b/g, 'open'],
  [/\b(shut down|close down|get rid of)\b/g, 'close'],
  [/\b(show me|let me see)\b/g, 'show'],
  [/\bside ?bar on the right\b|\bright (side ?bar|side ?panel|panel)\b/g, 'side panel'],
  [/\bfile (tree|explorer)\b/g, 'explorer'],
  [/\b(\d+)\s*x\b|\bx\s*(\d+)\b/g, '$1$2']
]

/** Words that carry no meaning for a command. */
export const FILLER = /^(hey |hi |ok |okay )?(queen bee|queen|ada|sunny|frankie)\b|\b(please|pls|plz|can you|could you|would you|will you|kindly|hey|hi|ok|okay|for me|right now|now|quickly|just|the|new|some|my|i want|i need|id like|lets)\b/g

/** Closing ends the agent (always after a yes). "stop" is not one: it interrupts. */
export const CLOSE_VERBS = /^(close|kill|remove|end|quit|terminate|dismiss)\b/
/** Stops what an agent is doing, without closing it. */
export const STOP_VERBS = /^(stop|interrupt|halt|pause|abort|escape|esc|cancel)\b/
export const RESTART_VERBS = /^(restart|reboot|rerun|reload)\b/
export const OPEN_VERBS = /^(open|start|launch|spawn|add|create|run|give|get)\b/
export const GO_VERBS = /^(go|show|open|focus|find|view|display|visit)\b/

export const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Splits "open two claude and a codex, then go to chat" into clauses. */
export const clauses = (text: string): string[] =>
  text
    .split(/\s*(?:[,;]|\band then\b|\bthen\b|\band\b|\balso\b|\bplus\b)\s*/)
    .map((c) => c.trim())
    .filter(Boolean)

export const hasWord = (text: string, word: string): boolean => new RegExp(`(^| )${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text)

/** Every way a user may name a CLI: "Claude Code" → claude code, claude, claudecode. */
export const cliAliases = (cli: QueenContext['clis'][number]): string[] => {
  const name = norm(cli.displayName)
  const short = name.replace(/ (code )?cli$| code$/, '')
  return [...new Set([norm(cli.id), name, short, short.replace(/ /g, '')])].filter(Boolean)
}

export const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Normalised, with phrasings folded and filler dropped: the form the clause parser reads. */
export const fold = (text: string): string => {
  let out = norm(text)
  for (const [re, to] of PHRASES) out = out.replace(re, to)
  return out.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
}
