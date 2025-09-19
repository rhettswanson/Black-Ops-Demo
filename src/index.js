/* Black Ops Camera Demo — WebComponent + Three bridge
   - Stylized cameras + FOV frustums
   - UI controls (HFOV, NEAR/FAR, YAW, TILT, FWD, UP)
   - Robust occlusion (raycast only)
*/

__webpack_public_path__ =
  location.hostname.endsWith('github.io') ? '/Black-Ops-Demo/' : '/';

import '@matterport/webcomponent';
import * as THREE from 'three';

console.log('[BLACKOPS] bundle booted');
document.title = 'Black Ops Cams';

/* ---------- Per-camera presets (UPDATED to your screenshots) ---------- */
const PRESETS = {
  // Cam 1
  'Surveillance Camera 1': {
    hFovDeg: 23, near: 0.12, far: 7,
    yawDeg: 4, tiltDeg: 22,
    offsetFwd: 0.61, offsetUp: 0.00,
  },
  // Cam 2
  'Surveillance Camera 2': {
    hFovDeg: 23, near: 0.12, far: 7,
    yawDeg: 3, tiltDeg: 15,
    offsetFwd: 0.34, offsetUp: 0.00,
  },
  // Cam 3
  'Surveillance Camera 3': {
    hFovDeg: 25, near: 0.12, far: 9,
    yawDeg: 3, tiltDeg: 1,
    offsetFwd: 0.12, offsetUp: 0.00,
  },
  // Cam 4
  'Surveillance Camera 4': {
    hFovDeg: 21, near: 0.12, far: 7,
    yawDeg: 40, tiltDeg: 22,
    offsetFwd: 0.12, offsetUp: 0.00,
  },
  // Cam 5
  'Surveillance Camera 5': {
    hFovDeg: 19, near: 0.12, far: 4,
    yawDeg: 41, tiltDeg: 1,
    offsetFwd: 0.12, offsetUp: 0.18,
  },
};

const CAMERA_TAGS = new Set(Object.keys(PRESETS));

const DEFAULT_CFG = {
  aspect: 16 / 9,
  hFovDeg: 32,
  near: 0.12,
  far: 19,
  nearApertureScale: 0.22,

  sweepDeg: 122,
  yawDeg: 93,
  tiltDeg: 10,
  yawSpeedDeg: 14,

  fovColor: 0x00ff00,
  edgeRadius: 0.018,
  baseEdgeRadius: 0.012,

  // offsets
  offsetMeters: 0.08,
  offsetFwd: 0.12,
  offsetUp: 0.00,

  // occlusion tuning
  nearBias: 0.01,
};

const rigs = new Map();
window._rigs = rigs;

