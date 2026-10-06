from playwright.sync_api import sync_playwright
from pathlib import Path
import urllib.request,json,re,base64,os
root=Path(__file__).resolve().parents[1]
out=root/'docs/screenshots/hud'
cases=[('ct-mid','CT · $3,450','强起 / 半起 / ECO 同时显示'),('t-rich','T · $8,000','全起与强起；败后按未下包计算'),('ct-low','CT · $1,200','低经济：ECO 与强起'),('retained-rifle','CT · 已有 M4A1-S / 烟','只显示补买，不重复购买已有装备'),('awp','明确优先 AWP · $7,000','AWP 标注优先，其他方案仍在'),('save-awp','为 AWP 留钱 · $4,200','展示引擎支持的全部保留方案'),('pistol-winner','T · 手枪局获胜后的 R2','经过完整回合结束记录'),('pistol-loser','CT · 手枪局败后的 R2','不凭空判断手枪局胜负'),('missing-loss','缺失连败信息','不编造败后经济'),('missing-inventory','缺失当前持枪信息','不沿用上一帧库存'),('pistol','手枪局 · $800','当前策略尚未覆盖'),('overtime','加时 · $10,000','当前可买方案，未来能力有边界'),('live','回合开始','HUD 完全隐藏'),('stale','GSI 超过 5 秒未更新','HUD 完全隐藏'),('spectator','观察其他玩家','HUD 完全隐藏')]
with sync_playwright() as p:
 browser_path=os.getenv('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
 b=p.chromium.launch(executable_path=browser_path,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1920,'height':1080},device_scale_factor=1)
 page.goto('http://127.0.0.1:3100/overlay')
 proto=(root/'apps/panel-preview/index.html').read_text()
 scene=re.search(r'(<svg class="game-scene".*?)(?=<div class="hud-anchor)',proto,re.S).group(1)
 page.evaluate('(html)=>{const x=document.createElement("div");x.id="qa-scene";x.innerHTML=html;document.body.prepend(x)}',scene)
 page.add_style_tag(content=(root/'apps/panel-preview/hud.css').read_text())
 page.add_style_tag(content='body{background:#29362d;overflow:hidden}#qa-scene{position:fixed;inset:0;z-index:-1}.game-scene{position:absolute;width:100%;height:100%}.hud{position:absolute;left:48px;top:356px;font-family:"Segoe UI","Noto Sans CJK SC",sans-serif}.native-radar{width:150px}.native-cash{top:25%}')
 snapshots={}
 for ident,title,note in cases:
  req=urllib.request.Request('http://127.0.0.1:3201/'+ident,method='POST')
  snapshots[ident]=json.load(urllib.request.urlopen(req))
  page.wait_for_timeout(6500 if ident=='stale' else 200)
  snapshots[ident]=json.load(urllib.request.urlopen('http://127.0.0.1:3100/snapshot'))
  if ident in ('live','stale','spectator'): assert page.locator('#hud').is_hidden(),ident
  else: page.locator('#hud').wait_for(state='visible')
  if ident in ('ct-mid','t-rich','retained-rifle','awp','live'):
   page.screenshot(path=str(out/(ident+'-full.png')))
  if page.locator('#hud').is_visible():
   bounds=page.locator('#hud').bounding_box()
   # Never silently clip actionable purchasing text.
   assert page.locator('.purchase').evaluate_all('(xs)=>xs.every(x=>x.scrollWidth<=x.clientWidth+1)'),ident
   page.screenshot(path=str(out/(ident+'.png')),clip={'x':40,'y':348,'width':264,'height':bounds['height']+16})
  else: page.screenshot(path=str(out/(ident+'.png')),clip={'x':40,'y':348,'width':264,'height':144})
  snapshots[ident]['dimensions']=page.locator('#hud').bounding_box()
 # Capture settings using the same live service/renderer.
 urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:3201/ct-mid',method='POST')).close()
 page.goto('http://127.0.0.1:3100/')
 page.wait_for_timeout(300)
 page.screenshot(path=str(out/'settings.png'),full_page=True)
 gallery=b.new_page(viewport={'width':1160,'height':1400},device_scale_factor=1)
 cards=[]
 for ident,title,note in cases:
  data=base64.b64encode((out/(ident+'.png')).read_bytes()).decode()
  cards.append(f'<article><div class="id">{ident}</div><h2>{title}</h2><p>{note}</p><img src="data:image/png;base64,{data}"></article>')
 gallery.set_content('<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#111914;color:#dbe3cc;font:12px "Noto Sans CJK SC",sans-serif}h1{font-size:22px;font-weight:500;margin:0 0 8px}.caption{color:#8a9c7b;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}article{background:#1d281f;border:1px solid #394634;border-radius:6px;padding:16px;min-height:230px}.id{font:9px monospace;color:#798c6d}h2{font-size:13px;font-weight:500;margin:7px 0}p{font-size:10px;color:#8fa280;margin:0 0 15px}img{display:block;width:264px;height:auto}</style><h1>RoundSense · 冻结时间 HUD / 全方案</h1><div class="caption">实际渲染器 + 合成 GSI 回放 · 默认宽 248px · 游戏背景为示意，非实机截图</div><div class="grid">'+''.join(cards)+'</div>')
 gallery.screenshot(path=str(out/'scenarios.png'),full_page=True)
 (out/'snapshots.json').write_text(json.dumps(snapshots,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k: {'cards':[(c['title'],c['purchases'],c['nextMoney']) for c in v['cards']], 'dimensions':v['dimensions']} for k,v in snapshots.items()},ensure_ascii=False))
 b.close()
