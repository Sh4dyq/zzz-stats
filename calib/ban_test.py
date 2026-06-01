import os,glob,numpy as np
from PIL import Image, ImageOps
import torch, torchvision.models as M, torchvision.transforms as T
from embed_test import slots, crop, BANS
img=Image.open('calib/g1.jpg')
ref_files=sorted(glob.glob('web/icons/characters/*.webp'))
names=[os.path.splitext(os.path.basename(f))[0] for f in ref_files]
def gray(im): return ImageOps.grayscale(im).convert('RGB')
refs=[gray(Image.open(f).convert('RGB')) for f in ref_files]
m=M.resnet18(weights=None); m.load_state_dict(torch.load('calib/r18.pth')); m.fc=torch.nn.Identity(); m=m.cuda().eval()
pre=T.Compose([T.Resize((224,224)),T.ToTensor(),T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
def emb(ims):
    x=torch.stack([pre(i) for i in ims]).cuda()
    with torch.no_grad(): return m(x).cpu().numpy()
R=emb(refs); R=R/np.linalg.norm(R,axis=1,keepdims=True)
for n in [1,2,3,4,13,14]:
    c=gray(crop(img,slots[n]))
    v=emb([c])[0]; v/=np.linalg.norm(v)
    sims=R@v; idx=np.argsort(-sims)[:3]
    print('G%2d:'%n, ', '.join('%s(%.3f)'%(names[i],sims[i]) for i in idx))
