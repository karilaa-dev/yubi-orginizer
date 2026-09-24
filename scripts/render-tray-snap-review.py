"""Render review views and a section directly from the exported binary STL meshes."""
from pathlib import Path
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/snap-fit-sample'
def mesh(name):
    b = (OUT / name).read_bytes()
    return np.array([struct.unpack_from('<9f', b, 96+50*i) for i in range(struct.unpack_from('<I', b, 80)[0])]).reshape(-1,3,3)
tray = mesh('fit-tray-snap-lower.stl')
lid = mesh('fit-tray-snap-upper.stl')
img = Image.new('RGB', (1800, 1120), '#f1f4f5')
d = ImageDraw.Draw(img)
def review_font(size):
    for name in ('DejaVuSans.ttf', 'Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)
font, small, large = (review_font(size) for size in (25, 19, 34))
d.text((45,30), 'Enclosure snap-fit | exported geometry', fill='#1d3039', font=large)
def render(v, center, scale, underside, color):
    u = np.array([.832,.555,0.]); up = np.array([-.31,.465,.83]) * (-1 if underside else 1)
    camera = np.cross(u,up); R = np.array([u,up,camera])
    p = v @ R.T
    p -= (p.reshape(-1,3).max(axis=0)+p.reshape(-1,3).min(axis=0))/2
    pixels = np.asarray(img).copy(); depth = np.full((img.height,img.width),-np.inf)
    light = camera + np.array([0,0,-.7 if underside else .7]); light /= np.linalg.norm(light)
    for tri,proj in zip(v,p):
        n = np.cross(tri[1]-tri[0],tri[2]-tri[0]); n /= np.linalg.norm(n) or 1
        if n @ camera <= 0: continue
        x = center[0] + scale*proj[:,0]; y = center[1] - scale*proj[:,1]
        xmin=max(0,int(np.floor(x.min())));xmax=min(img.width-1,int(np.ceil(x.max())))
        ymin=max(90,int(np.floor(y.min())));ymax=min(610,int(np.ceil(y.max())))
        if xmax<xmin or ymax<ymin:continue
        xx,yy=np.meshgrid(np.arange(xmin,xmax+1)+.5,np.arange(ymin,ymax+1)+.5)
        denom=(y[1]-y[2])*(x[0]-x[2])+(x[2]-x[1])*(y[0]-y[2])
        if abs(denom)<1e-9:continue
        a=((y[1]-y[2])*(xx-x[2])+(x[2]-x[1])*(yy-y[2]))/denom
        b=((y[2]-y[0])*(xx-x[2])+(x[0]-x[2])*(yy-y[2]))/denom;c=1-a-b
        z=a*proj[0,2]+b*proj[1,2]+c*proj[2,2]
        view=depth[ymin:ymax+1,xmin:xmax+1];mask=(a>=0)&(b>=0)&(c>=0)&(z>view)
        view[mask]=z[mask]
        shade=.60+.40*max(0,float(n@light))
        pixels[ymin:ymax+1,xmin:xmax+1][mask]=tuple(int(min(255,c*shade)) for c in color)
    img.paste(Image.fromarray(pixels))
render(tray,(460,345),9,False,(179,202,191))
render(lid,(1330,345),9,True,(117,168,190))
d.text((45,625),'Four solid catches, inner locating rim and open channel',fill='#1d3039',font=font)
d.text((970,625),'Underside: continuous skirt and recessed receivers',fill='#1d3039',font=font)

def section(v, y):
    edges=[]
    for t in v:
        q=[]
        for a,b in [(t[0],t[1]),(t[1],t[2]),(t[2],t[0])]:
            if (a[1]<y)!=(b[1]<y):
                p=a+(b-a)*(y-a[1])/(b[1]-a[1]);q.append(tuple(np.round(p[[0,2]],5)))
        if len(q)==2 and q[0]!=q[1]:edges.append(q)
    adjacency={}
    for a,b in edges:
        adjacency.setdefault(a,[]).append(b);adjacency.setdefault(b,[]).append(a)
    loops=[]
    while adjacency:
        start=next(iter(adjacency));p=start;loop=[p]
        while adjacency.get(p):
            q=adjacency[p].pop()
            if not adjacency[p]:del adjacency[p]
            adjacency[q].remove(p)
            if not adjacency[q]:del adjacency[q]
            loop.append(q);p=q
            if p==start:break
        if len(loop)>2:loops.append(loop)
    return loops
pitch = float(tray[:,:,2].max()) - 4
width=float(tray[:,:,0].max())*2
panel=Image.new('RGB',(820,385),'#ffffff');pd=ImageDraw.Draw(panel)
def point(x,z):return (int((x-(width/2-12))*29+35),int(345-(z-8)*17))
for v,color,offset in [(tray,'#b3cabb',0),(lid,'#75a8be',pitch)]:
    for loop in section(v,(60-2*8.6)/4):
        pd.polygon([point(x,z+offset) for x,z in loop], fill=color, outline='#324956', width=2)
img.paste(panel,(40,700))
d.text((905,740),'Section through one catch, fully seated',fill='#1d3039',font=font)
d.text((905,800),'Solid catch base: 3 mm thick x 8 mm wide',fill='#344d59',font=small)
d.text((905,840),'Nominal engagement: 0.2 mm | 45-degree ramps',fill='#344d59',font=small)
d.text((905,880),'Receiver skirt separates from the central key deck',fill='#344d59',font=small)
d.text((905,920),'Prototype for PLA / PLA Matte; physical fit untested',fill='#344d59',font=small)
d.text((905,995),'Views use the same meshes as the downloadable 3MF.',fill='#344d59',font=small)
img.save(OUT / 'geometry-review.png')
print(OUT / 'geometry-review.png')
