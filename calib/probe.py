import os, glob
from PIL import Image

ICONS='web/icons/characters'

def lum(px): return 0.299*px[0]+0.587*px[1]+0.114*px[2]

def ahash_img(im):
    im=im.convert('RGB').resize((16,16), Image.BILINEAR)
    d=list(im.getdata())
    g=[lum(p) for p in d]
    mean=sum(g)/len(g)
    bits=[1 if v>mean else 0 for v in g]
    return bits

def crop_hash(img, z):
    W,H=img.size
    x=z['x']*W; y=z['y']*H; w=z['w']*W; h=z['h']*H
    c=img.crop((int(x),int(y),int(x+w),int(y+h)))
    return ahash_img(c)

def ham(a,b): return sum(1 for x,y in zip(a,b) if x!=y)

# calibrated zones
Lx=[0.3033,0.3503,0.3935,0.4426]
Rx=[0.5571,0.6092,0.6514,0.7013]
Ry=[0.2654,0.3574,0.4493]
W_=0.040; H_=0.082
def Z(cx,cy): return {'x':cx-W_/2,'y':cy-H_/2,'w':W_,'h':H_}
slots={
 8:Z(Lx[0],Ry[0]),5:Z(Lx[1],Ry[0]),4:Z(Lx[2],Ry[0]),1:Z(Lx[3],Ry[0]),
 16:Z(Lx[0],Ry[1]),13:Z(Lx[1],Ry[1]),12:Z(Lx[2],Ry[1]),9:Z(Lx[3],Ry[1]),
 17:Z(Lx[3],Ry[2]),
 2:Z(Rx[0],Ry[0]),3:Z(Rx[1],Ry[0]),6:Z(Rx[2],Ry[0]),7:Z(Rx[3],Ry[0]),
 10:Z(Rx[0],Ry[1]),11:Z(Rx[1],Ry[1]),14:Z(Rx[2],Ry[1]),15:Z(Rx[3],Ry[1]),
 18:Z(Rx[0],Ry[2]),
}

refs={}
for f in glob.glob(ICONS+'/*.webp'):
    name=os.path.splitext(os.path.basename(f))[0]
    refs[name]=ahash_img(Image.open(f))

img=Image.open('calib/g1.jpg')
print('img',img.size)
for n in sorted(slots):
    h=crop_hash(img,slots[n])
    ds=sorted(((ham(h,refs[nm]),nm) for nm in refs))[:3]
    print('G%2d: '%n + ', '.join('%s(%d)'%(nm,d) for d,nm in ds))
