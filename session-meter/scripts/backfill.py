#!/usr/bin/env python3
"""Estimate past spend per local day from Claude Code transcripts.

usage: backfill.py <cutoff ISO UTC> [projects dir]
stdout: JSON {days, dataStart, unpriced}. Prints aggregates only, never conversation content.
Stdlib only, Python 3.9+.
"""
import datetime as dt
import json
import os
import sys

# $/MTok: input, output, cache read, 5m cache write, 1h cache write.
PRICES = {
    'claude-fable-5-1': (10, 50, .25, 12.5, 20),
    'claude-fable-5': (10, 50, 1, 12.5, 20),
    'claude-opus-5-5': (4, 20, .2, 5, 8),
    'claude-opus-5': (5, 25, .5, 6.25, 10),
    'claude-opus-4-8': (5, 25, .5, 6.25, 10),
    'claude-opus-4-7': (5, 25, .5, 6.25, 10),
    'claude-opus-4-6': (5, 25, .5, 6.25, 10),
    'claude-sonnet-5-5': (2, 10, .2, 2.5, 4),
    'claude-sonnet-5': (2, 10, .2, 2.5, 4),
    'claude-sonnet-4-6': (3, 15, .3, 3.75, 6),
    # ponytail: Haiku 5.5 flat, though prompts over 100K tokens cost more; split it if such prompts become common.
    'claude-haiku-5-5': (.1, .5, .01, .125, .2),
    'claude-haiku-4-5': (1, 5, .1, 1.25, 2),
    'claude-haiku-4-5-20251001': (1, 5, .1, 1.25, 2),
    '<synthetic>': (0, 0, 0, 0, 0),
}


def parse_ts(ts):
    return dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))


def fields(u):
    """input, output, cache read, 5m write, 1h write of a usage or iteration object.

    On a multi-iteration message the top-level split holds only the first iteration, while the
    top-level cache_creation_input_tokens is their sum, so a message's iterations are summed.
    """
    parts = [i for i in u.get('iterations') or [] if i.get('type') == 'message']
    if parts:
        return [sum(col) for col in zip(*(fields(i) for i in parts))]
    cc = u.get('cache_creation')
    if cc:
        c5, c1 = cc.get('ephemeral_5m_input_tokens', 0), cc.get('ephemeral_1h_input_tokens', 0)
    else:
        c5, c1 = u.get('cache_creation_input_tokens', 0), 0
    return [u.get('input_tokens', 0), u.get('output_tokens', 0), u.get('cache_read_input_tokens', 0), c5, c1]


def maxed(a, b):
    return [max(x, y) for x, y in zip(a, b)]


def scan(root, before, reverse=False):
    """Every message id across all files: earliest row time, model, per-field max usage, advisor iterations."""
    paths = sorted(
        (os.path.join(d, n) for d, _, names in os.walk(root) for n in names if n.endswith('.jsonl')),
        reverse=reverse,
    )
    seen = {}
    for path in paths:
        try:
            f = open(path, 'rb')
        except OSError:
            continue
        with f:
            for raw in f:
                if b'"assistant"' not in raw or b'"usage"' not in raw:
                    continue
                try:
                    row = json.loads(raw)
                    if row.get('type') != 'assistant':
                        continue
                    ts = parse_ts(row['timestamp'])
                    if ts >= before:
                        continue
                    m = row['message']
                    u = m['usage']
                    e = seen.setdefault(m['id'], {'ts': ts, 'model': m['model'], 'usage': [0] * 5, 'advisor': {}})
                    e['ts'] = min(e['ts'], ts)
                    e['usage'] = maxed(e['usage'], fields(u))
                    advisor = [i for i in u.get('iterations') or [] if i.get('type') == 'advisor_message']
                    for n, i in enumerate(advisor):
                        a = e['advisor'].setdefault(n, {'model': i['model'], 'usage': [0] * 5})
                        a['usage'] = maxed(a['usage'], fields(i))
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue
    return seen


def estimate(seen):
    days, unpriced = {}, {}

    def usd(model, usage):
        price = PRICES.get(model.replace('[1m]', ''))
        if price is None:
            unpriced[model] = unpriced.get(model, 0) + 1
            return 0
        return sum(a * b for a, b in zip(usage, price)) / 1e6

    for e in seen.values():
        v = usd(e['model'], e['usage']) + sum(usd(a['model'], a['usage']) for a in e['advisor'].values())
        if v > 0:
            k = e['ts'].astimezone().strftime('%Y-%m-%d')
            days[k] = days.get(k, 0) + v
    return days, unpriced


def main(argv):
    if len(argv) < 2:
        sys.exit('usage: backfill.py <cutoff ISO UTC> [projects dir]')
    root = argv[2] if len(argv) > 2 else os.path.expanduser('~/.claude/projects')
    days, unpriced = estimate(scan(root, parse_ts(argv[1])))
    print(json.dumps({
        'days': {k: round(v, 4) for k, v in sorted(days.items())},
        'dataStart': min(days) if days else None,
        'unpriced': unpriced,
    }))


if __name__ == '__main__':
    main(sys.argv)
