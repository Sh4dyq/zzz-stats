from PIL import Image, ImageDraw
import glob, os
img=Image.open('calib/g1.jpg')
Lx=[0.3033,0.3503,0.3935,0.4426]; Rx=[0.5571,0.6092,0.6514,0.7013]; Ry=[0.2654,0.3574,0.4493]
W_=0.040; H_=0.082
def Z(cx,cy): return (cx-W_/2,cy-H_/2,W_,H_)
order=[8,5,4,1,16,13,12,9,17,2,3,6,7,10,11,14,15,18]
pos={8:Z(Lx[0],Ry[0]),5:Z(Lx[1],Ry[0]),4:Z(Lx[2],Ry[0]),1:Z(Lx[3],Ry[0]),
16:Z(Lx[0],Ry[1]),13:Z(Lx[1],Ry[1]),12:Z(Lx[2],Ry[1]),9:Z(Lx[3],Ry[1]),17:Z(Lx[3],Ry[2]),
2:Z(Rx[0],Ry[0]),3:Z(Rx[1],Ry[0]),6:Z(Rx[2],Ry[0]),7:Z(Rx[3],Ry[0]),
10:Z(Rx[0],Ry[1]),11:Z(Rx[1],Ry[1]),14:Z(Rx[2],Ry[1]),15:Z(Rx[3],Ry[1]),18:Z(Rx[0],Ry[2])}
W,H=img.size
cell=84
mont=Image.new('RGB',(cell*9, cell*2+20),(20,20,20))
d=ImageDraw.Draw(mont)
for i,n in enumerate(order):
    x,y,w,h=pos[n]
    c=img.crop((int(x*W),int(y*H),int((x+w)*W),int((y+h)*H))).resize((80,80))
    col=i%9; row=i//9
    mont.paste(c,(col*cell+2, row*cell+2+row*10))
    d.text((col*cell+2, row*cell+(row*10)+ (84 if row==0 else -0)),'G%d'%n,fill=(0,255,255))
mont.save('calib/montage_crops.png')
# webp montage for game1 chars
names=['Burnice','Nangong Yu','Rina','Yanagi','Soukaku','Yuzuha','Ellen','Lycaon','Nicole','Alice','Trigger','Astra']
wm=Image.new('RGB',(cell*6,cell*2+20),(20,20,20)); dw=ImageDraw.Draw(wm)
for i,nm in enumerate(names):
    p='web/icons/characters/%s.webp'%nm
    col=i%6; row=i//6
    if os.path.exists(p):
        im=Image.open(p).convert('RGB').resize((80,80)); wm.paste(im,(col*cell+2,row*cell+2+row*10))
    dw.text((col*cell+2,row*cell+(row*10)),nm[:9],fill=(255,255,0))
wm.save('calib/montage_webp.png')
print('saved', mont.size, wm.size)
