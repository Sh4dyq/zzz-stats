from PIL import Image, ImageDraw
im=Image.open('g1.jpg').convert('RGB'); W,H=im.size

# 12 pick cards. For each: element center, role center, amp center (fractions of W/H).
# Left player (fp): amp on far-left, element/role on far-right of footer.
# Right player (dbl): element/role mid-right, amp on far-right.
# name footer zones (top-left) for reference:
# L_T1 x=.163,.278,.391 ; L_T2 x=.184,.297,.410 ; y_T1~.672 y_T2~.886
# R_T1 x=.540,.657,.771 ; R_T2 x=.525,.639,.750

ICON_W=0.0120; ICON_H=0.0210  # element/role icon box
AMP_W=0.0320; AMP_H=0.0480

# guesses [label, el_cx, el_cy, role_cx, role_cy, amp_cx, amp_cy]
cards=[
 # LEFT T1 row (Burnice, Nangong Yu, Rina)
 ['L_T1_0', .240,.695, .240,.711, .175,.704],
 ['L_T1_1', .355,.695, .355,.711, .280,.704],
 ['L_T1_2', .450,.695, .450,.711, .385,.704],
 # LEFT T2 row (Yanagi, Soukaku, Yuzuha)
 ['L_T2_0', .261,.909, .261,.925, .196,.918],
 ['L_T2_1', .366,.909, .366,.925, .301,.918],
 ['L_T2_2', .471,.909, .471,.925, .406,.918],
 # RIGHT T1 row (Ellen, Lycaon, Nicole)
 ['R_T1_0', .592,.694, .592,.712, .614,.704],
 ['R_T1_1', .709,.694, .709,.712, .731,.704],
 ['R_T1_2', .823,.694, .823,.712, .845,.704],
 # RIGHT T2 row (Alice, Trigger, Astra Yao)
 ['R_T2_0', .577,.908, .577,.926, .599,.918],
 ['R_T2_1', .691,.908, .691,.926, .713,.918],
 ['R_T2_2', .802,.908, .802,.926, .824,.918],
]

def crop(cx,cy,w,h):
    x0=int((cx-w/2)*W); y0=int((cy-h/2)*H)
    return im.crop((x0,y0,int((cx+w/2)*W),int((cy+h/2)*H)))

# montage: rows=cards, cols=[element,role,amp], upscaled 4x
cellW=80; cellH=80; pad=6
mont=Image.new('RGB',(3*cellW+4*pad, len(cards)*cellH+ (len(cards)+1)*pad),(20,22,30))
d=ImageDraw.Draw(mont)
for i,c in enumerate(cards):
    lab,ecx,ecy,rcx,rcy,acx,acy=c
    crops=[crop(ecx,ecy,ICON_W,ICON_H),crop(rcx,rcy,ICON_W,ICON_H),crop(acx,acy,AMP_W,AMP_H)]
    for j,cr in enumerate(crops):
        cr=cr.resize((cellW,cellH))
        mont.paste(cr,(pad+j*(cellW+pad), pad+i*(cellH+pad)))
mont.save('cal_er_mont.png')
print('saved', mont.size)
