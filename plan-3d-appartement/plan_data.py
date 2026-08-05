# -*- coding: utf-8 -*-
"""Source unique de la géométrie et du mobilier de l'appartement.
Coordonnées en mètres, relevées sur le plan d'origine (x vers l'est, y vers le sud).
Alimente à la fois le rendu 3D (data.js) et les planches PDF."""
import math, json

V = {
 "W":(-0.041,-0.041), "N1":(5.861,-2.537), "N2":(13.002,-1.621), "E":(12.277,4.517),
 "B1":(6.849,3.886), "P1":(5.828,4.262), "P2":(5.527,3.712), "P3":(4.625,3.473),
 "B2":(5.098,4.597), "S":(2.380,5.775),
 "A":(2.415,-1.079), "D":(4.048,2.808), "Dw":(1.577,3.847), "Se":(4.844,4.707),
 "G1":(7.817,-2.286), "G2":(9.930,-2.015), "G3":(9.639,0.342), "G4":(7.544,0.022),
 "K1":(9.417,2.143), "K2":(12.515,2.504), "H1":(9.974,2.208), "H4":(9.711,4.219),
 "Ea":(5.379,2.225), "Eb":(6.054,1.921),   # bloc de rangement de l'entrée
}
OUTLINE = ["W","N1","N2","E","B1","P1","P2","P3","B2","S"]

ROOMS = [
 dict(id="sej", name="SÉJOUR", full="Séjour, cuisine et entrée", floor="parquet", ang=-22.9,
      label=(5.30,-0.60),
      poly=["A","N1","G1","G4","G3","K1","H1","H4","B1","P1","P2","P3","Se","D"]),
 dict(id="ch2", name="DRESSING", full="Dressing (chambre 2)", floor="parquet", ang=-22.9,
      label=(2.05,1.35), poly=["W","A","D","Dw"]),
 dict(id="ch1", name="CHAMBRE", full="Chambre", floor="parquet", ang=7.3,
      label=(11.20,0.25), poly=["G2","N2","K2","K1"]),
 dict(id="log", name="LOGGIA", full="Loggia vitrée", floor="parquet", ang=7.3,
      label=(8.78,-1.95), poly=["G1","G2","G3","G4"]),
 dict(id="sdb", name="SALLE DE BAINS", full="Salle de bains", floor="carrelage", ang=6.6,
      label=(11.35,3.15), poly=["H1","K2","E","H4"]),
 dict(id="sde", name="SALLE D'EAU", full="Salle d'eau", floor="carrelage", ang=-23.4,
      label=(3.82,3.92), poly=["Dw","D","Se","S"]),
]
EXTRA_LABELS = [("CUISINE",(8.70,3.35)), ("REPAS",(7.89,1.67)), ("ENTRÉE",(4.95,3.30))]

EXT_T, INT_T, WH = 0.22, 0.09, 1.30

WALLS = [
 dict(a="W", b="N1", t=EXT_T, ext=1, op=[dict(t0=0.80,t1=2.00,kind="french"),
                                         dict(t0=4.30,t1=5.10,kind="win",sill=0.95)]),
 dict(a="N1",b="N2", t=EXT_T, ext=1, op=[dict(t0=1.32,t1=3.95,kind="french"),
                                         dict(t0=4.97,t1=6.29,kind="french")]),
 dict(a="N2",b="E",  t=EXT_T, ext=1, op=[]),
 dict(a="E", b="B1", t=EXT_T, ext=1, op=[dict(t0=1.55,t1=2.42,kind="win",sill=1.00),
                                         dict(t0=2.74,t1=3.10,kind="win",sill=1.15)]),
 dict(a="B1",b="P1", t=EXT_T, ext=1, op=[]),
 dict(a="P1",b="P2", t=EXT_T, ext=1, op=[]),
 dict(a="P2",b="P3", t=EXT_T, ext=1, keep=1,                       # porte d'entrée : jamais masquée
      op=[dict(t0=0.06,t1=0.92,kind="door",swing=1,main=1)]),
 dict(a="P3",b="B2", t=EXT_T, ext=1, op=[]),
 dict(a="B2",b="S",  t=EXT_T, ext=1, op=[dict(t0=1.63,t1=2.25,kind="win",sill=1.05)]),
 dict(a="S", b="W",  t=EXT_T, ext=1, op=[]),
 dict(a="Eb",b="B1", t=INT_T, op=[]),                 # cloison entrée / cuisine
 dict(a="Ea",b="Eb", t=0.07,  op=[]),                 # fond des placards d'entrée
 dict(a="A", b="D",  t=INT_T, op=[dict(t0=2.77,t1=3.63,kind="door",swing=-1)]),
 dict(a="Dw",b="D",  t=INT_T, op=[]),
 dict(a="D", b="Se", t=INT_T, op=[dict(t0=0.10,t1=0.92,kind="door",swing=1)]),
 dict(a="G2",b="K1", t=INT_T, op=[dict(t0=2.61,t1=3.51,kind="door",swing=-1)]),
 dict(a="K1",b="K2", t=INT_T, op=[dict(t0=1.98,t1=2.85,kind="door",swing=-1)]),
 dict(a="H1",b="H4", t=0.10,  op=[]),
 dict(a="G1",b="G4", t=0.06,  op=[dict(t0=0,t1=99,kind="glass")]),
 dict(a="G4",b="G3", t=0.06,  op=[dict(t0=0,t1=99,kind="glass")]),
]

