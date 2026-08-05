# -*- coding: utf-8 -*-
"""Planches 2D à l'échelle (PDF) — appartement 74 m².
Deux planches par fichier : plan meublé et plan de base coté.
Géométrie identique au rendu 3D (plan_data.py)."""
import math
from reportlab.pdfgen import canvas as rcanvas
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
import plan_data as PD

V, OUTLINE, ROOMS, WALLS, F = PD.V, PD.OUTLINE, PD.ROOMS, PD.WALLS, PD.F
EXT_T = PD.EXT_T
CEN = PD.CEN

# ------------------------------------------------------------------ palette
INK      = (0.11, 0.13, 0.15)
POCHE    = (0.22, 0.24, 0.26)     # murs porteurs
POCHE_I  = (0.42, 0.45, 0.47)     # cloisons
FURN     = (0.33, 0.36, 0.38)
FURN_LT  = (0.58, 0.61, 0.63)
GLASS    = (0.35, 0.52, 0.62)
DIMC     = (0.18, 0.36, 0.48)
GREY     = (0.55, 0.58, 0.60)

def unit(a, b):
    d = (b[0]-a[0], b[1]-a[1]); l = math.hypot(*d); return (d[0]/l, d[1]/l), l
def outward(a, b, ref=CEN):
    (ux, uy), _ = unit(a, b); n = (-uy, ux)
    m = ((a[0]+b[0])/2, (a[1]+b[1])/2)
    if (m[0]+n[0]-ref[0])**2+(m[1]+n[1]-ref[1])**2 < (m[0]-ref[0])**2+(m[1]-ref[1])**2:
        n = (uy, -ux)
    return n

class Sheet:
    def __init__(self, c, k, ox, oy):
        self.c, self.k, self.ox, self.oy = c, k, ox, oy
    def P(self, p):                      # mètres -> points PDF
        return (self.ox + p[0]*self.k, self.oy - p[1]*self.k)
    def poly(self, pts, fill=None, stroke=None, lw=0.4, close=1, dash=None):
        c = self.c; p = c.beginPath(); q = [self.P(x) for x in pts]
        p.moveTo(*q[0])
        for x in q[1:]: p.lineTo(*x)
        if close: p.close()
        c.saveState()
        if dash: c.setDash(dash)
        if fill: c.setFillColorRGB(*fill)
        if stroke: c.setStrokeColorRGB(*stroke); c.setLineWidth(lw)
        c.drawPath(p, stroke=1 if stroke else 0, fill=1 if fill else 0)
        c.restoreState()
    def line(self, a, b, col=INK, lw=0.4, dash=None):
        c = self.c; c.saveState(); c.setStrokeColorRGB(*col); c.setLineWidth(lw)
        if dash: c.setDash(dash)
        c.line(*self.P(a), *self.P(b)); c.restoreState()
    def circle(self, ctr, r, fill=None, stroke=INK, lw=0.4):
        c = self.c; c.saveState()
        if fill: c.setFillColorRGB(*fill)
        if stroke: c.setStrokeColorRGB(*stroke); c.setLineWidth(lw)
        x, y = self.P(ctr)
        c.circle(x, y, r*self.k, stroke=1 if stroke else 0, fill=1 if fill else 0)
        c.restoreState()
    def arc(self, ctr, r, a0, a1, col=GREY, lw=0.35):
        c = self.c; c.saveState(); c.setStrokeColorRGB(*col); c.setLineWidth(lw)
        x, y = self.P(ctr); rr = r*self.k
        p = c.beginPath()
        n = 22
        for i in range(n+1):
            a = math.radians(a0 + (a1-a0)*i/n)
            xx, yy = ctr[0]+math.cos(a)*r, ctr[1]+math.sin(a)*r
            px, py = self.P((xx, yy))
            p.moveTo(px, py) if i == 0 else p.lineTo(px, py)
        c.drawPath(p, stroke=1, fill=0); c.restoreState()
    def rect(self, cx, cy, w, d, yaw, **kw):
        r = math.radians(yaw); co, si = math.cos(r), math.sin(r)
        pts = [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]
        self.poly([(cx+x*co-y*si, cy+x*si+y*co) for x, y in pts], **kw)
    def text(self, p, s, size=6, col=INK, anchor="c", font="Helvetica", dy=0):
        c = self.c; c.saveState(); c.setFillColorRGB(*col); c.setFont(font, size)
        x, y = self.P(p); y += dy
        (c.drawCentredString if anchor == "c" else
         c.drawRightString if anchor == "r" else c.drawString)(x, y, s)
        c.restoreState()

