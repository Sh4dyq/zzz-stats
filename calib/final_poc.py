import os,glob,numpy as np,sys
from PIL import Image, ImageOps
import torch, torchvision.models as M, torchvision.transforms as T

Lx=[0.3033,0.3503,0.3935,0.4426]; Rx=[0.5571,0.6092,0.6514,0.7013]; Ry=[0.2654,0.3574,0.4493]
W_=0.040; H_=0.082
def Z(cx,cy): return (cx-W_/2,cy-H_/2,W_,H_)
SLOTS={8:Z(Lx[0],Ry[0]),5:Z(Lx[1],Ry[0]),4:Z(Lx[2],Ry[0]),1:Z(Lx[3],Ry[0]),
 16:Z(Lx[0],Ry[1]),13:Z(Lx[1],Ry[1]),12:Z(Lx[2],Ry[1]),9:Z(Lx[3],Ry[1]),17:Z(Lx[3],Ry[2]),
 2:Z(Rx[0],Ry[0]),3:Z(Rx[1],Ry[0]),6:Z(Rx[2],Ry[0]),7:Z(Rx[3],Ry[0]),
 10:Z(Rx[0],Ry[1]),11:Z(Rx[1],Ry[1]),14:Z(Rx[2],Ry[1]),15:Z(Rx[3],Ry[1]),18:Z(Rx[0],Ry[2])}
BANS={1,4,13,2,3,14}
def crop(img,z):
    W,H=img.size; x,y,w,h=z
    return img.crop((int(x*W),int(y*H),int((x+w)*W),int((y+h)*H))).convert('RGB')
def gray(im): return ImageOps.grayscale(im).convert('RGB')

ref_files=sorted(glob.glob('web/icons/characters/*.webp'))
NAMES=[os.path.splitext(os.path.basename(f))[0] for f in ref_files]
m=M.resnet18(weights=None); m.load_state_dict(torch.load('calib/r18.pth')); m.fc=torch.nn.Identity(); m=m.cuda().eval()
pre=T.Compose([T.Resize((224,224)),T.ToTensor(),T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
def emb(ims):
    x=torch.stack([pre(i) for i in ims]).cuda()
    with torch.no_grad(): return m(x).cpu().numpy()
def norm(a): return a/np.linalg.norm(a,axis=-1,keepdims=True)
Rc=norm(emb([Image.open(f).convert('RGB') for f in ref_files]))
Rg=norm(emb([gray(Image.open(f).convert('RGB')) for f in ref_files]))

def predict(img):
    out={}
    for n,z in SLOTS.items():
        c=crop(img,z)
        if n in BANS:
            vc=norm(emb([c])[0]); vg=norm(emb([gray(c)])[0])
            sc=Rc@vc; sg=Rg@vg
            ic,ig=sc.argmax(),sg.argmax()
            # pick the higher-confidence pass
            if sc[ic]>=sg[ig]: out[n]=(NAMES[ic],float(sc[ic]),'C')
            else: out[n]=(NAMES[ig],float(sg[ig]),'G')
        else:
            v=norm(emb([c])[0]); s=Rc@v; i=s.argmax()
            out[n]=(NAMES[i],float(s[i]),'C')
    return out

GT1_pick={5:'Yanagi',8:'Burnice',9:'Yuzuha',12:'Nangong Yu',16:'Rina',17:'Soukaku',
          6:'Astra',7:'Alice',10:'Nicole',11:'Ellen',15:'Lycaon',18:'Trigger'}
GT1_ban={1:'Promeia',4:'Vivian',13:'Jane Doe',2:'Aria',3:'Miyabi',14:'Piper'}

for game,fn in [('game1','calib/g1.jpg')]:
    pr=predict(Image.open(fn))
    GT={**GT1_pick,**GT1_ban}
    ph=sum(pr[n][0]==GT[n] for n in GT1_pick); bh=sum(pr[n][0]==GT[n] for n in GT1_ban)
    print('\n===',game,'=== picks %d/12  bans %d/6'%(ph,bh))
    for n in sorted(SLOTS):
        nm,sc,pass_=pr[n]; g=GT.get(n)
        mk='OK ' if g==nm else ('x  ' if g else '   ')
        print('G%2d %-4s %s pred=%-12s %.3f[%s] want=%s'%(n,'BAN' if n in BANS else 'pick',mk,nm,sc,pass_,g or '?'))
