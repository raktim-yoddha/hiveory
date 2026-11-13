import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Check } from 'lucide-react-native'
import type { ChatPrompt, ChatPromptAnswer, ChatQuestion } from '@shared/domain/chat'
import { useAction, useCall } from '@/core/api'
import { radius, space, useTheme } from '@/core/theme'
import { Button, Markdown, Text, TextField } from '@/core/ui'

/** A question's answer: the chosen labels, or the user's own words. */
const answerOf = (picked: string[], own: string): string => own.trim() || picked.join(', ')

/**
 * The card a chat-view agent's reply waits on, as on the computer (ADR 0073): allow or deny a tool,
 * answer its questions, or approve its plan. One at a time, oldest first.
 */
export function PromptCard({ chatId }: { chatId: string }) {
  const chat = useCall('chat.get', { chatId })
  const prompts = chat.data?.prompts ?? []
  const prompt = prompts[0]
  if (!prompt) return null
  return <PromptBody key={prompt.id} chatId={chatId} prompt={prompt} more={prompts.length - 1} />
}

function PromptBody({ chatId, prompt, more }: { chatId: string; prompt: ChatPrompt; more: number }) {
  const { colors } = useTheme()
  const answer = useAction('chat.answer')
  const send = (reply: ChatPromptAnswer): void => answer.mutate({ chatId, promptId: prompt.id, answer: reply })
  const busy = answer.isPending
  const title = prompt.kind === 'permission' ? `${prompt.tool} needs your permission` : prompt.kind === 'plan' ? 'Plan' : (prompt.questions[0]?.question ?? 'Question')

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong }]} accessibilityLabel="The agent is waiting for you">
      <View style={styles.header}>
        <Text variant="label" style={styles.title}>
          {title}
        </Text>
        {more > 0 ? (
          <Text variant="caption" tone="secondary">
            1 of {more + 1}
          </Text>
        ) : null}
      </View>
      {prompt.kind === 'permission' ? (
        <>
          {prompt.detail ? (
            <Text variant="caption" style={[styles.code, { backgroundColor: colors.surfaceInset }]} numberOfLines={6}>
              {prompt.detail}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button label="Deny" size="sm" disabled={busy} onPress={() => send({ kind: 'permission', allow: false })} />
            <Button label="Allow" size="sm" variant="primary" loading={busy} onPress={() => send({ kind: 'permission', allow: true })} />
          </View>
        </>
      ) : null}
      {prompt.kind === 'plan' ? <PlanAnswer plan={prompt.plan} busy={busy} send={send} /> : null}
      {prompt.kind === 'question' ? <QuestionsAnswer questions={prompt.questions} busy={busy} send={send} /> : null}
    </View>
  )
}

function PlanAnswer({ plan, busy, send }: { plan: string; busy: boolean; send: (reply: ChatPromptAnswer) => void }) {
  const [feedback, setFeedback] = useState('')
  return (
    <>
      <ScrollView style={styles.plan} nestedScrollEnabled>
        <Markdown text={plan || 'The agent finished planning.'} />
      </ScrollView>
      <TextField placeholder="What should change?" value={feedback} onChangeText={setFeedback} />
      <View style={styles.actions}>
        <Button label="Keep planning" size="sm" disabled={busy} onPress={() => send({ kind: 'plan', approve: false, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) })} />
        <Button label="Approve" size="sm" variant="primary" loading={busy} onPress={() => send({ kind: 'plan', approve: true })} />
      </View>
    </>
  )
}

function QuestionsAnswer({ questions, busy, send }: { questions: ChatQuestion[]; busy: boolean; send: (reply: ChatPromptAnswer) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [own, setOwn] = useState<Record<string, string>>({})
  const ready = questions.length > 0 && questions.every((q) => answerOf(picked[q.question] ?? [], own[q.question] ?? ''))
  const toggle = (q: ChatQuestion, label: string): void =>
    setPicked((current) => {
      const now = current[q.question] ?? []
      return { ...current, [q.question]: q.multiSelect ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label] }
    })
  return (
    <>
      {questions.map((q, i) => (
        <View key={q.question} style={styles.question}>
          {i > 0 ? <Text variant="body">{q.question}</Text> : null}
          <View style={styles.options}>
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label)
              return (
                <Button
                  key={o.label}
                  label={o.label}
                  size="sm"
                  variant={on ? 'primary' : 'secondary'}
                  accessibilityState={{ selected: on }}
                  icon={on ? Check : undefined}
                  onPress={() => toggle(q, o.label)}
                />
              )
            })}
          </View>
          <TextField
            placeholder={q.options.length ? 'Something else' : 'Your answer'}
            value={own[q.question] ?? ''}
            onChangeText={(value) => setOwn((current) => ({ ...current, [q.question]: value }))}
          />
        </View>
      ))}
      <View style={styles.actions}>
        <Button
          label="Answer"
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!ready}
          onPress={() => send({ kind: 'question', answers: Object.fromEntries(questions.map((q) => [q.question, answerOf(picked[q.question] ?? [], own[q.question] ?? '')])) })}
        />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  card: { gap: space[5], marginHorizontal: space[5], marginBottom: space[4], padding: space[6], borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  title: { flex: 1 },
  code: { padding: space[4], borderRadius: radius.sm, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[4] },
  plan: { maxHeight: 220 },
  question: { gap: space[4] },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }
})