const deg2rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* =============== UI PANEL (with FWD/UP) =============== */
function makePanel() {
  const box = document.createElement('div');
  box.id = 'blackops-panel';
  box.style.cssText = `
    position:fixed; top:64px; left:20px; z-index:100000;
    width:340px; max-width:95vw; padding:14px 14px 12px;
    background:rgba(17,23,41,.92); color:#e6edf7; border-radius:14px;
    box-shadow:0 10px 30px rgba(0,0,0,.35);
    font-family:ui-sans-serif,system-ui; backdrop-filter:saturate(120%) blur(6px);
  `;
  const title = document.createElement('div');
  title.textContent = 'Camera FOV Controls';
  title.style.cssText = 'text-align:center;font-weight:800;margin:4px 0 10px;';

  const pick = document.createElement('select');
  pick.style.cssText = `
    width:100%; padding:8px 10px; border-radius:10px; margin-bottom:10px;
    background:#0f172a; color:#e6edf7; border:1px solid rgba(255,255,255,.08);
  `;

  const grid = document.createElement('div');
  grid.style.cssText = `display:grid; grid-template-columns: 1fr 56px 56px; gap:8px 10px; align-items:center;`;
  const btnStyle =
    'width:56px;height:36px;border:none;border-radius:10px;background:#0ea5e9;color:#fff;font-weight:800;';

  box.append(title, pick, grid);
  document.body.appendChild(box);

  function row(label, get, set, step, unit, min, max) {
    const L = document.createElement('div'); L.textContent = label;
    const V = document.createElement('div'); V.style.cssText = 'text-align:right;opacity:.9;';
    const minus = document.createElement('button'); minus.textContent = '–'; minus.style.cssText = btnStyle;
    const plus  = document.createElement('button'); plus.textContent  = '+'; plus.style.cssText  = btnStyle;

    const refresh = () => { const x = get(); V.textContent = `${(x%1?x.toFixed(2):x)}${unit||''}`; };
    const bump = sgn => { const cur = get(); set(clamp(cur + sgn*(step||1), min??-1e9, max??1e9)); refresh(); };
    minus.onclick = e => { e.preventDefault(); bump(-1); };
    plus.onclick  = e => { e.preventDefault(); bump(+1); };

    grid.append(L, V, minus, plus);
    const spacer = document.createElement('div'); spacer.style.gridColumn = '1 / 3';
    grid.append(spacer, plus);
    refresh();
  }

  function refreshList() {
    pick.replaceChildren();
    for (const [id, rig] of rigs) {
      const o = document.createElement('option');
      o.value = id; o.textContent = rig.label || id;
      pick.appendChild(o);
    }
  }

  function mount(rig) {
    grid.replaceChildren();
    if (!rig) {
      const msg = document.createElement('div');
      msg.textContent = 'No camera mattertags found yet…';
      msg.style.cssText = 'grid-column:1/-1;color:#fca5a5;';
      grid.appendChild(msg);
      return;
    }
    const c = rig.cfg;
    row('HFOV', () => c.hFovDeg, v => { c.hFovDeg = v; rig.rebuild(); }, 1, '°', 10, 120);
    row('NEAR', () => c.near,    v => { c.near    = v; rig.rebuild(); }, 0.01, '', 0.02, 1);
    row('FAR',  () => c.far,     v => { c.far     = v; rig.rebuild(); }, 1, '', 2, 120);
    row('YAW',  () => c.yawDeg||0,  v => { c.yawDeg = v; rig.refs.pan.rotation.y = deg2rad(v); rig.requestClipSolve(true); }, 1, '°', -180, 180);
    row('TILT', () => c.tiltDeg||10, v => { c.tiltDeg = v; rig.applyTilt(); rig.requestClipSolve(true); }, 1, '°', 0, 85);
    row('FWD',  () => c.offsetFwd ?? 0.12, v => { c.offsetFwd = clamp(v, -1, 1); rig.applyOffsets(); rig.requestClipSolve(true); }, 0.01, ' m', -1, 1);
    row('UP',   () => c.offsetUp  ?? 0.00, v => { c.offsetUp  = clamp(v, -1, 1); rig.applyOffsets(); rig.requestClipSolve(true); }, 0.01, ' m', -1, 1);
  }

  pick.onchange = () => mount(rigs.get(pick.value));
  return { refreshList, mountAny: () => mount(rigs.size ? rigs.values().next().value : undefined) };
}
const ui = makePanel();

