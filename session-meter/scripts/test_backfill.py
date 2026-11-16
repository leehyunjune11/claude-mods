#!/usr/bin/env python3
"""Self-check for backfill.py on synthetic transcripts. Run: python3 test_backfill.py"""
import json
import os
import subprocess
import sys
import tempfile
import time

os.environ['TZ'] = 'Asia/Seoul'
time.tzset()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backfill as b  # noqa: E402

T = '2026-11-04T00:00:00.000Z'
OPUS = 'claude-opus-5-5'  # 4 / 20 / .2 / 5 / 8


def row(mid, ts='2026-11-02T00:00:00.000Z', model=OPUS, **usage):
    return {'type': 'assistant', 'timestamp': ts, 'message': {'id': mid, 'model': model, 'usage': usage}}


def write(root, rel, rows):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')


def total(root, before=T, reverse=False):
    days, unpriced = b.estimate(b.scan(root, b.parse_ts(before), reverse))
    return days, unpriced


def close(a, b_):
    assert abs(a - b_) < 1e-9, (a, b_)


with tempfile.TemporaryDirectory() as d:
    # Copies of one message in two files: per-field max, whichever file comes first.
    write(d, 'p/a.jsonl', [row('m1', input_tokens=1000, output_tokens=10)])
    write(d, 'p/s/subagents/b.jsonl', [row('m1', input_tokens=10, output_tokens=2000)])
    want = (1000 * 4 + 2000 * 20) / 1e6
    close(sum(total(d)[0].values()), want)
    close(sum(total(d, reverse=True)[0].values()), want)

with tempfile.TemporaryDirectory() as d:
    # The 1h split field has its own price; advisor iteration on its own model's price.
    write(d, 'p/a.jsonl', [row(
        'm1',
        input_tokens=100,
        cache_creation={'ephemeral_5m_input_tokens': 1000, 'ephemeral_1h_input_tokens': 2000},
        iterations=[
            {'type': 'advisor_message', 'model': 'claude-fable-5-1', 'input_tokens': 300, 'output_tokens': 40},
        ],
    )])
    want = (100 * 4 + 1000 * 5 + 2000 * 8 + 300 * 10 + 40 * 50) / 1e6
    close(sum(total(d)[0].values()), want)

# A real multi-iteration message: the top split holds the first iteration only, the top total the sum.
MULTI = dict(
    input_tokens=10,
    cache_creation_input_tokens=3368,
    cache_creation={'ephemeral_5m_input_tokens': 0, 'ephemeral_1h_input_tokens': 1661},
    iterations=[
        {'type': 'message', 'input_tokens': 4, 'cache_creation_input_tokens': 1661,
         'cache_creation': {'ephemeral_5m_input_tokens': 0, 'ephemeral_1h_input_tokens': 1661}},
        {'type': 'message', 'input_tokens': 6, 'cache_creation_input_tokens': 1707,
         'cache_creation': {'ephemeral_5m_input_tokens': 1707, 'ephemeral_1h_input_tokens': 0}},
        {'type': 'advisor_message', 'model': 'claude-fable-5-1', 'input_tokens': 300},
    ],
)
assert b.fields(MULTI)[3:] == [1707, 1661] and sum(b.fields(MULTI)[3:]) == MULTI['cache_creation_input_tokens']
multi_usd = (10 * 4 + 1707 * 5 + 1661 * 8 + 300 * 10) / 1e6

with tempfile.TemporaryDirectory() as d:
    write(d, 'p/a.jsonl', [row('m1', **MULTI)])
    close(sum(total(d)[0].values()), multi_usd)

with tempfile.TemporaryDirectory() as d:
    # An early copy with only the top-level split merges with the summed one, in both orders.
    early = {k: v for k, v in MULTI.items() if k != 'iterations'}
    write(d, 'p/a.jsonl', [row('m1', **early)])
    write(d, 'p/b.jsonl', [row('m1', **MULTI)])
    close(sum(total(d)[0].values()), multi_usd)
    close(sum(total(d, reverse=True)[0].values()), multi_usd)

with tempfile.TemporaryDirectory() as d:
    # Advisor copies across files merge by iteration, in both orders.
    adv = lambda n: [{'type': 'advisor_message', 'model': 'claude-fable-5-1', 'input_tokens': n}]
    write(d, 'p/a.jsonl', [row('m1', iterations=adv(100))])
    write(d, 'p/b.jsonl', [row('m1', iterations=adv(500))])
    close(sum(total(d)[0].values()), 500 * 10 / 1e6)
    close(sum(total(d, reverse=True)[0].values()), 500 * 10 / 1e6)

with tempfile.TemporaryDirectory() as d:
    # Cutoff: strictly before T.
    write(d, 'p/a.jsonl', [
        row('old', ts='2026-11-03T23:59:59.999Z', input_tokens=1000),
        row('at', ts=T, input_tokens=5000),
        row('new', ts='2026-11-04T00:00:00.001Z', input_tokens=7000),
    ])
    close(sum(total(d)[0].values()), 1000 * 4 / 1e6)

with tempfile.TemporaryDirectory() as d:
    # 15:30Z is the next day in Seoul; the earliest copy's time decides the day.
    write(d, 'p/a.jsonl', [
        row('m1', ts='2026-11-02T15:30:00.000Z', input_tokens=1000),
        row('m1', ts='2026-11-02T16:30:00.000Z', input_tokens=1000),
        row('m2', ts='2026-11-02T14:30:00.000Z', input_tokens=1000),
    ])
    days, _ = total(d)
    assert set(days) == {'2026-11-02', '2026-11-03'}, days
    close(days['2026-11-03'], 1000 * 4 / 1e6)

with tempfile.TemporaryDirectory() as d:
    # Dated Haiku is priced, <synthetic> is free and silent, an unknown model is reported.
    write(d, 'p/a.jsonl', [
        row('h', model='claude-haiku-4-5-20251001', input_tokens=1000),
        row('s', model='<synthetic>', input_tokens=1000),
        row('u', model='claude-mystery-9', input_tokens=1000),
        {'type': 'assistant', 'message': 'broken'},
    ])
    with open(os.path.join(d, 'p/a.jsonl'), 'a') as f:
        f.write('not json "assistant" "usage"\n')
    days, unpriced = total(d)
    close(sum(days.values()), 1000 * 1 / 1e6)
    assert unpriced == {'claude-mystery-9': 1}, unpriced

    # End to end as the mod runs it; content never reaches stdout.
    write(d, 'p/secret.jsonl', [dict(row('c', input_tokens=1000), text='SECRET-CONTENT')])
    out = subprocess.run(
        ['/usr/bin/python3', '-I', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backfill.py'), T, d],
        capture_output=True, text=True, check=True,
    )
    parsed = json.loads(out.stdout)
    assert parsed['dataStart'] == '2026-11-02', parsed
    assert parsed['unpriced'] == {'claude-mystery-9': 1}, parsed
    assert 'SECRET' not in out.stdout + out.stderr

print('test_backfill: ok')
