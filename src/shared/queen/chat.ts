import { norm } from './words'
import { address, effective, finish, type QueenPrefs } from './personas'

/**
 * Small talk (ADR 0019): greetings, thanks, "how are you", "who are you". Queen
 * Bee answers these herself, in her personality, with no model and no action.
 * Only a whole sentence of small talk counts: "hi, open codex" is a command.
 */
export type SmallTalk = 'greet' | 'how-are-you' | 'thanks' | 'who' | 'bye' | 'praise' | 'sorry' | 'ack'

const CALL = String.raw`(?: (?:queen bee|queen|bee|ada|sunny|frankie|there|buddy|friend|yaar|bhai))?`
const TALK: Array<[SmallTalk, RegExp]> = [
  ['greet', new RegExp(String.raw`^(?:hi|hii+|hello|helo|hey|heya|hiya|yo|sup|hola|namaste|namaskar|salaam|howdy|greetings|good (?:morning|afternoon|evening|day)|whats up|wassup)${CALL}$`)],
  ['how-are-you', /^(?:(?:hi|hey|hello) )?(?:how are you(?: doing| today)?|how r u|how you doing|hows it going|how is it going|hows your day|how is your day|are you (?:ok|okay|there|awake)|you there|kaise ho|kaisi ho|kya haal hai|sab theek)(?: (?:queen bee|queen|ada|sunny|frankie))?$/],
  ['who', /^(?:who are you|what are you|whats your name|what is your name|your name|introduce yourself|tell me about yourself|what do you do|tum kaun ho|aap kaun ho)$/],
  ['thanks', new RegExp(String.raw`^(?:thanks|thank you|thank u|thx|ty|cheers|much appreciated|appreciate it|shukriya|dhanyavad|dhanyawad)(?: (?:so much|a lot|a ton))?${CALL}$`)],
  ['bye', new RegExp(String.raw`^(?:bye|bye bye|goodbye|good bye|see you|see ya|cya|later|good night|gn|alvida|chalo bye)${CALL}$`)],
  ['praise', new RegExp(String.raw`^(?:good job|well done|nice work|nice job|great job|great work|nice|great|awesome|amazing|perfect|brilliant|you rock|love you|you are (?:great|awesome|amazing|the best)|youre (?:great|awesome|amazing|the best)|shabash|badhiya|mast)${CALL}$`)],
  ['sorry', /^(?:sorry|my bad|oops|apologies|maaf karo|sorry yaar)$/],
  ['ack', /^(?:ok|okay|k|cool|got it|alright|all right|fine|sure|hmm+|acha|accha|theek hai|thik hai)$/]
]

export function parseSmallTalk(input: string): SmallTalk | null {
  const text = norm(input)
  return TALK.find(([, re]) => re.test(text))?.[0] ?? null
}

const partOfDay = (hour: number): string => (hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening')

/** Her answer, in her personality. `name` is hers (Ada, Sunny, Frankie or a custom name). */
export function smallTalkLine(topic: SmallTalk, prefs: QueenPrefs, name: string, now = new Date()): string {
  const p = effective(prefs)
  const you = p.callMe ? `, ${p.callMe}` : ''
  const lines: Record<SmallTalk, Record<typeof p.persona, string[]>> = {
    greet: {
      ada: [`Good ${partOfDay(now.getHours())}${address(p)}.`, 'How may I help?'],
      sunny: [`Hey${you}!`, 'Ready when you are. What are we building?'],
      frankie: [`Hi${you}.`, "What's the next move?"]
    },
    'how-are-you': {
      ada: [`Fully operational, thank you${address(p)}.`, 'What do you need?'],
      sunny: ['Buzzing and ready!', 'How about you? What are we working on?'],
      frankie: ['Running fine.', 'Your agents matter more. Ask me “what’s left?”']
    },
    who: {
      ada: [`I am ${name}, Hiveory's operator${address(p)}.`, 'I open, close and find your agents, report their status and move you around the app. Say “help” for examples.'],
      sunny: [`I'm ${name}, the queen of this hive!`, 'I run your agents, tell you who needs you and take you anywhere in the app. Say “help” to see more.'],
      frankie: [`${name}. I run this hive.`, 'Agents, status, navigation. Say “help” for the list.']
    },
    thanks: {
      ada: [`You are welcome${address(p)}.`],
      sunny: ['Anytime!', 'That’s what queens are for.'],
      frankie: ['Sure.', "What's next?"]
    },
    bye: {
      ada: [`Goodbye${address(p)}.`, 'Your agents keep running.'],
      sunny: ['See you soon!', "I'll keep an eye on the hive."],
      frankie: ['Later.', 'The agents keep working without you.']
    },
    praise: {
      ada: [`Thank you${address(p)}.`],
      sunny: ['Aww, thank you!', 'Teamwork makes the hive work.'],
      frankie: ['Noted.', 'Keep the agents busy and it stays that way.']
    },
    sorry: {
      ada: [`No apology needed${address(p)}.`],
      sunny: ['All good, no worries!'],
      frankie: ['No problem.', 'Moving on.']
    },
    ack: {
      ada: [`Very well${address(p)}.`],
      sunny: ['Great!'],
      frankie: ['Good.']
    }
  }
  return finish(lines[topic][p.persona], p)
}
