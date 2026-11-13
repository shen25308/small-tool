# Contact sheet of screenshots: python3 sheet.py out.png cols a.png b.png ...
import sys
from PIL import Image
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert('RGB') for f in files]
w, h, gap = max(i.width for i in ims), max(i.height for i in ims), 16
rows = -(-len(ims) // cols)
sheet = Image.new('RGB', (cols * (w + gap) + gap, rows * (h + gap) + gap), '#8a8780')
for n, im in enumerate(ims):
    sheet.paste(im, (gap + (n % cols) * (w + gap), gap + (n // cols) * (h + gap)))
sheet.save(out)
