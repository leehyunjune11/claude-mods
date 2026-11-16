import type { Quest } from '../types'

// ponytail: KST 고정(+9h). 다른 시간대에서 쓰게 되면 TZ 를 받아 계산
export const todayOf = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10)

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400e3)

// 마감 표시: 지남 / 오늘 / D-n
export function dueLabel(due: string | undefined, today: string) {
  if (!due) return undefined
  const n = dayDiff(today, due)
  return n < 0 ? '지남' : n === 0 ? '오늘' : `D-${n}`
}

// 완료한 날이 오늘 이전이면 숨김. doneAt 없는 옛 항목은 파일 날짜로 본다
export const visibleTasks = (tasks: Quest[], fileDate: string | undefined, today: string) =>
  tasks.filter(t => !t.done || (t.doneAt ?? fileDate ?? today) >= today)

// "제목 11/20" 또는 "제목 2026-11-20" → 마감 분리. 지난 월/일이면 내년으로
export function parseTitle(input: string, today: string): { t: string; due?: string } {
  const s = input.trim()
  const iso = s.match(/^(.*\S)\s+(\d{4}-\d{2}-\d{2})$/)
  if (iso) return { t: iso[1]!, due: iso[2]! }
  const md = s.match(/^(.*\S)\s+(\d{1,2})\/(\d{1,2})$/)
  if (!md) return { t: s }
  const pad = (v: string) => v.padStart(2, '0')
  const year = Number(today.slice(0, 4))
  let due = `${year}-${pad(md[2]!)}-${pad(md[3]!)}`
  if (due < today) due = `${year + 1}-${pad(md[2]!)}-${pad(md[3]!)}`
  return { t: md[1]!, due }
}