# ------------------------------------------------------------------- murs 2D
def wall_spans(w):
    """renvoie (segments pleins, ouvertures) en coordonnées le long du mur"""
    a, b = V[w["a"]], V[w["b"]]
    (ux, uy), L = unit(a, b)
    n = outward(a, b) if w.get("ext") else (-uy, ux)
    o0, o1 = (0, w["t"]) if w.get("ext") else (-w["t"]/2, w["t"]/2)
    at = lambda t, o: (a[0]+ux*t+n[0]*o, a[1]+uy*t+n[1]*o)
    ops = sorted([dict(o, t0=max(0, o["t0"]), t1=min(L, o["t1"])) for o in w["op"]],
                 key=lambda o: o["t0"])
    solids, cur = [], 0.0
    for o in ops:
        if o["t0"] > cur+0.005: solids.append((cur, o["t0"]))
        cur = max(cur, o["t1"])
    if cur < L-0.005: solids.append((cur, L))
    return at, ops, solids, L, (ux, uy), n, o0, o1

def corner_patches(sh):
    """comble les angles rentrants entre deux murs de façade dessinés vers l'extérieur"""
    n = len(OUTLINE)
    for i in range(n):
        a, b, c = V[OUTLINE[i-1]], V[OUTLINE[i]], V[OUTLINE[(i+1) % n]]
        na, nc = outward(a, b), outward(b, c)
        t = EXT_T
        p1 = (b[0]+na[0]*t, b[1]+na[1]*t)
        p2 = (b[0]+nc[0]*t, b[1]+nc[1]*t)
        mid = ((na[0]+nc[0])/2, (na[1]+nc[1])/2)
        m = math.hypot(*mid)
        if m < 1e-6: continue
        p3 = (b[0]+mid[0]/m*t*1.02, b[1]+mid[1]/m*t*1.02)
        sh.poly([b, p1, p3, p2], fill=POCHE)

def draw_walls(sh):
    for w in WALLS:
        at, ops, solids, L, u, n, o0, o1 = wall_spans(w)
        col = POCHE if w.get("ext") else POCHE_I
        for (t0, t1) in solids:
            sh.poly([at(t0,o0), at(t1,o0), at(t1,o1), at(t0,o1)], fill=col)
        for o in ops:
            q = [at(o["t0"],o0), at(o["t1"],o0), at(o["t1"],o1), at(o["t0"],o1)]
            if o["kind"] in ("win", "glass", "french"):
                sh.poly(q, fill=(1,1,1), stroke=None)
                e = 0.30 if o["kind"] == "win" else 0.34
                sh.line(at(o["t0"],o0+w["t"]*e), at(o["t1"],o0+w["t"]*e), GLASS, 0.5)
                sh.line(at(o["t0"],o0+w["t"]*(1-e)), at(o["t1"],o0+w["t"]*(1-e)), GLASS, 0.5)
                for t in (o["t0"], o["t1"]):
                    sh.line(at(t,o0), at(t,o1), POCHE, 0.4)
            else:                                            # porte
                sh.poly(q, fill=(1,1,1), stroke=None)
                for t in (o["t0"], o["t1"]):
                    sh.line(at(t,o0), at(t,o1), col, 0.5)
                sw = o.get("swing", 1)
                wD = o["t1"]-o["t0"]
                hinge = at(o["t0"] if sw > 0 else o["t1"], (o0+o1)/2)
                base = math.degrees(math.atan2(u[1], u[0])) + (0 if sw > 0 else 180)
                th = math.radians(base + sw*88)
                leaf = (hinge[0]+math.cos(th)*wD, hinge[1]+math.sin(th)*wD)
                lt = math.radians(base + sw*88 + 90)
                e = 0.045
                sh.poly([hinge, leaf,
                         (leaf[0]+math.cos(lt)*e, leaf[1]+math.sin(lt)*e),
                         (hinge[0]+math.cos(lt)*e, hinge[1]+math.sin(lt)*e)],
                        fill=POCHE_I, stroke=INK, lw=0.35)
                sh.arc(hinge, wD, -base, -(base + sw*88), col=(0.62,0.65,0.67), lw=0.5)

