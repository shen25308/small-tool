# WCAG contrast of the text/surface pairs the UI actually uses, read from UI/tokens.css.
import re, sys, pathlib
src = pathlib.Path(__file__).resolve().parents[2].joinpath('UI/tokens.css').read_text()
tok = {m[1]: (m[2], m[3]) for m in re.finditer(r'--([\w-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)', src)}
tok['white'] = ('#ffffff', '#ffffff'); tok['warn-on'] = ('#2b1e02', '#2b1e02')
def lum(h):
    c = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
def ratio(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True); return (x + .05) / (y + .05)
pairs = [(f, b, 4.5) for b in ('canvas', 'paper', 'raised', 'sunken') for f in ('ink', 'ink-2', 'ink-3', 'accent')]
pairs += [('seal', 'paper', 4.5), ('seal', 'seal-wash', 4.5), ('ok', 'raised', 4.5), ('ok', 'ok-wash', 4.5), ('warn', 'raised', 4.5), ('warn', 'warn-wash', 4.5),
          ('bad', 'raised', 4.5), ('bad', 'bad-wash', 4.5), ('accent', 'accent-wash', 4.5), ('white', 'accent-fill', 4.5), ('white', 'seal-fill', 4.5),
          ('white', 'ok-fill', 3), ('white', 'bad-fill', 3), ('warn-on', 'warn-fill', 4.5), ('ink-4', 'paper', 0), ('line-strong', 'paper', 0)]
pairs += [(f'tone-{i}', 'paper', 4.5) for i in range(7)]
bad = 0
for f, b, need in pairs:
    for i, mode in enumerate(('light', 'dark')):
        r = ratio(tok[f][i], tok[b][i]); ok = r >= need; bad += not ok
        if not ok or '-v' in sys.argv: print(f'{"ok  " if ok else "FAIL"} {mode:5} {f} on {b}: {r:.2f} (needs {need})')
print('all pairs pass' if not bad else f'{bad} failing')