# ---------------------------------------------------------------- repérage
def sub(a,b): return (a[0]-b[0], a[1]-b[1])
def norm(v):
    l=math.hypot(*v); return (v[0]/l, v[1]/l)
def ang(a,b): return math.degrees(math.atan2(b[1]-a[1], b[0]-a[0]))
CEN = (sum(V[k][0] for k in OUTLINE)/len(OUTLINE), sum(V[k][1] for k in OUTLINE)/len(OUTLINE))

def room_centre(rid):
    r = next(x for x in ROOMS if x["id"] == rid)
    pts = [V[k] for k in r["poly"]]
    return (sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts))

def along(ka, kb, t, off, ref=None, room=None):
    """point à la distance t du sommet ka le long de ka→kb, décalé de off vers l'intérieur.
    `room` désigne la pièce vers laquelle décaler (sinon : centre du logement)."""
    if room: ref = room_centre(room)
    a, b = V[ka], V[kb]
    u = norm(sub(b,a)); n = (-u[1], u[0])
    p = (a[0]+u[0]*t, a[1]+u[1]*t)
    r = ref or CEN
    if (p[0]+n[0]-r[0])**2+(p[1]+n[1]-r[1])**2 > (p[0]-r[0])**2+(p[1]-r[1])**2:
        n = (u[1], -u[0])
    return (round(p[0]+n[0]*off,3), round(p[1]+n[1]*off,3))

def wallAng(ka,kb): return round(ang(V[ka],V[kb]),2)

F = []                                   # mobilier
def add(**kw):
    kw["x"]=round(kw["x"],3); kw["y"]=round(kw["y"],3); F.append(kw)
def at(p, **kw): add(x=p[0], y=p[1], **kw)

NW, WE, NO, ES, SU, SO = wallAng("W","N1"), wallAng("W","S"), wallAng("N1","N2"), \
                          wallAng("N2","E"), wallAng("B1","E"), wallAng("B2","S")

# ------------------------------------------------------------------ SÉJOUR
add(t="rug",  x=4.95, y=0.35, yaw=NW, w=2.70, d=2.00, col="beige")
at(along("W","N1",3.50,0.26,room="sej"), t="tv", yaw=NW, w=1.45, d=0.45)
add(t="table", x=4.49, y=0.07, yaw=NW, w=1.20, d=0.70, h=0.40)
add(t="sofa", x=4.90, y=1.15, yaw=round(NW-90,2), w=1.75, d=0.90, seats=2)   # face aux baies
add(t="sofa", x=6.15,y=-0.45, yaw=round(NW+180,2), w=1.65, d=0.90, seats=2)  # retour, face à l'ouest
add(t="plant", x=7.05, y=-1.95, s=1.0)
# coin repas
add(t="table", x=7.89, y=1.67, yaw=SU, w=1.40, d=0.85, h=0.75)
for dx,dy,ry in ((-0.02,-0.62,SU+90),(0.12,0.62,SU-90),(-0.82,-0.05,SU),(0.86,0.15,SU+180)):
    add(t="chair", x=7.89+dx, y=1.67+dy, yaw=round(ry,2))