/* =============== GEOMETRY HELPERS =============== */
function tubeBetween(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length(); if (len <= 1e-6) return new THREE.Object3D();
  const g = new THREE.CylinderGeometry(r, r, len, 12, 1, true);
  const m = new THREE.Mesh(g, mat);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.renderOrder = 10;
  return m;
}
function retube(mesh, a, b) {
  const r = mesh.geometry?.parameters?.radiusTop ?? mesh.geometry?.parameters?.radius ?? 0.016;
  mesh.geometry.dispose();
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.geometry = new THREE.CylinderGeometry(r, r, Math.max(len, 1e-6), 12, 1, true);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
  mesh.position.copy(a).addScaledVector(dir, 0.5);
}
function frustumDims(THREE_, hFovDeg, aspect, dist) {
  const h = deg2rad(hFovDeg);
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
  return { halfW: Math.tan(h / 2) * dist, halfH: Math.tan(v / 2) * dist, dist };
}
function makeFrustumMaterials(THREE_, cfg) {
  const edge = new THREE_.MeshBasicMaterial({
    color: cfg.fovColor ?? 0x00ff00, transparent: true, opacity: 0.95,
    depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const fill = new THREE_.MeshBasicMaterial({
    color: cfg.fovColor ?? 0x00ff00, transparent: true, opacity: 0.16,
    depthTest: true, depthWrite: false, side: THREE_.DoubleSide,
  });
  return { edge, fill };
}
function buildTruncatedFrustum(THREE_, cfg) {
  const group = new THREE_.Group();
  const { edge, fill } = makeFrustumMaterials(THREE_, cfg);

  const aspect = cfg.aspect || 16 / 9;
  const near = Math.max(0.01, cfg.near);
  const far  = Math.max(near + 0.01, cfg.far);
  const s    = THREE_.MathUtils.clamp(cfg.nearApertureScale || 1, 0.05, 1);

  const n = frustumDims(THREE_, cfg.hFovDeg, aspect, near);
  const f = frustumDims(THREE_, cfg.hFovDeg, aspect, far);
  const nW = n.halfW * s, nH = n.halfH * s;

  const n0 = new THREE_.Vector3(-nW,-nH,-near), n1 = new THREE_.Vector3(nW,-nH,-near),
        n2 = new THREE_.Vector3(nW, nH,-near),  n3 = new THREE_.Vector3(-nW, nH,-near);
  const f0 = new THREE_.Vector3(-f.halfW,-f.halfH,-far), f1 = new THREE_.Vector3(f.halfW,-f.halfH,-far),
        f2 = new THREE_.Vector3(f.halfW, f.halfH,-far),  f3 = new THREE_.Vector3(-f.halfW, f.halfH,-far);

  // edges
  const er = cfg.edgeRadius || 0.016, br = cfg.baseEdgeRadius || 0.010;
  const longEdges = [
    tubeBetween(n0, f0, er, edge),
    tubeBetween(n1, f1, er, edge),
    tubeBetween(n2, f2, er, edge),
    tubeBetween(n3, f3, er, edge),
  ];
  longEdges.forEach(m => group.add(m));
  const rimNear = [
    tubeBetween(n0, n1, br, edge),
    tubeBetween(n1, n2, br, edge),
    tubeBetween(n2, n3, br, edge),
    tubeBetween(n3, n0, br, edge),
  ];
  rimNear.forEach(m => group.add(m));
  const rimFar = [
    tubeBetween(f0, f1, br, edge),
    tubeBetween(f1, f2, br, edge),
    tubeBetween(f2, f3, br, edge),
    tubeBetween(f3, f0, br, edge),
  ];
  rimFar.forEach(m => group.add(m));

  // fill faces (single mesh)
  const pos = [];
  const quads = [[n0,n1,f1,f0],[n1,n2,f2,f1],[n2,n3,f3,f2],[n3,n0,f0,f3]];
  for (const [a,b,c,d] of quads) {
    pos.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
    pos.push(a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z);
  }
  const faces = new THREE_.BufferGeometry();
  faces.setAttribute('position', new THREE_.Float32BufferAttribute(pos, 3));
  const fillMesh = new THREE_.Mesh(faces, fill); fillMesh.renderOrder = 5; group.add(fillMesh);

  group.userData = {
    nearRect: [n0,n1,n2,n3],
    farRect:  [f0,f1,f2,f3],
    edgeLong: longEdges,
    fillMesh,
  };
  return group;
}

/* ======== Stylized camera head (depth-tested) ======== */
function makeSideDecalTexture(THREE_) {
  const w = 512, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#bfe6f0'; ctx.fillRect(0,0,w,Math.round(h*0.62));
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath(); ctx.moveTo(70,0); ctx.lineTo(118,0); ctx.lineTo(54,h); ctx.lineTo(6,h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 38px system-ui, Arial, sans-serif';
  ctx.textBaseline = 'middle'; ctx.fillText('ARK Security', 160, Math.round(h*0.38));
  const tex = new THREE_.CanvasTexture(c); tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}
function buildStylizedCamera(THREE_) {
  const g = new THREE_.Group();

  const L = 0.44, wBack = 0.26, hBack = 0.16, wFront = 0.20, hFront = 0.13;
  const zF = -L/2, zB = L/2;

  const quad = (a,b,c,d,mat) => {
    const geom = new THREE_.BufferGeometry();
    geom.setAttribute('position', new THREE_.Float32BufferAttribute(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]),3));
    return new THREE_.Mesh(geom, mat);
  };

  const mWhite = new THREE_.MeshLambertMaterial({ color: 0xeeeeee, depthTest:true, depthWrite:true });
  const mBlue  = new THREE_.MeshLambertMaterial({ color: 0xbfe6f0, depthTest:true, depthWrite:true });
  const mDecal = new THREE_.MeshBasicMaterial({ map: makeSideDecalTexture(THREE_), depthTest:true, depthWrite:false });

  g.add(quad(new THREE_.Vector3(-wFront/2,-hFront/2,zF), new THREE_.Vector3(wFront/2,-hFront/2,zF),
             new THREE_.Vector3(wFront/2,hFront/2,zF),  new THREE_.Vector3(-wFront/2,hFront/2,zF), mWhite));
  g.add(quad(new THREE_.Vector3(-wBack/2,-hBack/2,zB),  new THREE_.Vector3(wBack/2,-hBack/2,zB),
             new THREE_.Vector3(wBack/2,hBack/2,zB),   new THREE_.Vector3(-wBack/2,hBack/2,zB),  mWhite));
  g.add(quad(new THREE_.Vector3(-wBack/2,hBack/2,zB),   new THREE_.Vector3(wBack/2,hBack/2,zB),
             new THREE_.Vector3(wFront/2,hFront/2,zF),  new THREE_.Vector3(-wFront/2,hFront/2,zF), mBlue));
  g.add(quad(new THREE_.Vector3(-wBack/2,-hBack/2,zB),  new THREE_.Vector3(wBack/2,-hBack/2,zB),
             new THREE_.Vector3(wFront/2,-hFront/2,zF), new THREE_.Vector3(-wFront/2,-hFront/2,zF), mWhite));
  g.add(quad(new THREE_.Vector3(wBack/2,-hBack/2,zB),   new THREE_.Vector3(wBack/2,hBack/2,zB),
             new THREE_.Vector3(wFront/2,hFront/2,zF),  new THREE_.Vector3(wFront/2,-hFront/2,zF), mWhite));

  // left decal
  {
    const a = new THREE_.Vector3(-wBack/2,-hBack/2, zB);
    const b = new THREE_.Vector3(-wBack/2, hBack/2, zB);
    const c = new THREE_.Vector3(-wFront/2, hFront/2, zF);
    const d = new THREE_.Vector3(-wFront/2,-hFront/2, zF);
    const geom = new THREE_.BufferGeometry();
    geom.setAttribute('position', new THREE_.Float32BufferAttribute(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]),3));
    geom.setAttribute('uv', new THREE_.Float32BufferAttribute(new Float32Array([0,1, 0,0, 1,0, 0,1, 1,0, 1,1]),2));
    const mesh = new THREE_.Mesh(geom, mDecal); g.add(mesh);
  }

  const bezel = new THREE_.Mesh(new THREE_.RingGeometry(0.058, 0.082, 32),
                               new THREE_.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.95, depthTest:true, depthWrite:false }));
  bezel.rotation.y = Math.PI; bezel.position.z = zF - 0.002; g.add(bezel);

  const housing = new THREE_.Mesh(new THREE_.CylinderGeometry(0.062, 0.062, 0.022, 24),
                                 new THREE_.MeshLambertMaterial({ color: 0x222222, depthTest:true, depthWrite:true }));
  housing.rotation.x = Math.PI/2; housing.rotation.z = Math.PI/2; housing.position.z = zF - 0.018; g.add(housing);

  const lens = new THREE_.Mesh(new THREE_.CylinderGeometry(0.052, 0.052, 0.055, 24),
                              new THREE_.MeshBasicMaterial({ color: 0x76ff76, transparent:true, opacity:0.35, depthTest:true, depthWrite:false }));
  lens.rotation.x = Math.PI/2; lens.rotation.z = Math.PI/2; lens.position.z = zF - 0.045; g.add(lens);

  const glow = new THREE_.Mesh(new THREE_.SphereGeometry(0.04, 18, 14),
                              new THREE_.MeshBasicMaterial({ color: 0x66ff66, transparent:true, opacity:0.28, depthTest:true, depthWrite:false }));
  glow.position.z = zF - 0.028; g.add(glow);

  const base = new THREE_.Mesh(new THREE_.CylinderGeometry(0.09, 0.09, 0.012, 24),
                               new THREE_.MeshLambertMaterial({ color: 0xffffff, depthTest:true, depthWrite:true }));
  base.position.set(0.20, -hBack*1.40, -L*0.08); g.add(base);

  g.renderOrder = 0;
  return g;
}

