#!/usr/bin/env python3
"""Recover the 'creative' interest for members whose free-text answers the
2026-08-22 backfill dropped BEFORE the 'creative' slug existed.

The backfill deleted terms like Film/Art/Photography/Theatre from
User.interests; the nightly dump taken hours earlier still holds them. This
parses that dump's users COPY block, finds members whose OLD interests
contained a creative-tail term, and appends 'creative' to their CURRENT
interests — guarded in SQL so it's idempotent and a concurrent profile edit
can't be clobbered.

Run on the server:
  gunzip -c /root/db-backups/smileys_2026-08-22_02-00-01.sql.gz | \
    python3 scripts/recover-creative-interests.py            # dry run
  gunzip -c ... | APPLY=1 python3 scripts/recover-creative-interests.py
"""
import os, re, subprocess, sys

CREATIVE_TERMS = {
    'film', 'art', 'arts', 'photography', 'theatre', 'theater', 'writing',
    'reading', 'music', 'design', 'fashion', 'painting', 'drawing', 'crochet',
}

def db_url():
    with open('/root/smileys-community/.env') as f:
        for line in f:
            if line.startswith('DATABASE_URL='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('DATABASE_URL not found in .env')

def parse_pg_array(raw):
    if raw in ('{}', r'\N', ''):
        return []
    inner = raw[1:-1] if raw.startswith('{') and raw.endswith('}') else raw
    items = []
    for quoted, bare in re.findall(r'"((?:[^"\\]|\\.)*)"|([^,]+)', inner):
        items.append(quoted.replace('\\"', '"').replace('\\\\', '\\') if quoted else bare)
    return items

def main():
    apply = os.environ.get('APPLY') == '1'
    header = None
    in_users = False
    candidates = []
    for line in sys.stdin:
        if line.startswith('COPY public.users ('):
            header = [c.strip() for c in line[line.index('(') + 1:line.index(')')].split(',')]
            in_users = True
            continue
        if in_users:
            if line.startswith('\\.'):
                break
            cols = line.rstrip('\n').split('\t')
            row = dict(zip(header, cols))
            old = parse_pg_array(row.get('interests', ''))
            if any(t.strip().lower() in CREATIVE_TERMS for t in old):
                candidates.append((row['id'], [t for t in old if t.strip().lower() in CREATIVE_TERMS]))

    print(f'{len(candidates)} members had creative-tail terms in the pre-backfill dump')
    if not candidates:
        return

    url = db_url()
    ids = [c[0] for c in candidates]
    applied = 0
    if apply:
        # One statement, guarded per-row: only rows still missing 'creative'.
        id_list = ','.join(f"'{i}'" for i in ids if re.fullmatch(r'[a-z0-9]+', i))
        sql = (
            'UPDATE users SET interests = array_append(interests, \'creative\') '
            f"WHERE id IN ({id_list}) AND NOT ('creative' = ANY(interests)) AND status <> 'banned';"
        )
        out = subprocess.run(['psql', url, '-At', '-c', sql], capture_output=True, text=True)
        if out.returncode != 0:
            raise SystemExit(f'psql failed: {out.stderr}')
        print(f'APPLIED: {out.stdout.strip()}')
        applied = 1
    if not applied:
        sample = ', '.join(f'{i[:8]}…({"/".join(terms)})' for i, terms in candidates[:8])
        print(f'DRY RUN — sample: {sample}')
        print('Re-run with APPLY=1 to write.')

if __name__ == '__main__':
    main()
