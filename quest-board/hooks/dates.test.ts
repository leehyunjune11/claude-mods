import { expect, test } from 'claude-code/testing'

import { dueLabel, parseTitle, todayOf, visibleTasks } from './dates'

test('마감 라벨·완료 숨김·제목 파싱', async () => {
  expect(todayOf(Date.parse('2026-11-16T15:30:00Z'))).toBe('2026-11-17') // KST 자정 넘김
  expect(dueLabel('2026-11-15', '2026-11-16')).toBe('지남')
  expect(dueLabel('2026-11-16', '2026-11-16')).toBe('오늘')
  expect(dueLabel('2026-11-19', '2026-11-16')).toBe('D-3')
  expect(dueLabel(undefined, '2026-11-16')).toBe(undefined)

  const ts = [
    { id: 'a', sec: '메인', t: 'A', done: true, doneAt: '2026-11-16' },
    { id: 'b', sec: '메인', t: 'B', done: true, doneAt: '2026-11-17' },
    { id: 'c', sec: '메인', t: 'C' },
    { id: 'd', sec: '완료', t: 'D', done: true },
  ]
  expect(visibleTasks(ts, '2026-11-16', '2026-11-17').map(t => t.id)).toEqual(['b', 'c'])
  expect(visibleTasks(ts, '2026-11-16', '2026-11-16').map(t => t.id)).toEqual(['a', 'b', 'c', 'd'])

  expect(parseTitle('견적서 회신 11/20', '2026-11-16')).toEqual({ t: '견적서 회신', due: '2026-11-20' })
  expect(parseTitle('연초 보고 1/5', '2026-11-16')).toEqual({ t: '연초 보고', due: '2027-01-05' })
  expect(parseTitle('계약 2026-12-01', '2026-11-16')).toEqual({ t: '계약', due: '2026-12-01' })
  expect(parseTitle('그냥 제목', '2026-11-16')).toEqual({ t: '그냥 제목' })
})
