import { get, writable } from 'svelte/store'
import { mergeSidecars, sanitizeAnalysis, summariseAnalysisImport } from '../core/analysis'
import { buildReport } from '../core/model'
import { analysis, lastImportReport, library } from '../stores'

/**
 * Client for the localhost analysis helper — `analyse-audio.py --serve`. The
 * app posts a playlist's file paths, polls the job, and merges the finished
 * sidecar exactly the way a sidecar import through the Import button does.
 *
 * Nothing contacts localhost until the user presses Connect: most people have
 * no helper, and a request to 127.0.0.1 can raise a browser permission prompt
 * (Chrome's local-network access) nobody asked for.
 *
 * ponytail: the port is a const; lift it into AppSettings on the first real
 * port conflict (the script side already takes --port).
 */
const HELPER_URL = 'http://127.0.0.1:8765'

export interface HelperJob {
  state: 'running' | 'done' | 'failed'
  done: number
  total: number
  rate: number
  etaSec: number | null
  errors: number
  startedAt: string
}

/** 'offline' = no helper answered; null = helper up, no job yet. */
export const helperJob = writable<HelperJob | 'offline' | null>('offline')
/** True once a Connect found a helper, until it stops answering. */
export const helperConnected = writable(false)

let panelOpen = false
let timer: ReturnType<typeof setInterval> | null = null
// A helper busy analysing can miss the 800 ms status deadline now and then;
// only this many misses in a row mean it is gone.
const MAX_MISSES = 3
let misses = 0
// One result fetch per finished job: /status keeps reporting 'done' forever.
let fetchedFor: string | null = null

/**
 * The Advanced section drives this on open/toggle. Polling runs while the
 * section is open OR a job is running — a run started and then closed keeps
 * polling, so its result still lands without the panel.
 */
export function setPanelOpen(open: boolean): void {
  panelOpen = open
  if (open && get(helperConnected)) {
    void refresh()
    ensureTimer()
  }
}

/** Ask the helper whether it is there (the Connect button). */
export async function connectHelper(): Promise<boolean> {
  await refresh()
  const connected = get(helperJob) !== 'offline'
  helperConnected.set(connected)
  if (connected) ensureTimer()
  return connected
}

export async function startAnalysis(paths: string[], writeTags: boolean): Promise<string | null> {
  try {
    const res = await fetch(`${HELPER_URL}/analyse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths, writeTags }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      return data?.error ?? `helper answered ${res.status}`
    }
    void refresh()
    ensureTimer()
    return null
  } catch {
    helperJob.set('offline')
    return 'the helper is not running'
  }
}

async function refresh(): Promise<void> {
  try {
    const res = await fetch(`${HELPER_URL}/status`, { signal: AbortSignal.timeout(800) })
    const data = (await res.json()) as { job: HelperJob | null }
    misses = 0
    helperJob.set(data.job)
    // Marked fetched only once it merged: a failed download is retried.
    if (data.job?.state === 'done' && fetchedFor !== data.job.startedAt) {
      if (await fetchResult()) fetchedFor = data.job.startedAt
    }
  } catch {
    if (get(helperConnected) && ++misses < MAX_MISSES) return
    misses = 0
    helperJob.set('offline')
    helperConnected.set(false)
  }
}

function ensureTimer(): void {
  if (timer !== null) return
  timer = setInterval(() => {
    const job = get(helperJob)
    const running = typeof job === 'object' && job !== null && job.state === 'running'
    if (!panelOpen && !running) {
      clearInterval(timer!)
      timer = null
      return
    }
    void refresh()
  }, 2000)
}

/** The finished sidecar, through the same sanitize → summarise → merge path
 * as a sidecar chosen in the Import dialog (TopBar.svelte). */
async function fetchResult(): Promise<boolean> {
  const res = await fetch(`${HELPER_URL}/result`)
  if (!res.ok) return false
  const sidecar = sanitizeAnalysis((await res.json()) as unknown)
  if (sidecar === null) return false
  const summary = summariseAnalysisImport(get(library), sidecar)
  analysis.update((prev) => mergeSidecars(prev, sidecar))
  lastImportReport.set({ ...buildReport(get(library), []), notes: [summary.note] })
  return true
}

/**
 * ponytail: one measured rate — 2040 tracks in 122 min across 8 workers
 * (design-v34 §Verified) ≈ 16.7 tracks/min. Re-measure when the models or
 * the machine change; a helper-reported live rate can replace it then.
 */
export function estimateMinutes(trackCount: number): number {
  return Math.ceil(trackCount / 16.7)
}
