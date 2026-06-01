import os, glob, sys
import numpy as np
from PIL import Image
import torch

ICONS = 'web/icons/characters'

# calibrated zones (from probe.py)
Lx=[0.3033,0.3503,0.3935,0.4426]
Rx=[0.5571,0.6092,0.6514,0.7013]
Ry=[0.2654,0.3574,0.4493]
W_=0.040; H_=0.082
def Z(cx,cy): return (cx-W_/2,cy-H_/2,W_,H_)
slots={
 8:Z(Lx[0],Ry[0]),5:Z(Lx[1],Ry[0]),4:Z(Lx[2],Ry[0]),1:Z(Lx[3],Ry[0]),
 16:Z(Lx[0],Ry[1]),13:Z(Lx[1],Ry[1]),12:Z(Lx[2],Ry[1]),9:Z(Lx[3],Ry[1]),
 17:Z(Lx[3],Ry[2]),
 2:Z(Rx[0],Ry[0]),3:Z(Rx[1],Ry[0]),6:Z(Rx[2],Ry[0]),7:Z(Rx[3],Ry[0]),
 10:Z(Rx[0],Ry[1]),11:Z(Rx[1],Ry[1]),14:Z(Rx[2],Ry[1]),15:Z(Rx[3],Ry[1]),
 18:Z(Rx[0],Ry[2]),
}
BANS={1,4,13,2,3,14}

def crop(img,z):
    W,H=img.size
    x,y,w,h=z
    return img.crop((int(x*W),int(y*H),int((x+w)*W),int((y+h)*H))).convert('RGB')

img=Image.open('calib/g1.jpg')
crops={n:crop(img,slots[n]) for n in slots}
ref_files=sorted(glob.glob(ICONS+'/*.webp'))
ref_names=[os.path.splitext(os.path.basename(f))[0] for f in ref_files]
ref_imgs=[Image.open(f).convert('RGB') for f in ref_files]

def report(name, ref_vecs, crop_vecs):
    R=ref_vecs/np.linalg.norm(ref_vecs,axis=1,keepdims=True)
    hit=0; tot=0
    lines=[]
    for n in sorted(crops):
        v=crop_vecs[n]; v=v/np.linalg.norm(v)
        sims=R@v
        idx=np.argsort(-sims)[:3]
        top=[(ref_names[i],float(sims[i])) for i in idx]
        tag='BAN' if n in BANS else 'pick'
        lines.append('G%2d[%s]: '%(n,tag)+', '.join('%s(%.3f)'%(nm,s) for nm,s in top))
    print('\n=== %s ==='%name)
    print('\n'.join(lines))

device='cuda' if torch.cuda.is_available() else 'cpu'
print('device',device)

def run_openclip(model_name, pretrained):
    import open_clip
    model,_,preprocess=open_clip.create_model_and_transforms(model_name,pretrained=pretrained)
    model=model.to(device).eval()
    def emb(imgs):
        x=torch.stack([preprocess(im) for im in imgs]).to(device)
        with torch.no_grad():
            f=model.encode_image(x)
        return f.cpu().numpy()
    rv=emb(ref_imgs)
    cv={n:emb([crops[n]])[0] for n in crops}
    report('CLIP %s/%s'%(model_name,pretrained), rv, cv)

def run_resnet():
    import torchvision.models as M
    import torchvision.transforms as T
    m=M.resnet18(weights=None)
    m.load_state_dict(torch.load('calib/r18.pth'))
    m.fc=torch.nn.Identity()
    m=m.to(device).eval()
    pre=T.Compose([T.Resize((224,224)),T.ToTensor(),
        T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
    def emb(imgs):
        x=torch.stack([pre(im) for im in imgs]).to(device)
        with torch.no_grad(): f=m(x)
        return f.cpu().numpy()
    rv=emb(ref_imgs)
    cv={n:emb([crops[n]])[0] for n in crops}
    report('ResNet18-ImageNet', rv, cv)

mode=sys.argv[1] if len(sys.argv)>1 else 'resnet'
if mode=='resnet': run_resnet()
elif mode=='clip32': run_openclip('ViT-B-32','laion2b_s34b_b79k')
elif mode=='clip16': run_openclip('ViT-B-16','laion2b_s34b_b88k')
elif mode=='dino':
    # dinov2 via torch.hub
    m=torch.hub.load('facebookresearch/dinov2','dinov2_vits14').to(device).eval()
    import torchvision.transforms as T
    pre=T.Compose([T.Resize((224,224)),T.ToTensor(),
        T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
    def emb(imgs):
        x=torch.stack([pre(im) for im in imgs]).to(device)
        with torch.no_grad(): f=m(x)
        return f.cpu().numpy()
    rv=emb(ref_imgs); cv={n:emb([crops[n]])[0] for n in crops}
    report('DINOv2-vits14', rv, cv)
