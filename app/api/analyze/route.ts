import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { refreshIfNeeded } from '@/lib/tokenStore'
import { getSystemPrompt } from '@/lib/systemPrompts'
import type { AnalyzePayload } from '@/lib/types'

function getOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert plain text / markdown to Atlassian Document Format (ADF) */
function textToADF(text: string) {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean)
  return {
    version: 1,
    type: 'doc',
    content: paragraphs.map(para => ({
      type: 'paragraph',
      content: [{ type: 'text', text: para.replace(/\n/g, ' ') }],
    })),
  }
}

/** Strip markdown code fences if the model wrapped the JSON anyway */
function extractJSON(raw: string): string {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return match ? match[1].trim() : raw.trim()
}

/** Map priority int (1-5) to Jira priority name */
function priorityName(p: number): string {
  const map: Record<number, string> = {
    1: 'Highest',
    2: 'High',
    3: 'Medium',
    4: 'Low',
    5: 'Lowest',
  }
  return map[p] ?? 'Medium'
}

// ── OpenAI call with 1 retry on bad JSON ─────────────────────────────────────
async function callOpenAI(department: string, transcript: string): Promise<Record<string, unknown>> {
  const systemPrompt = getSystemPrompt(department)

  async function attempt(): Promise<Record<string, unknown>> {
    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Meeting transcript:\n\n${transcript}` },
      ],
    })

    const raw = completion.choices[0].message.content ?? ''
    return JSON.parse(extractJSON(raw))
  }

  try {
    return await attempt()
  } catch (firstErr) {
    // Surface the real error (auth failure, quota, network, etc.) instead of masking it
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr)
    console.warn('[analyze] First attempt failed:', msg)

    // Only retry on JSON parse errors — not on API/auth errors
    if (!msg.includes('JSON') && !msg.includes('parse') && !msg.includes('Unexpected')) {
      throw firstErr
    }

    try {
      return await attempt()
    } catch (secondErr) {
      console.error('[analyze] Second attempt failed:', secondErr)
      throw new Error('OpenAI returned invalid JSON after 2 attempts')
    }
  }
}

// ── Create a single Jira issue ────────────────────────────────────────────────
interface BacklogItem {
  issue_type?: string
  summary?: string
  description_markdown?: string
  priority?: number
  labels?: string[]
  acceptance_criteria?: string
  [key: string]: unknown
}

async function createJiraIssue(
  baseUrl: string,
  accessToken: string,
  projectKey: string,
  item: BacklogItem
): Promise<string> {
  const summary = (item.summary ?? 'Issue sin título').substring(0, 255)
  const issueType = item.issue_type === 'Story' ? 'Story' : 'Task'
  const priority = priorityName(Number(item.priority) || 3)
  const labels = Array.isArray(item.labels) ? item.labels.map(String) : []

  const descriptionText = [
    item.description_markdown ?? '',
    item.acceptance_criteria ? `\n\nAcceptance Criteria:\n${item.acceptance_criteria}` : '',
  ]
    .join('')
    .trim()

  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      description: textToADF(descriptionText || summary),
      issuetype: { name: issueType },
      priority: { name: priority },
      labels,
    },
  }

  const res = await fetch(`${baseUrl}/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Jira ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.key as string
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── Auth check ──────────────────────────────────────────────────────────
  const sessionId = req.cookies.get('jira_session')?.value
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'No Jira session — please reconnect' }, { status: 401 })
  }

  const session = await refreshIfNeeded(sessionId)
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Jira session expired — please reconnect' },
      { status: 401 }
    )
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let payload: AnalyzePayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const { transcript, department, projectKey } = payload

  if (!transcript || transcript.trim().length < 50) {
    return NextResponse.json(
      { ok: false, error: 'La transcripción debe tener al menos 50 caracteres' },
      { status: 400 }
    )
  }

  if (!projectKey) {
    return NextResponse.json({ ok: false, error: 'projectKey es requerido' }, { status: 400 })
  }

  console.log(`[analyze] dept=${department} project=${projectKey} transcript_len=${transcript.length}`)

  // ── OpenAI analysis ───────────────────────────────────────────────────────
  let analysis: Record<string, unknown>
  try {
    analysis = await callOpenAI(department, transcript)
    console.log('[analyze] OpenAI analysis complete')
  } catch (err) {
    console.error('[analyze] OpenAI error:', err)
    return NextResponse.json(
      { ok: false, error: `Error al analizar con IA: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  // ── Create Jira issues ────────────────────────────────────────────────────
  const backlog = Array.isArray(analysis.jira_backlog)
    ? (analysis.jira_backlog as BacklogItem[])
    : []

  const issueKeys: string[] = []
  const failedIssues: string[] = []

  for (const item of backlog) {
    try {
      const key = await createJiraIssue(
        session.jiraBaseUrl,
        session.accessToken,
        projectKey,
        item
      )
      issueKeys.push(key)
      console.log(`[analyze] Created issue ${key}`)
    } catch (err) {
      const summary = item.summary ?? 'Unknown'
      console.error(`[analyze] Failed to create issue "${summary}":`, err)
      failedIssues.push(summary.substring(0, 80))
    }
  }

  return NextResponse.json({
    ok: true,
    analysis,
    issue_keys: issueKeys,
    created_issues_count: issueKeys.length,
    failed_issues: failedIssues,
    jira_browse_url: `${session.cloudUrl}/browse/`,
  })
}