# ----------------------------------------------------------------- CUISINE
at(along("B1","E",0.62,0.33,room="sej"), t="cabinet", yaw=SU, w=0.65, d=0.62, h=1.28)
add(t="kitchen", x=0, y=0, ka="B1", kb="E", t0=1.00, t1=2.90, off=0.33, yaw=SU)
# ------------------------------------------------------------------ ENTRÉE
add(t="wardrobe", x=5.918, y=2.583, yaw=68.2, w=1.09, d=0.72, h=1.30, doors=2)
add(t="wardrobe", x=6.375, y=3.520, yaw=68.2, w=0.58, d=0.52, h=1.30, doors=1)
# ------------------------------------------- CHAMBRE 2 → DRESSING + BUREAU
add(t="rug", x=2.20, y=2.05, yaw=NW, w=2.10, d=1.50, col="greige")
at(along("W","S",2.50,0.31,room="ch2"), t="wardrobe", yaw=WE, w=3.10, d=0.60, h=1.28, doors=4)
at(along("A","D",2.05,0.32,room="ch2"), t="wardrobe", yaw=wallAng("A","D"), w=1.10, d=0.60, h=1.28, doors=2)
at(along("Dw","D",1.34,0.30,room="ch2"), t="wardrobe", yaw=wallAng("Dw","D"), w=2.30, d=0.58, h=1.28, doors=3)
at(along("A","D",0.78,0.30,room="ch2"), t="desk", yaw=wallAng("A","D"), w=1.20, d=0.60, h=0.74)
at(along("A","D",0.78,0.90,room="ch2"), t="chair", yaw=round(wallAng("A","D")-90,2))
add(t="bench", x=2.20, y=2.05, yaw=NW, w=1.10, d=0.42, h=0.44)
add(t="plant", x=0.85, y=0.55, s=0.85)
# -------------------------------------------------------------- SALLE D'EAU
at(along("B2","S",0.50,0.28,room="sde"), t="basin", yaw=SO-180, w=0.80)
at(along("B2","S",1.15,0.35,room="sde"), t="wc", yaw=SO-180)
add(t="shower", x=2.90, y=4.68, yaw=round(SO-180,2), w=0.90, d=0.90)
at(along("W","S",4.85,0.34,room="sde"), t="appliance", yaw=WE, stack=1)
# ------------------------------------------------------------------ LOGGIA
add(t="roundtable", x=8.80, y=-0.86, r=0.35)
add(t="chair", x=8.31, y=-0.92, yaw=NO+90)
add(t="chair", x=9.29, y=-0.80, yaw=NO-90)
add(t="plant", x=9.35, y=-0.20, s=0.8)
# ----------------------------------------------------------------- CHAMBRE
add(t="rug", x=10.95,y=0.05, yaw=NO, w=2.60, d=2.20, col="greige")
add(t="bed", x=10.809,y=0.008, yaw=7.03, w=1.45, l=2.00)
at(along("N2","E",2.05,0.30,room="ch1"), t="wardrobe", yaw=ES, w=1.90, d=0.55, h=1.28, doors=3)
at(along("K1","K2",1.05,0.30,room="ch1"), t="wardrobe", yaw=wallAng("K1","K2"), w=1.60, d=0.60, h=1.22, doors=2)
# ----------------------------------------------------------- SALLE DE BAINS
at(along("H1","H4",1.05,0.42,room="sdb"), t="tub", yaw=wallAng("H1","H4"), w=0.75, l=1.65)
at(along("E","B1",1.15,0.35,room="sdb"), t="wc", yaw=SU)
at(along("E","B1",0.48,0.28,room="sdb"), t="basin", yaw=SU, w=0.85)
at(along("H1","H4",0.36,0.30,room="sdb"), t="cabinet", yaw=wallAng("H1","H4"), w=0.55, d=0.42, h=0.95)

# ------------------------------------------------------------------ export
def poly_area(pts):
    s=0
    for i in range(len(pts)):
        a,b = pts[i], pts[(i+1)%len(pts)]
        s += a[0]*b[1]-b[0]*a[1]
    return abs(s)/2

def areas():
    return {r["id"]: round(poly_area([V[k] for k in r["poly"]]),2) for r in ROOMS}

DATA = dict(V=V, OUTLINE=OUTLINE, ROOMS=ROOMS, EXTRA=EXTRA_LABELS,
            WALLS=WALLS, F=F, EXT_T=EXT_T, INT_T=INT_T, WH=WH)

if __name__ == "__main__":
    a = areas(); print(a, "total", round(sum(a.values()),2))
    print("contour", round(poly_area([V[k] for k in OUTLINE]),2))
    open("data.json","w").write(json.dumps(DATA, ensure_ascii=False))
    print("meubles:", len(F))