def draw_rooms(sh, furnished=True):
    for r in ROOMS:
        pts = [V[k] for k in r["poly"]]
        sh.poly(pts, fill=(0.985, 0.978, 0.965) if r["floor"] == "parquet" else (0.955,0.955,0.945),
                stroke=None)

# ------------------------------------------------------------- mobilier 2D
def rot(cx, cy, w, d, yaw):
    r = math.radians(yaw); co, si = math.cos(r), math.sin(r)
    return [(cx+x*co-y*si, cy+x*si+y*co) for x, y in
            [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]

def draw_furniture(sh):
    for f in F:
        t = f["t"]; x, y = f["x"], f["y"]; yaw = f.get("yaw", 0)
        if t == "rug":
            sh.rect(x, y, f["w"], f["d"], yaw, stroke=FURN_LT, lw=0.35, dash=(2.4,2.4))
        elif t == "bed":
            w, l = f["w"], f["l"]
            sh.rect(x, y, w, l, yaw-90, fill=(1,1,1), stroke=FURN, lw=0.5)
            r = math.radians(yaw); ux, uy = math.cos(r), math.sin(r)
            sh.rect(x-ux*(l/2-0.20), y-uy*(l/2-0.20), w-0.10, 0.34, yaw-90,
                    stroke=FURN, lw=0.35)
            sh.line((x-ux*(l/2-0.42), y-uy*(l/2-0.42)),
                    (x+ux*(l/2), y+uy*(l/2)), FURN_LT, 0.3)
        elif t == "sofa":
            w, d = f["w"], f["d"]
            sh.rect(x, y, w, d, yaw+90, fill=(1,1,1), stroke=FURN, lw=0.5)
            r = math.radians(yaw); ux, uy = math.cos(r), math.sin(r)
            sh.rect(x-ux*(d/2-0.11), y-uy*(d/2-0.11), w, 0.22, yaw+90, stroke=FURN, lw=0.35)
            n = f.get("seats", 2)
            for i in range(1, n):
                s = (i/n-0.5)*w
                vx, vy = -uy, ux
                sh.line((x+vx*s-ux*(d/2-0.24), y+vy*s-uy*(d/2-0.24)),
                        (x+vx*s+ux*(d/2), y+vy*s+uy*(d/2)), FURN_LT, 0.3)
        elif t in ("table", "desk", "bench", "cabinet", "wardrobe", "tv"):
            w = f.get("w", 0.6); d = f.get("d", 0.5)
            sh.rect(x, y, w, d, yaw, fill=(1,1,1), stroke=FURN, lw=0.5)
            if t in ("wardrobe", "cabinet"):
                r = math.radians(yaw); ux, uy = math.cos(r), math.sin(r); vx, vy = -uy, ux
                n = f.get("doors", max(2, round(w/0.6)))
                for i in range(1, n):
                    s = (i/n-0.5)*w
                    sh.line((x+ux*s-vx*d/2, y+uy*s-vy*d/2),
                            (x+ux*s+vx*d/2, y+uy*s+vy*d/2), FURN_LT, 0.3)
                sh.line((x-ux*w/2+vx*d/2*0.55, y-uy*w/2+vy*d/2*0.55),
                        (x+ux*w/2+vx*d/2*0.55, y+uy*w/2+vy*d/2*0.55), FURN_LT, 0.3)
            if t == "tv":
                r = math.radians(yaw); vx, vy = -math.sin(r), math.cos(r)
                sh.line((x-math.cos(r)*w*0.28+vx*d*0.55, y-math.sin(r)*w*0.28+vy*d*0.55),
                        (x+math.cos(r)*w*0.28+vx*d*0.55, y+math.sin(r)*w*0.28+vy*d*0.55), INK, 1.1)
        elif t == "chair":
            sh.rect(x, y, 0.44, 0.44, yaw, fill=(1,1,1), stroke=FURN, lw=0.4)
            r = math.radians(yaw)
            sh.rect(x-math.cos(r)*0.20, y-math.sin(r)*0.20, 0.06, 0.42, yaw, fill=FURN, stroke=None)
        elif t == "roundtable":
            sh.circle((x, y), f["r"], fill=(1,1,1), stroke=FURN, lw=0.5)
        elif t == "plant":
            sh.circle((x, y), 0.22*f.get("s", 1), stroke=FURN_LT, lw=0.4)
            sh.circle((x, y), 0.10*f.get("s", 1), stroke=FURN_LT, lw=0.3)
        elif t == "tub":
            w, l = f["w"], f["l"]
            sh.rect(x, y, w, l, yaw-90, fill=(1,1,1), stroke=FURN, lw=0.5)
            sh.rect(x, y, w-0.13, l-0.13, yaw-90, stroke=FURN_LT, lw=0.35)
        elif t == "shower":
            sh.rect(x, y, f["w"], f["d"], yaw, fill=(1,1,1), stroke=FURN, lw=0.5)
            c = rot(x, y, f["w"], f["d"], yaw)
            sh.line(c[0], c[2], FURN_LT, 0.3); sh.line(c[1], c[3], FURN_LT, 0.3)
        elif t == "wc":
            r = math.radians(yaw); ux, uy = math.cos(r), math.sin(r)
            sh.rect(x-ux*0.22, y-uy*0.22, 0.16, 0.44, yaw, fill=(1,1,1), stroke=FURN, lw=0.4)
            sh.circle((x+ux*0.04, y+uy*0.04), 0.19, fill=(1,1,1), stroke=FURN, lw=0.5)
        elif t == "basin":
            w = f.get("w", 0.8)
            sh.rect(x, y, w, 0.46, yaw, fill=(1,1,1), stroke=FURN, lw=0.5)
            sh.rect(x, y, w-0.20, 0.28, yaw, stroke=FURN_LT, lw=0.35)
        elif t == "appliance":
            for i in range(2 if f.get("stack") else 1):
                sh.rect(x, y, 0.60, 0.60, yaw, fill=(1,1,1), stroke=FURN, lw=0.5)
            sh.circle((x, y), 0.16, stroke=FURN_LT, lw=0.35)
            sh.text((x, y), "ML", 4.2, FURN, dy=-1.6)
        elif t == "kitchen":
            a, b = V[f["ka"]], V[f["kb"]]
            (ux, uy), _ = unit(a, b); n = outward(a, b)
            n = (-n[0], -n[1])
            p0 = (a[0]+ux*f["t0"]+n[0]*f["off"], a[1]+uy*f["t0"]+n[1]*f["off"])
            p1 = (a[0]+ux*f["t1"]+n[0]*f["off"], a[1]+uy*f["t1"]+n[1]*f["off"])
            cx, cy = (p0[0]+p1[0])/2, (p0[1]+p1[1])/2
            L = math.hypot(p1[0]-p0[0], p1[1]-p0[1])
            sh.rect(cx, cy, L, 0.62, f["yaw"], fill=(1,1,1), stroke=FURN, lw=0.5)
            for frac, kind in ((0.24, "hob"), (0.52, "lv"), (0.80, "sink")):
                q = (p0[0]+(p1[0]-p0[0])*frac, p0[1]+(p1[1]-p0[1])*frac)
                if kind == "hob":
                    for dx in (-0.11, 0.11):
                        for dy in (-0.11, 0.11):
                            sh.circle((q[0]+dx*ux-dy*uy, q[1]+dx*uy+dy*ux), 0.075, stroke=FURN, lw=0.35)
                elif kind == "lv":
                    sh.rect(q[0], q[1], 0.58, 0.56, f["yaw"], stroke=FURN_LT, lw=0.35)
                    sh.text(q, "LV", 4.2, FURN, dy=-1.6)
                else:
                    sh.rect(q[0], q[1], 0.46, 0.38, f["yaw"], stroke=FURN, lw=0.4)
                    sh.circle(q, 0.05, stroke=FURN, lw=0.3)

# --------------------------------------------------------------- cotations
def dim_chain(sh, a, b, label, off=0.62, col=DIMC, size=6.4):
    (ux, uy), L = unit(a, b); n = outward(a, b)
    A = (a[0]+n[0]*off, a[1]+n[1]*off); B = (b[0]+n[0]*off, b[1]+n[1]*off)
    sh.line(A, B, col, 0.45)
    for p, q in ((a, A), (b, B)):
        sh.line((p[0]+n[0]*0.10, p[1]+n[1]*0.10), (q[0]+n[0]*0.14, q[1]+n[1]*0.14), col, 0.3)
    for P in (A, B):                                       # tirets à 45°
        sh.line((P[0]-ux*0.10-n[0]*0.10, P[1]-uy*0.10-n[1]*0.10),
                (P[0]+ux*0.10+n[0]*0.10, P[1]+uy*0.10+n[1]*0.10), col, 0.6)
    m = ((A[0]+B[0])/2, (A[1]+B[1])/2)
    ang = math.degrees(math.atan2(-uy, ux))
    if ang > 90: ang -= 180
    if ang < -90: ang += 180
    c = sh.c; c.saveState(); c.setFillColorRGB(*col); c.setFont("Helvetica-Bold", size)
    px, py = sh.P(m); c.translate(px, py); c.rotate(ang)
    c.drawCentredString(0, 2.2, label); c.restoreState()

def draw_dims(sh, full=True):
    """chaîne extérieure ; sur la planche meublée on ne cote que les grandes façades"""
    for i in range(len(OUTLINE)):
        a, b = V[OUTLINE[i]], V[OUTLINE[(i+1) % len(OUTLINE)]]
        _, L = unit(a, b)
        if L < (0.55 if full else 2.0): continue
        off = 0.60 if L > 2.5 else (1.15 if i % 2 else 1.75)
        dim_chain(sh, a, b, ("%.2f" % L).replace(".", ","), off=off)

# --------------------------------------------------------------- habillage
def north(c, x, y, r=9*mm):
    c.saveState(); c.translate(x, y)
    c.setStrokeColorRGB(*GREY); c.setLineWidth(0.5); c.circle(0, 0, r, stroke=1, fill=0)
    c.setFillColorRGB(*INK)
    p = c.beginPath(); p.moveTo(0, r*0.86); p.lineTo(r*0.30, -r*0.42)
    p.lineTo(0, -r*0.18); p.lineTo(-r*0.30, -r*0.42); p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.setFont("Helvetica-Bold", 7); c.drawCentredString(0, r+2.5, "N")
    c.restoreState()

def scalebar(c, x, y, k, seg=1.0, n=5):
    c.saveState(); c.setLineWidth(0.5)
    for i in range(n):
        c.setFillColorRGB(*(INK if i % 2 == 0 else (1, 1, 1)))
        c.setStrokeColorRGB(*INK)
        c.rect(x+i*seg*k, y, seg*k, 2.0*mm, fill=1, stroke=1)
    c.setFillColorRGB(*INK); c.setFont("Helvetica", 6)
    for i in range(n+1):
        c.drawCentredString(x+i*seg*k, y-4.2*mm, "%d" % int(i*seg))
    c.drawString(x+n*seg*k+3, y-0.4*mm, "m")
    c.restoreState()

def cartouche(c, W, H, mgn, title, sub, scale_txt, page, npages):
    w, h = 96*mm, 26*mm
    x, y = W-mgn-w, mgn
    c.saveState()
    c.setStrokeColorRGB(*INK); c.setLineWidth(0.9); c.rect(x, y, w, h, fill=0, stroke=1)
    c.setLineWidth(0.4); c.line(x, y+h-11*mm, x+w, y+h-11*mm); c.line(x+62*mm, y, x+62*mm, y+h-11*mm)
    c.setFillColorRGB(*INK); c.setFont("Helvetica-Bold", 9.5)
    c.drawString(x+3.4*mm, y+h-7.6*mm, title)
    c.setFont("Helvetica", 7); c.setFillColorRGB(*GREY)
    c.drawString(x+3.4*mm, y+h-16.6*mm, sub)
    c.setFont("Helvetica", 6.2)
    c.drawString(x+3.4*mm, y+3.2*mm, "Relevé sur plan d'origine · cotes en mètres")
    c.setFillColorRGB(*INK); c.setFont("Helvetica-Bold", 12)
    c.drawString(x+65.5*mm, y+h-19.5*mm, scale_txt)
    c.setFont("Helvetica", 6.2); c.setFillColorRGB(*GREY)
    c.drawString(x+65.5*mm, y+3.2*mm, "Planche %d/%d" % (page, npages))
    c.restoreState()

# ---------------------------------------------------------------- planches
def obb(r):
    """dimensions de la pièce mesurées dans l'axe de ses murs"""
    th = math.radians(r["ang"]); co, si = math.cos(th), math.sin(th)
    pts = [V[k] for k in r["poly"]]
    u = [p[0]*co + p[1]*si for p in pts]
    v = [-p[0]*si + p[1]*co for p in pts]
    a, b = max(u)-min(u), max(v)-min(v)
    return (a, b) if a >= b else (b, a)

def bbox():
    xs = [V[k][0] for k in OUTLINE]; ys = [V[k][1] for k in OUTLINE]
    return min(xs), max(xs), min(ys), max(ys)

def table_surfaces(c, x, y, small=False):
    a = PD.areas(); rows = sorted(ROOMS, key=lambda r: -a[r["id"]])
    fs = 6.0 if small else 7.0
    c.saveState(); c.setFillColorRGB(*GREY); c.setFont("Helvetica-Bold", fs-1.2)
    c.drawString(x, y, "SURFACES")
    c.setStrokeColorRGB(*GREY); c.setLineWidth(0.4)
    c.line(x, y-2.0*mm, x+46*mm, y-2.0*mm)
    yy = y - 5.6*mm
    for r in rows:
        c.setFillColorRGB(*INK); c.setFont("Helvetica", fs)
        c.drawString(x, yy, r["full"])
        c.setFont("Helvetica-Bold", fs)
        c.drawRightString(x+46*mm, yy, ("%.1f m²" % a[r["id"]]).replace(".", ","))
        yy -= 4.3*mm
    c.setStrokeColorRGB(*INK); c.setLineWidth(0.8); c.line(x, yy+2.4*mm, x+46*mm, yy+2.4*mm)
    c.setFillColorRGB(*INK); c.setFont("Helvetica-Bold", fs)
    c.drawString(x, yy-1.6*mm, "Total")
    c.drawRightString(x+46*mm, yy-1.6*mm, ("%.1f m²" % sum(a.values())).replace(".", ","))
    c.restoreState()

def sheet(c, W, H, k, title, sub, scale_txt, page, npages, furnished):
    mgn = 12*mm
    x0, x1, y0, y1 = bbox()
    pad = 1.15                                   # place pour les cotes
    bw, bh = (x1-x0+2*pad)*k, (y1-y0+2*pad)*k
    top = H - mgn - 3*mm
    avail_h = top - (mgn + 30*mm)
    ox = mgn + (W-2*mgn-bw)/2 + pad*k - x0*k
    oy = mgn + 30*mm + (avail_h-bh)/2 + bh - pad*k + y0*k
    sh = Sheet(c, k, ox, oy)

    draw_rooms(sh)
    if furnished: draw_furniture(sh)
    draw_walls(sh)
    corner_patches(sh)
    draw_dims(sh, full=not furnished)

    areas = PD.areas()
    for r in ROOMS:
        p = tuple(r["label"])
        sh.text(p, r["name"], 7.6 if furnished else 7.0, INK, font="Helvetica-Bold", dy=2.5)
        sh.text(p, ("%.1f m²" % areas[r["id"]]).replace(".", ","), 6.4, GREY, dy=-6.5)
        if not furnished:
            a, b = obb(r)
            sh.text(p, "%s × %s m" % (("%.2f" % a).replace(".", ","),
                                      ("%.2f" % b).replace(".", ",")), 6.0, DIMC, dy=-15.5)
    if furnished:
        for name, p in PD.EXTRA_LABELS:
            sh.text(tuple(p), name, 6.6, GREY, font="Helvetica-Bold")

    table_surfaces(c, mgn+4*mm, top-6*mm, small=(k < 20*mm))
    north(c, W-mgn-14*mm, top-14*mm)
    scalebar(c, mgn+2*mm, mgn+10*mm, k)
    cartouche(c, W, H, mgn, title, sub, scale_txt, page, npages)
    c.setStrokeColorRGB(*GREY); c.setLineWidth(0.6)
    c.rect(mgn*0.55, mgn*0.55, W-1.1*mgn, H-1.1*mgn, fill=0, stroke=1)
    c.showPage()

def build(path, page_w, page_h, scale_den):
    k = mm / (scale_den/1000.0)                  # points par mètre
    c = rcanvas.Canvas(path, pagesize=(page_w, page_h))
    c.setTitle("Appartement 74 m² — plan 2D 1:%d" % scale_den)
    sheet(c, page_w, page_h, k, "Appartement 3 pièces — 74 m²",
          "Plan meublé",
          "1:%d" % scale_den, 1, 2, True)
    sheet(c, page_w, page_h, k, "Appartement 3 pièces — 74 m²",
          "Plan de base coté",
          "1:%d" % scale_den, 2, 2, False)
    c.save()
    print("écrit", path)

if __name__ == "__main__":
    A3 = (420*mm, 297*mm); A4 = (297*mm, 210*mm)
    build("plan-2d-A3-1-50.pdf", *A3, 50)
    build("plan-2d-A4-1-75.pdf", *A4, 75)
