import os

BOOKS = [
    ("b1", "活着", "余华", "#1a3c34", "#3d6b5c"),
    ("b2", "百年孤独", "马尔克斯", "#2c1810", "#6b4c41"),
    ("b3", "三体", "刘慈欣", "#0f2027", "#2c5364"),
    ("b4", "人类简史", "赫拉利", "#3d2914", "#8b6914"),
    ("b5", "小王子", "圣埃克苏佩里", "#1e3c72", "#2a5298"),
    ("b6", "围城", "钱钟书", "#134e4a", "#2d6a4f"),
    ("b7", "明朝那些事儿", "当年明月", "#4a1942", "#7b2d8e"),
    ("b8", "流浪地球", "刘慈欣", "#0c0c0c", "#434343"),
    ("b9", "原则", "达利欧", "#1a1a2e", "#16213e"),
    ("b10", "艺术的故事", "贡布里希", "#642b73", "#c6426e"),
    ("b11", "夏洛的网", "E·B·怀特", "#355c7d", "#6c5b7b"),
    ("b12", "平凡的世界", "路遥", "#283048", "#859398"),
    ("b13", "时间简史", "霍金", "#141e30", "#243b55"),
    ("b14", "长安的荔枝", "马伯庸", "#7b4397", "#dc2430"),
    ("b15", "海底两万里", "凡尔纳", "#004e92", "#000428"),
    ("b16", "设计中的设计", "原研哉", "#232526", "#414345"),
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images", "covers")
os.makedirs(OUT, exist_ok=True)

for bid, title, author, c1, c2 in BOOKS:
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 440">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <rect width="300" height="440" fill="url(#g)"/>
  <rect width="18" height="440" fill="rgba(0,0,0,0.18)"/>
  <rect x="24" y="40" width="252" height="2" fill="rgba(255,255,255,0.15)"/>
  <text x="150" y="210" text-anchor="middle" fill="#fff" font-size="28" font-family="Georgia, 'Noto Serif SC', serif" font-weight="600">{title}</text>
  <text x="150" y="260" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-size="15" font-family="sans-serif">{author}</text>
  <rect x="60" y="320" width="180" height="1" fill="rgba(255,255,255,0.2)"/>
</svg>"""
    with open(os.path.join(OUT, f"{bid}.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
print("ok", len(BOOKS))
