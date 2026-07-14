import json,urllib.request,collections
import synergy_model as M
URL='https://zoavnckfbfiejxfjakue.supabase.co/rest/v1';KEY='sb_publishable_37RZBsmdp3O1i795EuEfeg_vFpdPTFZ'
def get(p):
  out=[];off=0
  while True:
    r=urllib.request.Request(f"{URL}/{p}&limit=1000&offset={off}",headers={'apikey':KEY,'Authorization':'Bearer '+KEY})
    d=json.load(urllib.request.urlopen(r));out+=d
    if len(d)<1000:break
    off+=1000
  return out
chars=get("characters?select=id,name");id2n={c['id']:c['name'] for c in chars}
ALIAS={'Nicole':'Nicole Demara','Lycaon':'Von Lycaon','Lucy':'Luciana de Montefio','Astra':'Astra Yao','Alice':'Alice Thymefield','Burnice':'Burnice White','Vivian':'Vivian Banshee','Evelyn':'Evelyn Chevalier','Ellen':'Ellen Joe','Rina':'Alexandrina Sebastiane','Yuzuha':'Ukinami Yuzuha','Orphie':'Orphie Magnusson & Magus','Caesar':'Caesar King','Yidhari':'Yidhari Murphy','Miyabi':'Hoshimi Miyabi','Pulchra':'Pulchra Fellini','S Anby':'Soldier 0 - Anby','Yanagi':'Tsukishiro Yanagi','Grace':'Grace Howard','Koleda':'Koleda Belobog','Seth':'Seth Lowell','Lucia':'Lucia Elowen','S Billy':'Starlight - Billy','Harumasa':'Asaba Harumasa','Nekomata':'Nekomiya Mana','Manato':'Komano Manato','Anby':'Anby Demara','Billy':'Billy Kid'}
tag={v['name'] for v in M.TAGS.values()}
def nm(c):
  n=id2n.get(c);n=ALIAS.get(n,n);return n if n in tag else None
ms=get("matches?select=id,winner_id,is_draw,picks:match_picks(player_id,character_id,team_slot)")
solo=collections.defaultdict(lambda:[0,0]);samples=[]
for m in ms:
  if m['is_draw'] or not m['winner_id']:continue
  byp=collections.defaultdict(lambda:collections.defaultdict(list));bad=False
  for p in m['picks']:
    n=nm(p['character_id'])
    if not n:bad=True;break
    byp[p['player_id']][p['team_slot']].append(n)
  if bad or len(byp)!=2:continue
  for pl,slots in byp.items():
    won=1 if pl==m['winner_id'] else 0
    for s,l in slots.items():
      if len(l)==3:
        for n in l:solo[n][0]+=won;solo[n][1]+=1
  samples.append((byp,m['winner_id']))
def bwr(n):w,g=solo[n];return (w+3)/(g+6)
def games(n):return solo[n][1]
K=8
def pscore(byp,pl,BOOST):
  slots=byp[pl];ts=[slots[s] for s in slots if len(slots[s])==3]
  base=sum(bwr(n) for t in ts for n in t)/(3*len(ts))
  syn=0
  for t in ts:
    conf=sum(games(n)/(games(n)+K) for n in t)/3
    mult=1+BOOST*(1-conf)
    syn+=M.synergy(t)['total']*mult
  return base+syn/len(ts)
def acc(BOOST):
  c=t=0
  for byp,win in samples:
    pls=list(byp)
    da=pscore(byp,pls[0],BOOST)-pscore(byp,pls[1],BOOST)
    if abs(da)<1e-12:continue
    t+=1;c+=((pls[0] if da>0 else pls[1])==win)
  return c/t
# base-only
def accbase():
  c=t=0
  for byp,win in samples:
    pls=list(byp)
    def b(pl):slots=byp[pl];ts=[slots[s] for s in slots if len(slots[s])==3];return sum(bwr(n) for x in ts for n in x)/(3*len(ts))
    da=b(pls[0])-b(pls[1])
    if abs(da)<1e-12:continue
    t+=1;c+=((pls[0] if da>0 else pls[1])==win)
  return c/t
print("матчей:",len(samples),"K=",K)
print(f"  база (без синергии)      acc={accbase():.4f}")
for name,B in [('BOOST=0 (фикс-синергия)',0.0),('BOOST=1 (низкий)',1.0),('BOOST=2.5 (средний)',2.5),('BOOST=4 (высокий)',4.0)]:
  print(f"  {name:26} acc={acc(B):.4f}")
# распределение mult, чтобы видеть агрессивность
import statistics
mults=[]
for byp,win in samples:
  for pl in byp:
    slots=byp[pl];ts=[slots[s] for s in slots if len(slots[s])==3]
    for t in ts:
      conf=sum(games(n)/(games(n)+K) for n in t)/3
      mults.append(conf)
cs=sorted(mults)
print(f"\ndataConf команд: медиана={statistics.median(cs):.2f} p10={cs[len(cs)//10]:.2f} p90={cs[len(cs)*9//10]:.2f}")
print("=> при BOOST=2.5: mult в диапазоне ~", f"{1+2.5*(1-cs[len(cs)*9//10]):.2f}..{1+2.5*(1-cs[len(cs)//10]):.2f}")
