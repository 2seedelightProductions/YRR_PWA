"""Build vote-categories.json from NextKast masterLibrary.txt.
Usage: python build_vote_categories.py "D:/Dropbox/nextKast/masterLibrary.txt" vote-categories.json
Format: 4-byte LE record count, then records = 2-byte LE length + '^^'-delimited fields
(field 0 = 'Artist - Title', field 1 = category)."""
import struct, re, json, sys, collections, datetime
src, dst = sys.argv[1], sys.argv[2]
d = open(src, 'rb').read(); p = 4; rows = []
while p + 2 <= len(d):
    L = struct.unpack('<H', d[p:p+2])[0]; rec = d[p+2:p+2+L]; p += 2 + L
    f = rec.decode('utf-8', 'replace').split('^^')
    if len(f) >= 3 and ' - ' in f[0]:
        a, t = f[0].split(' - ', 1); rows.append((a.strip(), t.strip(), f[1].strip()))
NONMUSIC = re.compile(r'sweep|brb|legalid|beds?$|promo|stager|element|finalmessage|delete|mixtrack|^mix\d|unwarped|liverecording|^vt|ycl_net|listenerline|adbreak|norms|temp|podcast|4550_samantha|4550_beds|copy of|bzw', re.I)
PRI = ['YachtRock','Yachtiest','DeepDive','SmoothFM','YarAndB','AM Gold','Retro','Summer','SummerJams','Shallows','FFF','Christmas','Halloween','Thanksgiving','Irish','BirthdayBeat','Specialty','YCSN','4550_T40s','Y4550','Commercials','TV']
rank = lambda c: PRI.index(c) if c in PRI else (90 if c.lower() in ('repick','1repick','undecided','fff_played') else 50)
n = lambda s: re.sub(r'[^a-z0-9]', '', s.lower().replace('&', 'and'))
strip = lambda s: re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', '', s)
cats = collections.defaultdict(set); tcats = collections.defaultdict(set)
for a, t, c in rows:
    if NONMUSIC.search(c): continue
    for tt in {t, strip(t)}:
        cats[n(a)+'|'+n(tt)].add(c); tcats[n(tt)].add((n(a), c))
best = lambda s: sorted(s, key=rank)[0]
out = {'v': datetime.date.today().strftime('%y%m%d'), 'src': 'masterLibrary.txt',
       'k': {k: best(v) for k, v in cats.items()},
       't': {t: best({c for _, c in v}) for t, v in tcats.items() if len({a for a, _ in v}) == 1}}
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print(len(rows), 'library rows ->', len(out['k']), 'keys')
