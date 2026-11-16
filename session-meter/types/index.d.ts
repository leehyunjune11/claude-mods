export type SessionMeterLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type SessionMeterSnapshot = {
  /** $.session.usage().startedAt: when the figures count from */
  startedAt?: number
  usd?: number
  ctxPct?: number
  limits: SessionMeterLimit[]
  /** $.clock.now() of the last session.measure */
  lastAt?: number
  now: number
}

/** usd per local date, 'YYYY-MM-DD' */
export type SessionMeterDays = Record<string, number>

/** This session's running bill; what `s:<id>` in the store holds, plus the id. */
export type SessionMeterLedger = { id: string; lastCost: number; days: SessionMeterDays }

export type SessionMeterTotals = {
  /** Every other session's stored days. */
  others: SessionMeterDays
  /** Estimated from transcripts by /meter backfill. */
  backfill: SessionMeterDays
  /** The first date the transcripts cover. */
  dataStart?: string
}

export type SessionMeterTaxi = {
  mode: 'idle' | 'drive' | 'arrive'
  /** At the gas station: compacting. */
  gas: boolean
  /** The session's cost when this turn began. */
  tripStart: number
  /** $.clock.now() of the last turn end */
  since: number
  /** Background tasks in flight as of the last main-turn end. */
  bg: number
  /** Subagents and workflows in flight as of the last main-turn end; they keep the taxi driving. */
  agents: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-meter': {
      snap: Shaped<SessionMeterSnapshot>
      ledger: Shaped<SessionMeterLedger>
      totals: Shaped<SessionMeterTotals>
      taxi: Shaped<SessionMeterTaxi>
      /** The taxi drawn in the band; /taxi flips it, $.store keeps it. */
      taxiOn: Shaped<boolean>
    }
  }
}