/* ========= build a rig at a tag (with robust raycast occlusion) ========= */
function buildRigAtTag({ THREE, anchor, tag, idx, mpSdk }) {
  // Start from defaults, then layer in per-label preset if present
  const cfg = { ...DEFAULT_CFG };
  const preset = PRESETS[tag.label?.trim()] || null;
  if (preset) Object.assign(cfg, preset);

  const base = new THREE.Object3D();
  const pan  = new THREE.Object3D();
  const tilt = new THREE.Object3D();
  base.add(pan); pan.add(tilt);

  // --- original tag position/normal
  const p = tag.anchorPosition || tag.pose?.position || tag.position || [0,0,0];
  const srcPos = Array.isArray(p) ? new THREE.Vector3(p[0],p[1],p[2]) : new THREE.Vector3(p.x,p.y,p.z);

  const n = tag.anchorNormal || tag.normal || tag.pose?.normal || [0,0,1];
  const srcNormal = (Array.isArray(n) ? new THREE.Vector3(n[0],n[1],n[2]) : new THREE.Vector3(n.x,n.y,n.z)).normalize();

  // “wall space”: N (outward), U (along wall up), R (along wall right)
  const GLOBAL_UP = new THREE.Vector3(0,1,0);
  let wallUp = GLOBAL_UP.clone().sub(srcNormal.clone().multiplyScalar(GLOBAL_UP.dot(srcNormal))).normalize();
  if (!isFinite(wallUp.x) || wallUp.lengthSq() < 1e-6) {
    wallUp = new THREE.Vector3(0,0,1).sub(srcNormal.clone().multiplyScalar(srcNormal.z)).normalize();
  }
  const wallRight = new THREE.Vector3().crossVectors(wallUp, srcNormal).normalize();

  // face outward
  base.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1), srcNormal);

  function applyOffsets() {
    const fwd = (cfg.offsetMeters ?? 0) + (cfg.offsetFwd ?? 0);
    const up  = (cfg.offsetUp ?? 0);
    base.position.copy(srcPos)
      .addScaledVector(srcNormal, fwd)
      .addScaledVector(wallUp, up);
  }
  function applyTilt() { tilt.rotation.x = -deg2rad(cfg.tiltDeg || 10); }

  applyOffsets();

  // stylized head + frustum
  const head = buildStylizedCamera(THREE);
  tilt.add(head);

  let frustum = buildTruncatedFrustum(THREE, cfg);
  tilt.add(frustum);

  pan.rotation.y  = deg2rad(cfg.yawDeg || 0);
  applyTilt();

  anchor.add(base);

  // ---- Raycast clipping state (multi-wall) ----
  const clip = { u: 8, v: 5, lastSolve: 0, minIntervalMs: 90, solving: false };

  async function raycastFirst(worldFrom, worldTo, tryReverse=true){
    const seg = new THREE.Vector3().subVectors(worldTo, worldFrom);
    const len = seg.length();
    if (!(len > 1e-4)) return null;
    const dir = seg.clone().normalize();

    let best = null;
    try {
      const hit = await mpSdk.Scene.raycast(
        { x:worldFrom.x, y:worldFrom.y, z:worldFrom.z },
        { x:dir.x,       y:dir.y,       z:dir.z       },
        len
      );
      if (hit && hit.hit) {
        const p = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
        best = { p, t: p.distanceTo(worldFrom) };
      }
    } catch(_){}

    if (!best && tryReverse) {
      const rdir = new THREE.Vector3().subVectors(worldFrom, worldTo).normalize();
      try {
        const rh = await mpSdk.Scene.raycast(
          { x:worldTo.x, y:worldTo.y, z:worldTo.z },
          { x:rdir.x,    y:rdir.y,    z:rdir.z    },
          len
        );
        if (rh && rh.hit) {
          const rp = new THREE.Vector3(rh.position.x, rh.position.y, rh.position.z);
          const t = rp.distanceTo(worldFrom);
          best = { p: rp, t };
        }
      } catch(_){}
    }
    return best;
  }

  async function solveClipping(force=false) {
    const now = performance.now();
    if (!force && (clip.solving || (now - clip.lastSolve) < clip.minIntervalMs)) return;
    clip.solving = true;

    try {
      const nearRect = frustum.userData.nearRect.map(v => v.clone());
      const farRect  = frustum.userData.farRect.map(v => v.clone());

      // apply nearBias
      const forwardLocal = new THREE.Vector3(0,0,-1);
      for (let i=0;i<4;i++) nearRect[i].addScaledVector(forwardLocal, cfg.nearBias || 0);

      // local grids
      const nearGrid = [], farGrid = [];
      for (let yi=0; yi<clip.v; yi++) {
        const ty = yi/(clip.v-1);
        const nA = new THREE.Vector3().lerpVectors(nearRect[0], nearRect[3], ty);
        const nB = new THREE.Vector3().lerpVectors(nearRect[1], nearRect[2], ty);
        const fA = new THREE.Vector3().lerpVectors(farRect[0],  farRect[3],  ty);
        const fB = new THREE.Vector3().lerpVectors(farRect[1],  farRect[2],  ty);
        for (let xi=0; xi<clip.u; xi++) {
          const tx = xi/(clip.u-1);
          nearGrid.push(new THREE.Vector3().lerpVectors(nA, nB, tx));
          farGrid .push(new THREE.Vector3().lerpVectors(fA, fB, tx));
        }
      }

      // raycast each column near->far
      const hitGridLocal = new Array(nearGrid.length);
      for (let i=0;i<nearGrid.length;i++) {
        const nW = tilt.localToWorld(nearGrid[i].clone());
        const fW = tilt.localToWorld(farGrid[i].clone());

        const fwd = await raycastFirst(nW, fW, true);
        const worldHit = fwd ? fwd.p : fW;

        hitGridLocal[i] = tilt.worldToLocal(worldHit.clone());
      }

      // rebuild fill mesh
      const fillMesh = frustum.userData.fillMesh;
      const geom = new THREE.BufferGeometry();
      const tris = (clip.u-1)*(clip.v-1)*2;
      const arr = new Float32Array(tris*9);
      let k = 0;
      for (let yi=0; yi<clip.v-1; yi++) {
        for (let xi=0; xi<clip.u-1; xi++) {
          const u = clip.u, idx = yi*u + xi;
          const n00 = nearGrid[idx],      n10 = nearGrid[idx+1],
                n01 = nearGrid[idx+u],    n11 = nearGrid[idx+u+1];
          const f00 = hitGridLocal[idx],  f10 = hitGridLocal[idx+1],
                f01 = hitGridLocal[idx+u],f11 = hitGridLocal[idx+u+1];

          const quads = [
            [n00,n10,f10,f00],
            [n10,n11,f11,f10],
            [n11,n01,f01,f11],
            [n01,n00,f00,f01],
          ];
          for (const [a,b,c,d] of quads) {
            arr[k++]=a.x;arr[k++]=a.y;arr[k++]=a.z;
            arr[k++]=b.x;arr[k++]=b.y;arr[k++]=b.z;
            arr[k++]=c.x;arr[k++]=c.y;arr[k++]=c.z;
            arr[k++]=a.x;arr[k++]=a.y;arr[k++]=a.z;
            arr[k++]=c.x;arr[k++]=c.y;arr[k++]=c.z;
            arr[k++]=d.x;arr[k++]=d.y;arr[k++]=d.z;
          }
        }
      }
      geom.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geom.computeBoundingSphere();
      fillMesh.geometry.dispose();
      fillMesh.geometry = geom;

      // Edge clipping
      const corners = [[0,0],[1,1],[2,2],[3,3]];
      const longEdges = frustum.userData.edgeLong;
      if (Array.isArray(longEdges) && longEdges.length === 4) {
        for (let i=0;i<4;i++){
          const [ni,fi] = corners[i];
          const nL = nearRect[ni].clone();
          const fL = farRect[fi].clone();
          const nW = tilt.localToWorld(nL.clone());
          const fW = tilt.localToWorld(fL.clone());
          const hit = await raycastFirst(nW, fW, true);
          const pLocal = tilt.worldToLocal((hit ? hit.p : fW).clone());
          retube(longEdges[i], nL, pLocal);
        }
      }

      clip.lastSolve = now;
    } finally {
      clip.solving = false;
    }
  }

  const id = tag.label?.trim() || `cam-${idx+1}`;
  const entry = {
    id,
    label: tag.label || `Surveillance Camera ${idx+1}`,
    cfg,
    refs: { base, pan, tilt, frustum, head },
    applyOffsets,
    rebuild() {
      tilt.remove(frustum);
      frustum = buildTruncatedFrustum(THREE, cfg);
      tilt.add(frustum);
      this.refs.frustum = frustum;
      applyOffsets();
      this.requestClipSolve(true);
    },
    applyTilt,
    requestClipSolve: (force=false) => solveClipping(force),
    _clip: clip,
  };

  setTimeout(() => entry.requestClipSolve(true), 250);
  rigs.set(id, entry);
  return entry;
}

/* ================ WebComponent bridge ================== */
let bridgeRegistered = false;
async function registerThreeBridge(mpSdk){
  if (bridgeRegistered) return;
  await mpSdk.Scene.register('blackops.ThreeObject', () => ({
    inputs: { obj: null },
    onInit(){ this.outputs = this.outputs || {}; this.outputs.objectRoot = this.inputs.obj || null; },
    onInputsUpdated(prev){ if (prev?.obj !== this.inputs.obj) this.outputs.objectRoot = this.inputs.obj || null; },
    onDestroy(){ this.outputs.objectRoot = null; }
  }));
  bridgeRegistered = true;
}

/* ================= SDK Helpers ================= */
function getViewerEl() {
  return document.getElementById('mpv') || document.querySelector('matterport-viewer');
}
function getSdk() {
  const el = getViewerEl();
  return new Promise(resolve => {
    if (!el) { console.error('[BLACKOPS] matterport-viewer not found'); return; }
    if (el.mpSdk) return resolve(el.mpSdk);
    const onReady = e => { el.removeEventListener('mpSdkReady', onReady); resolve(e.detail); };
    el.addEventListener('mpSdkReady', onReady);
    const iv = setInterval(() => { if (el.mpSdk) { clearInterval(iv); resolve(el.mpSdk); } }, 200);
  });
}
async function readTagsWithRetries(mpSdk, maxMs = 5000){
  const t0 = performance.now();
  while (performance.now() - t0 < maxMs){
    try {
      const tags = await mpSdk.Mattertag.getData();
      if (Array.isArray(tags)) return tags;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  return [];
}

/* ================= Main ================= */
async function main() {
  const mpSdk = await getSdk();
  console.log('[BLACKOPS] mpSdk ready');

  await registerThreeBridge(mpSdk);

  const [sceneObject] = await mpSdk.Scene.createObjects(1);
  const node = sceneObject.addNode();
  const anchor = new THREE.Group();
  node.addComponent('blackops.ThreeObject', { obj: anchor });
  sceneObject.start();
  console.log('[BLACKOPS] SceneObject started');

  // lighting for head (Lambert)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
  anchor.add(hemi);

  const tags = await readTagsWithRetries(mpSdk, 5000);
  const cams = tags.filter(t => CAMERA_TAGS.has((t.label || '').trim()));
  console.log('[BLACKOPS] camera tags:', cams.map(t => t.label));

  cams.forEach((t, i) => buildRigAtTag({ THREE, anchor, tag: t, idx: i, mpSdk }));

  ui.refreshList();
  ui.mountAny();

  // Sweep animation + throttled clip updates (~10Hz)
  const phase = new Map();
  let lastT = performance.now(), lastClipT = 0;
  function anim(now) {
    const dt = (now - lastT) / 1000; lastT = now;

    for (const e of rigs.values()) {
      const c = e.cfg;
      const center = deg2rad(c.yawDeg || 0);
      const A = deg2rad(c.sweepDeg || 0) * 0.5;
      const w = deg2rad(c.yawSpeedDeg || 10);
      const ph = (phase.get(e.id) || 0) + w * dt;
      phase.set(e.id, ph);
      e.refs.pan.rotation.y = center + (A ? Math.sin(ph) * A : 0);
    }

    if (now - lastClipT > 100) {
      for (const e of rigs.values()) e.requestClipSolve(false);
      lastClipT = now;
    }

    requestAnimationFrame(anim);
  }
  requestAnimationFrame(anim);
  console.log('[BLACKOPS] animation loop running');
}

main().catch(err => console.error('[BLACKOPS] init failed', err));