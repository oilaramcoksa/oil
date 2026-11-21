// @ts-nocheck
// ============================================================================
//  PumpScene3D engine — premium 3D oil-pump-station scene (Three.js r128).
//
//  Highlights of the redesigned sell sequence (no more modal/popup; the whole
//  animation plays inside the live 3D scene):
//
//   • Truck drives IN from the far road, headlights sweeping the ground.
//   • Work-lights ramp UP around the pump+truck (warm halogen cones) so the
//     player reads the arrival as a "lit up" event.
//   • A heavy steel hose unspools from the pump's reel and snaps onto the
//     truck's rear inlet coupling.
//   • The pump jack keeps pumping; oil visibly LEAVES the storage tank and
//     FLOWS through the transparent hose into the tanker (animated droplets).
//   • The tanker's side gauge climbs second-by-second and the storage tank's
//     glass gauge drops in lock-step — moment-by-moment fill, no fade-to-number.
//   • DURING transfer the work-lights DIM (as if the operator killed them to
//     focus on the pump), the red beacon keeps blinking for safety.
//   • When transfer ends the work-lights RAMP UP again, the hose retracts,
//     the truck rolls back out onto the road and disappears past the horizon.
//
//  Pure Three.js. No DOM / sound / store here — the React layer
//  (PumpScene3D.tsx) owns UI and feeds per-player state via the returned
//  controller. Exposes triggerSell() + onSellEvent callback for the host to
//  drive its in-scene HUD (phase text, oil collected counter, coins earned).
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PumpSceneParts { oil_pump?: number; fuel_station?: number; oil_truck?: number }
export interface PumpSceneSpecial { new_background?: boolean; vip_badge?: boolean }

export type SellPhase =
  | 'idle' | 'arriving' | 'lights_on' | 'connecting'
  | 'transferring' | 'lights_restore' | 'retracting' | 'departing' | 'done';

export interface SellProgress {
  phase: SellPhase;
  /** 0..1 progress of the *whole* sequence (for HUD bar). */
  progress: number;
  /** Litres transferred *so far* (animating toward target). */
  oilCollected: number;
  /** Litres the server said we sold (set once the sale commits). */
  oilTarget: number;
  /** Coins earned (set once the sale commits). */
  coinsEarned: number;
}

export interface PumpSceneHandles {
  setPumping(b: boolean): void;
  setOilRatio(r: number): void;
  setParts(p: PumpSceneParts): void;
  setSpecialParts(s: PumpSceneSpecial): void;
  /** Begin the in-scene sell sequence. Safe to call repeatedly; ignored if one is already running. */
  triggerSell(): void;
  /** Push the authoritative sale result from the server so the scene animates toward real numbers. */
  setSaleResult(oilSold: number, coinsEarned: number): void;
  /** Reset to idle, e.g. after the host closes its HUD. */
  resetSell(): void;
  /** Subscribe to live phase/progress updates for the in-scene HUD. Returns an unsubscribe fn. */
  onSellEvent(cb: (p: SellProgress) => void): () => void;
  dispose(): void;
}

export function createPumpScene(canvas: HTMLCanvasElement, onTap: () => void): PumpSceneHandles {
  const PUMP_POS = new THREE.Vector3(0, 0, 0);
  const TANK_POS = new THREE.Vector3(18, 0, 0);
  const TANK_OUT = new THREE.Vector3(22, 1.5, 0);       // pump-side hose outlet
  const TRUCK_PARK_X = 32;
  const TRUCK_AWAY_X = 95;

  let pumping = false;
  let oilRatio = 0;
  let vip = false;
  let specialBg = false;
  let disposed = false;

  // --- renderer / scene / camera ---
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd9b27a, 55, 200);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 600);
  camera.position.set(37, 22, 46);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(16, 8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 14;
  controls.maxDistance = 110;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = false;
  controls.update();

  // --- sky dome ---
  const skyGeo = new THREE.SphereGeometry(420, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x3a6ea5) }, mid: { value: new THREE.Color(0xbfd4e8) }, bot: { value: new THREE.Color(0xe8c890) } },
    vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 vP;uniform vec3 top,mid,bot;void main(){float h=normalize(vP).y;vec3 c=h>0.0?mix(mid,top,clamp(h,0.,1.)):mix(mid,bot,clamp(-h,0.,1.));gl_FragColor=vec4(c,1.);}',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // --- lights ---
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b5236, 0.55); scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.18); scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffe6c2, 1.25);
  sun.position.set(40, 55, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const warm = new THREE.PointLight(0xff8a30, 0.6, 40, 2); warm.position.set(0, 6, 2); scene.add(warm);

  // --- work lights (sell-sequence halogen cones) ---
  // Two spotlights flanking the truck and pump, plus a fill point light.
  // They are OFF by default, ramp up on truck arrival, DIM during transfer
  // (operator focuses on the pump), and ramp up again at departure.
  const workPumpSpot = new THREE.SpotLight(0xffd9a0, 0, 40, Math.PI * 0.22, 0.45, 1.6);
  workPumpSpot.position.set(2, 14, 4);
  workPumpSpot.target.position.set(-2, 2, 0);
  workPumpSpot.castShadow = false;
  scene.add(workPumpSpot); scene.add(workPumpSpot.target);
  const workTruckSpot = new THREE.SpotLight(0xffd9a0, 0, 45, Math.PI * 0.24, 0.5, 1.8);
  workTruckSpot.position.set(30, 14, 6);
  workTruckSpot.target.position.set(30, 2, 0);
  workTruckSpot.castShadow = false;
  scene.add(workTruckSpot); scene.add(workTruckSpot.target);
  const workFill = new THREE.PointLight(0xffe2b0, 0, 50, 1.8);
  workFill.position.set(20, 8, 4); scene.add(workFill);
  // Visual lamp posts for the work lights (so the cones have a visible source).
  function lampPost(x: number, z: number) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.7, roughness: 0.5 }));
    pole.position.y = 6; g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.7, roughness: 0.5 }));
    arm.position.set(0.8, 11.6, 0); g.add(arm);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: 0xffc880, emissiveIntensity: 0, metalness: 0.3, roughness: 0.4 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), bulbMat); bulb.position.set(1.4, 11.5, 0); g.add(bulb);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd080, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.set(3, 3, 1); glow.position.set(1.4, 11.5, 0); g.add(glow);
    g.position.set(x, 0, z); scene.add(g);
    return { bulbMat, glow };
  }
  const lampPump = lampPost(2, 4);
  const lampTruck = lampPost(30, 6);

  // --- day / night system ---
  const SKY = {
    topD: new THREE.Color(0x2a5d8c), midD: new THREE.Color(0xa9cce6), botD: new THREE.Color(0xe8c890),
    topN: new THREE.Color(0x04060f), midN: new THREE.Color(0x0b1730), botN: new THREE.Color(0x161f33),
    topS: new THREE.Color(0x071b32), midS: new THREE.Color(0x123b60), botS: new THREE.Color(0x176b83),
    fogD: new THREE.Color(0xd9b27a), fogN: new THREE.Color(0x0e131d),
    sunC: new THREE.Color(0xffe6c2), moonC: new THREE.Color(0xbcd0ff),
    ambD: new THREE.Color(0xffffff), ambN: new THREE.Color(0x2a3550),
    hSkyD: new THREE.Color(0xcfe3ff), hSkyN: new THREE.Color(0x1a2540),
    hGndD: new THREE.Color(0x6b5236), hGndN: new THREE.Color(0x0c0f16),
  };
  const _cTop = new THREE.Color(), _cMid = new THREE.Color(), _cBot = new THREE.Color();
  function smoothstep(x: number) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function clockDayFactor() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    if (h >= 7 && h <= 17) return 1;
    if (h > 5 && h < 7) return smoothstep((h - 5) / 2);
    if (h > 17 && h < 19) return 1 - smoothstep((h - 17) / 2);
    return 0;
  }
  function dayFrac(day: boolean) {
    const d = new Date(); let h = d.getHours() + d.getMinutes() / 60;
    if (day) return (h - 6) / 12;
    if (h < 6) h += 24;
    return (h - 18) / 12;
  }
  function arcPos(frac: number, yH: number, spread: number, z: number) {
    const a = frac * Math.PI;
    return new THREE.Vector3(16 + Math.cos(Math.PI - a) * spread, 6 + Math.sin(a) * yH, z);
  }
  const sunGroup = new THREE.Group();
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 18), new THREE.MeshBasicMaterial({ color: 0xfff3c0, fog: false }));
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd060, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sunGlow.scale.set(48, 48, 1);
  sunGroup.add(sunMesh); sunGroup.add(sunGlow); scene.add(sunGroup);
  const moonGroup = new THREE.Group();
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 18), new THREE.MeshStandardMaterial({ color: 0xd8ddef, roughness: 0.9, emissive: 0x9aa8c8, emissiveIntensity: 0.6, metalness: 0, fog: false }));
  for (let i = 0; i < 4; i++) {
    const cr = new THREE.Mesh(new THREE.CircleGeometry(0.4 + Math.random() * 0.4, 12), new THREE.MeshBasicMaterial({ color: 0x8b94b0, fog: false }));
    cr.position.set((Math.random() - 0.5) * 5.0, (Math.random() - 0.5) * 5.0, 5.35);
    moonMesh.add(cr);
  }
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xbcd0ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  moonGlow.scale.set(38, 38, 1);
  moonGroup.add(moonMesh); moonGroup.add(moonGlow); scene.add(moonGroup);
  const NST = 750;
  const stGeo = new THREE.BufferGeometry();
  const stPos = new Float32Array(NST * 3), stPh = new Float32Array(NST), stSz = new Float32Array(NST);
  for (let i = 0; i < NST; i++) {
    const th = Math.random() * Math.PI * 2;
    const y = 60 + Math.random() * 320;
    const rr = Math.sqrt(Math.max(0, 380 * 380 - y * y));
    stPos[i * 3] = rr * Math.cos(th); stPos[i * 3 + 1] = y; stPos[i * 3 + 2] = rr * Math.sin(th);
    stPh[i] = Math.random() * Math.PI * 2; stSz[i] = 1 + Math.random() * 2.2;
  }
  stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
  stGeo.setAttribute('phase', new THREE.BufferAttribute(stPh, 1));
  stGeo.setAttribute('sz', new THREE.BufferAttribute(stSz, 1));
  const stMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, op: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float phase;attribute float sz;uniform float time;varying float vT;void main(){vT=0.5+0.5*sin(time*2.2+phase);vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=sz*(1.1+0.9*vT)*(400.0/-mv.z);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform float op;varying float vT;void main(){vec2 c=gl_PointCoord-0.5;float d=length(c);if(d>0.5)discard;float a=smoothstep(0.5,0.0,d)*op*(0.35+0.65*vT);gl_FragColor=vec4(1.0,0.97,0.88,a);}',
  });
  const stars = new THREE.Points(stGeo, stMat); scene.add(stars);
  const cloudTex = (function () {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    function puff(x: number, y: number, r: number, a: number) { const g = ctx.createRadialGradient(x, y, 2, x, y, r); g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); }
    puff(64, 64, 60, 0.9);
    for (let i = 0; i < 6; i++) puff(32 + Math.random() * 64, 40 + Math.random() * 48, 16 + Math.random() * 20, 0.7);
    return new THREE.CanvasTexture(cv);
  })();
  const clouds: THREE.Sprite[] = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    const sc = 24 + Math.random() * 20;
    s.scale.set(sc * 1.8, sc, 1);
    s.position.set(-70 + Math.random() * 150, 42 + Math.random() * 24, -30 - Math.random() * 70);
    (s as any).userData.spd = 1.2 + Math.random() * 2.2;
    scene.add(s); clouds.push(s);
  }
  let dayFactor = clockDayFactor();
  function updateSky(tt: number, dt: number) {
    dayFactor = clockDayFactor();
    const df = dayFactor;
    const topN = specialBg ? _cTop.copy(SKY.topS) : _cTop.copy(SKY.topN);
    const midN = specialBg ? _cMid.copy(SKY.midS) : _cMid.copy(SKY.midN);
    const botN = specialBg ? _cBot.copy(SKY.botS) : _cBot.copy(SKY.botN);
    skyMat.uniforms.top.value.copy(topN).lerp(SKY.topD, df);
    skyMat.uniforms.mid.value.copy(midN).lerp(SKY.midD, df);
    skyMat.uniforms.bot.value.copy(botN).lerp(SKY.botD, df);
    scene.fog.color.copy(SKY.fogN).lerp(SKY.fogD, df);
    sun.color.copy(SKY.moonC).lerp(SKY.sunC, df);
    sun.intensity = 0.2 + df * 1.1;
    hemi.color.copy(SKY.hSkyN).lerp(SKY.hSkyD, df);
    hemi.groundColor.copy(SKY.hGndN).lerp(SKY.hGndD, df);
    hemi.intensity = 0.22 + df * 0.42;
    amb.color.copy(SKY.ambN).lerp(SKY.ambD, df);
    amb.intensity = 0.13 + df * 0.10;
    const sp = arcPos(dayFrac(true), 30, 62, -22);
    const mp = arcPos(dayFrac(false), 26, 62, -22);
    sun.position.lerpVectors(mp, sp, df);
    if (df > 0.02) {
      sunGroup.position.copy(sp); sunGroup.visible = true;
      const pul = 0.5 + 0.12 * Math.sin(tt * 2.2);
      sunGlow.material.opacity = pul; const gs = 48 + Math.sin(tt * 2.2) * 4; sunGlow.scale.set(gs, gs, 1);
    } else sunGroup.visible = false;
    if (df < 0.98) {
      moonGroup.position.copy(mp); moonGroup.visible = true;
      const pul = 0.35 + 0.12 * Math.sin(tt * 1.4);
      moonGlow.material.opacity = pul; const gs = 38 + Math.sin(tt * 1.4) * 3; moonGlow.scale.set(gs, gs, 1);
      moonMesh.rotation.y = tt * 0.02;
    } else moonGroup.visible = false;
    stMat.uniforms.time.value = tt;
    const sop = Math.max(0, 1 - df * 1.25);
    stMat.uniforms.op.value = sop; stars.visible = sop > 0.01;
    for (const c of clouds) {
      c.position.x += (c as any).userData.spd * dt;
      if (c.position.x > 85) c.position.x = -85;
      c.material.opacity = df * 0.8;
    }
    // The warm "pump burner" glow only really matters at night; gate it by the
    // sell-sequence work-light multiplier so the operator's attention reads as
    // "focus on the pump" during transfer.
    warm.intensity = (0.35 + (1 - df) * 1.1) * (1 + Math.sin(tt * 8) * 0.08) * lightMul;
  }

  // --- ground / road / scenery ---
  const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 64), new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(240, 7), new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2; road.position.set(20, 0.02, 0); road.receiveShadow = true; scene.add(road);
  for (let i = -110; i < 110; i += 12) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.4), new THREE.MeshBasicMaterial({ color: 0xd8c27a }));
    m.rotation.x = -Math.PI / 2; m.position.set(i, 0.05, 0); scene.add(m);
  }
  function distantPump(x: number, z: number, sc: number) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.9 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.4, 6), m); post.position.y = 1.2; g.add(post);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), m); beam.position.y = 2.3; g.add(beam);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.8, 6), m); w.position.set(0.7, 0.4, 0); g.add(w);
    g.position.set(x, 0, z); g.scale.setScalar(sc); scene.add(g); return g;
  }
  const dPumps = [distantPump(-40, 18, 0.7), distantPump(-55, 10, 0.55), distantPump(60, -22, 0.8), distantPump(75, -12, 0.6), distantPump(-70, -18, 0.5)];
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 });
  for (let i = 0; i < 7; i++) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(20 + Math.random() * 14, 8 + Math.random() * 7, 5), hillMat);
    const a = i / 7 * Math.PI * 2;
    h.position.set(Math.cos(a) * 120, 3, Math.sin(a) * 120);
    scene.add(h);
  }
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2a6a8a, metalness: 0.4, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 16), barrelMat);
    b.position.set(8 + i * 1.5, 0.7, -5 + Math.sin(i) * 0.5); b.castShadow = true; b.receiveShadow = true; scene.add(b);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x1a4050 }));
    r.position.set(b.position.x, 1.0, b.position.z); scene.add(r);
  }
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x33312c, metalness: 0.7, roughness: 0.45 });
  const gpipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 18, 12), pipeMat);
  gpipe.rotation.z = Math.PI / 2; gpipe.position.set(9, 0.4, 0); scene.add(gpipe);

  // --- shared materials ---
  const M: Record<string, THREE.MeshStandardMaterial | THREE.Material> = {
    steel: new THREE.MeshStandardMaterial({ color: 0x7a7a78, metalness: 0.85, roughness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x35332f, metalness: 0.9, roughness: 0.32 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x8a4a22, metalness: 0.55, roughness: 0.75 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.95 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xe2e2dc, metalness: 0.55, roughness: 0.4 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.45, roughness: 0.5 }),
    oil: new THREE.MeshStandardMaterial({ color: 0x140c05, metalness: 0.25, roughness: 0.18, emissive: 0x070301 }),
    cab: new THREE.MeshStandardMaterial({ color: 0xc4231f, metalness: 0.55, roughness: 0.32 }),
    tanker: new THREE.MeshStandardMaterial({ color: 0xbfc5cc, metalness: 0.75, roughness: 0.28 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2a3b4a, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.55 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.95 }),
    hose: new THREE.MeshStandardMaterial({ color: 0x18140e, roughness: 0.85, metalness: 0.1 }),
    hoseBraid: new THREE.MeshStandardMaterial({ color: 0x6b7686, metalness: 0.85, roughness: 0.35 }),
    tankGlass: new THREE.MeshStandardMaterial({ color: 0xbfd8e6, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.16, side: THREE.FrontSide, depthWrite: false }),
    tankerGlass: new THREE.MeshStandardMaterial({ color: 0xc6d2dc, metalness: 0.3, roughness: 0.12, transparent: true, opacity: 0.14, side: THREE.FrontSide, depthWrite: false }),
  };
  function makeLabelTexture(text: string) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#13263b'; x.fillRect(0, 0, 512, 128);
    x.fillStyle = '#ffce3a'; x.font = '800 64px Arial,Helvetica,sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 70);
    x.strokeStyle = '#ffce3a'; x.lineWidth = 3; x.strokeRect(8, 8, 496, 112);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  const ARMCO_TEX = makeLabelTexture('ARMCO OIL');
  function makeGlowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const GLOW_TEX = makeGlowTex();
  sunGlow.material.map = GLOW_TEX;
  moonGlow.material.map = GLOW_TEX;

  // --- pumpjack ---
  function buildPumpjack() {
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 5), M.concrete as any); pad.position.y = 0.25; pad.receiveShadow = true; pad.castShadow = true; g.add(pad);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 3.2), M.dark as any); skid.position.y = 0.7; skid.castShadow = true; g.add(skid);
    const postH = 8.2;
    const legGeo = new THREE.BoxGeometry(0.4, postH, 0.4);
    const lL = new THREE.Mesh(legGeo, M.steel as any); lL.position.set(-1.25, postH / 2 + 0.9, 0); lL.rotation.z = 0.12; lL.castShadow = true; g.add(lL);
    const lR = new THREE.Mesh(legGeo, M.steel as any); lR.position.set(1.25, postH / 2 + 0.9, 0); lR.rotation.z = -0.12; lR.castShadow = true; g.add(lR);
    for (let i = 1; i <= 3; i++) { const w = 2.5 - i * 0.4; const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.16), M.steel as any); c.position.set(0, 0.9 + i * 2.2, 0); g.add(c); }
    const db = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5, 0.14), M.steel as any); db.position.set(-0.6, 3.5, 0); db.rotation.z = 0.5; g.add(db);
    const db2 = db.clone(); db2.position.x = 0.6; db2.rotation.z = -0.5; g.add(db2);
    const pivY = 8.2 + 0.9;
    const piv = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1, 16), M.dark as any); piv.rotation.x = Math.PI / 2; piv.position.set(0, pivY, 0); g.add(piv);
    const beam = new THREE.Group();
    const beamMesh = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.42, 0.55), M.steel as any); beamMesh.castShadow = true; beam.add(beamMesh);
    const hh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.65), M.steel as any); hh.position.set(-3.4, 0.5, 0); hh.rotation.z = 0.32; hh.castShadow = true; beam.add(hh);
    const hh2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), M.dark as any); hh2.position.set(-3.85, 1.0, 0); hh2.rotation.z = 0.32; beam.add(hh2);
    const bridle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8), M.dark as any); bridle.position.set(-3.9, -0.4, 0); beam.add(bridle);
    const cw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 0.7), M.dark as any); cw.position.set(3.1, 0, 0); cw.castShadow = true; beam.add(cw);
    beam.position.set(0, pivY, 0); g.add(beam);
    const crank = new THREE.Group(); crank.position.set(0, pivY - 2.6, 0);
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.3, 24), M.dark as any); disk.rotation.x = Math.PI / 2; disk.castShadow = true; crank.add(disk);
    const cw2 = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.85), M.rust as any); cw2.position.set(0.55, 0, 0); crank.add(cw2);
    const pin = new THREE.Object3D(); pin.position.set(1.05, 0, 0); crank.add(pin);
    const pinViz = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 12), M.steel as any); pinViz.rotation.x = Math.PI / 2; pin.add(pinViz);
    g.add(crank);
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 10), M.steel as any); pit.castShadow = true; g.add(pit);
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1, 16), M.dark as any); well.position.set(-4.6, 0.9, 0); well.castShadow = true; g.add(well);
    const wellTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.0), M.dark as any); wellTop.position.set(-4.6, 1.6, 0); g.add(wellTop);
    const sucker = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8), M.steel as any); g.add(sucker);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.8), M.dark as any); belt.position.set(1.6, 1.4, 1.0); g.add(belt);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.0, 16), M.steel as any); motor.position.set(2.4, 1.0, 1.2); motor.rotation.z = Math.PI / 2; g.add(motor);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x4a0808, emissive: 0xff1a1a, emissiveIntensity: 0, metalness: 0.3, roughness: 0.4 });
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), M.dark as any); lampBase.position.set(0, pivY + 1.15, 0.7); g.add(lampBase);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), lampMat); lamp.position.set(0, pivY + 1.45, 0.7); g.add(lamp);
    const lampLight = new THREE.PointLight(0xff2200, 0, 16, 2); lampLight.position.set(0, pivY + 1.45, 0.7); g.add(lampLight);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xff3322, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    lampGlow.scale.set(2.4, 2.4, 1); lampGlow.position.set(0, pivY + 1.45, 0.7); g.add(lampGlow);
    // Hose reel on the pump's right side; the hose visibly unspools from here.
    const reelGroup = new THREE.Group(); reelGroup.position.set(2.2, 1.6, 0); g.add(reelGroup);
    const reelDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 18), M.steel as any); reelDrum.rotation.z = Math.PI / 2; reelGroup.add(reelDrum);
    const reelSideA = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 18), M.dark as any); reelSideA.rotation.z = Math.PI / 2; reelSideA.position.x = 0.3; reelGroup.add(reelSideA);
    const reelSideB = reelSideA.clone(); reelSideB.position.x = -0.3; reelGroup.add(reelSideB);
    const reelStand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.5), M.dark as any); reelStand.position.set(0, -0.8, 0); reelGroup.add(reelStand);
    g.userData = { beam, crank, pit, pin, sucker, lampMat, lampLight, lampGlow, reelGroup, reelDrum, postH: pivY, crankR: 1.05, beamHalf: 3.1 };
    return g;
  }
  const pump = buildPumpjack(); scene.add(pump);

  // --- storage tank ---
  function buildTank() {
    const g = new THREE.Group();
    const R = 4, H = 8;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 40, true), M.tankGlass as any); body.position.y = H / 2 + 0.5; g.add(body);
    for (const y of [1.0, H - 0.5]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.35, 40), M.trim as any); b.position.y = y + 0.5; g.add(b); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(R + 0.05, 1.6, 40), M.tank as any); roof.position.y = H + 0.5 + 0.8; roof.castShadow = true; g.add(roof);
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.0, 12), M.trim as any); vent.position.y = H + 0.5 + 1.6 + 0.5; g.add(vent);
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 7.5, 0.6), M.dark as any); ladder.position.set(-R - 0.05, 4.2, 0); g.add(ladder);
    for (let i = 0; i < 7; i++) { const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), M.dark as any); rung.rotation.x = Math.PI / 2; rung.position.set(-R - 0.05, 1.2 + i * 0.9, 0); g.add(rung); }
    const oil = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.25, R - 0.25, 1, 36), M.oil as any); oil.position.y = 1; g.add(oil);
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 12), M.trim as any); inlet.rotation.z = Math.PI / 2; inlet.position.set(-R - 0.75, 3, 0); g.add(inlet);
    const valveBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), M.trim as any); valveBase.position.set(R + 0.35, 1.5, 0); g.add(valveBase);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 12), M.dark as any); valve.rotation.z = Math.PI / 2; valve.position.set(R + 1.2, 1.5, 0); g.add(valve);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 8, 16), M.steel as any); wheel.position.set(R + 1.9, 1.5, 0); wheel.rotation.y = Math.PI / 2; g.add(wheel);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.5, 0.08), M.glass as any); glass.position.set(0, 4.2, R + 0.05); g.add(glass);
    const gaugeFill = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 0.05), M.oil as any); gaugeFill.position.set(0, 1.5, R + 0.08); g.add(gaugeFill);
    const tankLblMat = new THREE.MeshBasicMaterial({ map: ARMCO_TEX, transparent: true, depthWrite: false });
    const tankLbl = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), tankLblMat); tankLbl.position.set(0, 6.2, R + 0.12); g.add(tankLbl);
    g.userData = { oil, gaugeFill, R, H };
    return g;
  }
  const tank = buildTank(); tank.position.copy(TANK_POS); scene.add(tank);
  function setTankLevel(lvl: number) {
    lvl = Math.max(0, Math.min(1, lvl));
    const ud: any = tank.userData; const H = ud.H;
    const oilH = lvl * (H - 0.4);
    ud.oil.scale.y = oilH; ud.oil.position.y = 1 + oilH / 2;
    const gh = lvl * 5.0;
    ud.gaugeFill.scale.y = gh; ud.gaugeFill.position.y = 1.5 + gh / 2;
  }

  // --- oil truck (redesigned) ---
  const truckOilPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.6);
  function buildTruck() {
    const g = new THREE.Group();
    // === Tractor unit ===
    const cabBody = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 3.2), M.cab as any); cabBody.position.set(5, 2.1, 0); cabBody.castShadow = true; g.add(cabBody);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2.9), M.cab as any); cabRoof.position.set(4.6, 3.9, 0); g.add(cabRoof);
    const sleeper = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 2.9), M.cab as any); sleeper.position.set(3.6, 2.4, 0); g.add(sleeper);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 2.9), M.cab as any); hood.position.set(7.2, 1.6, 0); hood.castShadow = true; g.add(hood);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 2.6), M.rubber as any); grille.position.set(8.05, 1.7, 0); g.add(grille);
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 2.4), M.steel as any);
      slat.position.set(8.0, 1.2 + i * 0.22, 0); g.add(slat);
    }
    const ws = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 2.5), M.glass as any); ws.position.set(6.4, 3.0, 0); g.add(ws);
    // Headlights (visible glow + ground beam while arriving/departing)
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffcc60, emissiveIntensity: 0.7 });
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), hlMat); hl.position.set(8.0, 1.7, 1.0); g.add(hl);
    const hl2 = hl.clone(); hl2.position.z = -1.0; g.add(hl2);
    const headBeam = new THREE.SpotLight(0xfff0c8, 0, 28, Math.PI * 0.32, 0.6, 1.5);
    headBeam.position.set(8.2, 1.7, 0); headBeam.target.position.set(20, 0.5, 0); g.add(headBeam); g.add(headBeam.target);
    // Bumper + exhaust stack
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 3.0), M.steel as any); bumper.position.set(8.1, 1.0, 0); g.add(bumper);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 12), M.steel as any); stack.position.set(3.5, 4.0, 1.4); g.add(stack);
    const stackCap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.2, 12), M.dark as any); stackCap.position.set(3.5, 5.2, 1.4); g.add(stackCap);
    // Side mirrors
    for (const z of [1.7, -1.7]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.4), M.dark as any); arm.position.set(4.6, 3.4, z); g.add(arm);
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.4), M.steel as any); mir.position.set(4.6, 3.4, z + Math.sign(z) * 0.25); g.add(mir);
    }
    // === Tanker trailer ===
    const tanker = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 7, 28, true), M.tankerGlass as any); tanker.rotation.z = Math.PI / 2; tanker.position.set(-1.5, 2.6, 0); g.add(tanker);
    const capGeo = new THREE.SphereGeometry(2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const capF = new THREE.Mesh(capGeo, M.tankerGlass as any); capF.rotation.z = -Math.PI / 2; capF.position.set(-5, 2.6, 0); g.add(capF);
    const capB = new THREE.Mesh(capGeo, M.tankerGlass as any); capB.rotation.z = Math.PI / 2; capB.position.set(2, 2.6, 0); g.add(capB);
    const truckOilMat = (M.oil as THREE.MeshStandardMaterial).clone(); truckOilMat.clippingPlanes = [truckOilPlane];
    const innerOil = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 7.0, 28), truckOilMat); innerOil.rotation.z = Math.PI / 2; innerOil.position.set(-1.5, 2.6, 0); g.add(innerOil);
    for (const x of [-4, 1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.18, 28), M.trim as any); b.rotation.z = Math.PI / 2; b.position.set(x, 2.6, 0); g.add(b); }
    // Dome rings (ribbed look)
    for (const x of [-3, -0.5, 1.5]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(2.06, 2.06, 0.06, 28), M.dark as any); r.rotation.z = Math.PI / 2; r.position.set(x, 2.6, 0); g.add(r); }
    // Rear inlet port + coupling ring
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.0, 14), M.dark as any); port.rotation.z = Math.PI / 2; port.position.set(-5.4, 2.6, 0); port.castShadow = true; g.add(port);
    const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.08, 8, 16), M.steel as any); portRing.position.set(-5.9, 2.6, 0); portRing.rotation.y = Math.PI / 2; g.add(portRing);
    // Top manhole
    const manhole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.3, 14), M.dark as any); manhole.position.set(-1.5, 4.6, 0); g.add(manhole);
    const manholeCap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14), M.steel as any); manholeCap.position.set(-1.5, 4.78, 0); g.add(manholeCap);
    // Side gauge glass (visible oil level)
    const sg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.08), M.glass as any); sg.position.set(-1.5, 2.6, 2.04); g.add(sg);
    const sgFill = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1, 0.05), M.oil as any); sgFill.position.set(-1.5, 0.95, 2.08); g.add(sgFill);
    // Gauge tick marks
    for (let i = 0; i < 5; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.06), M.dark as any);
      tick.position.set(-1.5, 1.2 + i * 0.7, 2.12); g.add(tick);
    }
    // Tanker label decal
    const trkLblMat = new THREE.MeshBasicMaterial({ map: ARMCO_TEX, transparent: true, depthWrite: false });
    const trkLbl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), trkLblMat); trkLbl.position.set(0.4, 3.3, 2.12); g.add(trkLbl);
    const trkLbl2 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), trkLblMat); trkLbl2.position.set(0.4, 3.3, -2.12); trkLbl2.rotation.y = Math.PI; g.add(trkLbl2);
    // Chassis and wheels
    const ch = new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, 2.6), M.dark as any); ch.position.set(0, 0.7, 0); g.add(ch);
    const wGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.7, 18); wGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.75, 10); hubGeo.rotateX(Math.PI / 2);
    const wheels: THREE.Mesh[] = [];
    const wp = [[6.5, 1.05, 1.6], [6.5, 1.05, -1.6], [-1.0, 1.05, 1.7], [-1.0, 1.05, -1.7], [2.0, 1.05, 1.7], [2.0, 1.05, -1.7]];
    for (const p of wp) {
      const w = new THREE.Mesh(wGeo, M.rubber as any); w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w); wheels.push(w);
      const hub = new THREE.Mesh(hubGeo, M.steel as any); hub.position.set(p[0], p[1], p[2]); g.add(hub); wheels.push(hub);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 6), M.dark as any);
        lug.rotation.x = Math.PI / 2; lug.position.set(p[0] + Math.cos(a) * 0.35, p[1], p[2] + Math.sin(a) * 0.35); g.add(lug);
      }
    }
    // Fenders over the rear wheels
    for (const z of [1.9, -1.9]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.5, 0.1), M.rubber as any); f.position.set(0.5, 1.6, z); g.add(f);
    }
    g.userData = { wheels, sgFill, port, portRing, headBeam, hlMat, stack };
    return g;
  }
  const truck = buildTruck(); truck.position.set(TRUCK_AWAY_X, 0, 0); truck.visible = false; scene.add(truck);
  function setTruckFill(lvl: number) {
    lvl = Math.max(0, Math.min(1, lvl));
    truckOilPlane.constant = 0.6 + lvl * 4.0;
    const ud: any = truck.userData; const h = lvl * 3.4;
    ud.sgFill.scale.y = h; ud.sgFill.position.y = 0.95 + h / 2;
  }

  // --- hose (animated, with oil droplets inside during transfer) ---
  const hoseGroup = new THREE.Group(); scene.add(hoseGroup);
  let hoseDroplets: THREE.Mesh[] = [];
  let hoseCurve: THREE.CatmullRomCurve3 | null = null;
  function clearHose() {
    while (hoseGroup.children.length) hoseGroup.remove(hoseGroup.children[0]);
    hoseDroplets = []; hoseCurve = null;
  }
  function updateHose(deploy: number) {
    clearHose();
    if (deploy <= 0.001) return;
    const portWorld = new THREE.Vector3();
    (truck.userData as any).port.getWorldPosition(portWorld);
    const from = TANK_OUT.clone();
    const to = portWorld;
    const end = from.clone().lerp(to, deploy);
    const mid = from.clone().add(end).multiplyScalar(0.5);
    mid.y -= 1.6 * Math.min(deploy, 1); // heavy sag
    const curve = new THREE.CatmullRomCurve3([from, mid, end]);
    hoseCurve = curve;
    const segs = Math.max(10, Math.floor(24 * deploy));
    const geo = new THREE.TubeGeometry(curve, segs, 0.24, 12, false);
    const mesh = new THREE.Mesh(geo, M.hose as any); mesh.castShadow = true; hoseGroup.add(mesh);
    const braidGeo = new THREE.TubeGeometry(curve, segs, 0.225, 12, false);
    const braid = new THREE.Mesh(braidGeo, M.hoseBraid as any); braid.castShadow = false; hoseGroup.add(braid);
    if (deploy > 0.2) {
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.18, 0.85, 12), M.dark as any);
      const dir = end.clone().sub(mid).normalize();
      nz.position.copy(end);
      nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      hoseGroup.add(nz);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 16), M.steel as any);
      collar.position.copy(end); hoseGroup.add(collar);
    }
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 14), M.steel as any);
    flange.rotation.z = Math.PI / 2; flange.position.copy(from); hoseGroup.add(flange);
  }
  function buildHoseDroplets(n: number) {
    for (let i = 0; i < n; i++) {
      const d = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xffc24a, emissive: 0x664400, emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.3, transparent: true })
      );
      hoseGroup.add(d); hoseDroplets.push(d);
    }
  }
  function animateHoseDroplets(tt: number) {
    if (!hoseCurve || !hoseDroplets.length) return;
    for (let i = 0; i < hoseDroplets.length; i++) {
      const d = hoseDroplets[i];
      const phase = (tt * 0.35 + i / hoseDroplets.length) % 1;
      const p = hoseCurve.getPoint(phase);
      d.position.copy(p);
      const mat = (d.material as THREE.MeshStandardMaterial);
      const op = Math.min(1, phase * 6) * Math.min(1, (1 - phase) * 6);
      mat.opacity = op;
      d.visible = op > 0.05;
    }
  }

  // --- VIP badge (special part) ---
  const vipGroup = new THREE.Group();
  const vipFlag = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.06), new THREE.MeshBasicMaterial({ color: 0xffce3a, transparent: true, opacity: 0.95 }));
  vipFlag.position.y = 11.6; vipGroup.add(vipFlag);
  const vipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffce3a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  vipGlow.scale.set(6, 6, 1); vipGlow.position.set(0, 11.6, 0); vipGroup.add(vipGlow);
  vipGroup.position.copy(PUMP_POS); vipGroup.visible = false; scene.add(vipGroup);

  // --- dust particles ---
  const dustGeo = new THREE.BufferGeometry(); const N = 200;
  const dustPos = new Float32Array(N * 3), dustVel = new Float32Array(N * 3), dustLife = new Float32Array(N);
  for (let i = 0; i < N; i++) { dustPos[i * 3] = 9999; dustLife[i] = 0; }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xb8956a, size: 0.32, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(dust);
  let dustI = 0;
  function spawnDust(x: number, y: number, z: number) {
    const i = dustI % N; dustI++;
    dustPos[i * 3] = x + (Math.random() - 0.5) * 0.6; dustPos[i * 3 + 1] = y; dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
    dustVel[i * 3] = (Math.random() - 0.5) * 1.2; dustVel[i * 3 + 1] = Math.random() * 1.5 + 0.4; dustVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
    dustLife[i] = 1.0;
  }
  function updateParticles(dt: number) {
    for (let i = 0; i < N; i++) {
      if (dustLife[i] <= 0) continue;
      dustPos[i * 3] += dustVel[i * 3] * dt; dustPos[i * 3 + 1] += dustVel[i * 3 + 1] * dt; dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
      dustVel[i * 3 + 1] -= 2.2 * dt; dustLife[i] -= dt * 0.8;
      if (dustLife[i] <= 0) dustPos[i * 3] = 9999;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // --- smoke (from pump motor while running) ---
  const smokeTex = (function () {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, 'rgba(190,190,190,0.85)'); g.addColorStop(0.5, 'rgba(150,150,150,0.4)'); g.addColorStop(1, 'rgba(150,150,150,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const SMK = 14, smkPuffs: any[] = [];
  for (let i = 0; i < SMK; i++) {
    const m = new THREE.SpriteMaterial({ map: smokeTex, color: 0xcccccc, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(m); sp.scale.set(1.4, 1.4, 1); sp.position.set(9999, 9999, 9999); scene.add(sp);
    smkPuffs.push({ sp, life: 0, vel: new THREE.Vector3() });
  }
  let smkI = 0;
  function spawnSmoke(x: number, y: number, z: number) {
    const p = smkPuffs[smkI % SMK]; smkI++;
    p.sp.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    p.vel.set((Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.5);
    p.life = 1.0; p.sp.material.opacity = 0.62; p.sp.scale.set(2.0, 2.0, 1);
  }
  function updateSmoke(dt: number) {
    for (const p of smkPuffs) {
      if (p.life <= 0) continue;
      p.sp.position.x += p.vel.x * dt; p.sp.position.y += p.vel.y * dt; p.sp.position.z += p.vel.z * dt;
      p.vel.y *= 0.99; p.vel.x *= 0.97; p.vel.z *= 0.97;
      const s = 2.0 + (1 - p.life) * 4.6; p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = 0.62 * p.life; p.life -= dt * 0.26;
      if (p.life <= 0) p.sp.position.set(9999, 9999, 9999);
    }
  }

  // --- pumpjack animation ---
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  let crankPhase = 0;
  function updatePump(dt: number, tt: number) {
    const ud: any = pump.userData;
    // During transfer we keep the pump running (it's actively pushing oil out).
    const speed = pumping || sellState.state === ST.TRANSFER ? 2.4 : 0;
    const prev = crankPhase;
    crankPhase += speed * dt;
    ud.crank.rotation.z = crankPhase;
    const beamAng = -0.22 * Math.sin(crankPhase);
    ud.beam.rotation.z = beamAng;
    const cy = ud.postH - 2.6, R = ud.crankR;
    _v1.set(Math.cos(crankPhase) * R, cy + Math.sin(crankPhase) * R, 0);
    const bh = ud.beamHalf;
    _v2.set(Math.cos(beamAng) * bh, ud.postH + Math.sin(beamAng) * bh, 0);
    const mid = _v1.clone().add(_v2).multiplyScalar(0.5);
    ud.pit.position.copy(mid);
    const dir = _v2.clone().sub(_v1); const len = dir.length();
    ud.pit.scale.y = len; dir.normalize();
    ud.pit.quaternion.setFromUnitVectors(_up, dir);
    const hhPivot = new THREE.Vector3(0, ud.postH, 0);
    const hhLocal = new THREE.Vector3(-3.9, 1.0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), beamAng);
    const hhWorld = hhPivot.clone().add(hhLocal);
    const wellTop = new THREE.Vector3(-4.6, 1.6, 0);
    const rodMid = wellTop.clone().add(hhWorld).multiplyScalar(0.5);
    const rodLen = hhWorld.y - wellTop.y;
    ud.sucker.position.copy(rodMid);
    ud.sucker.scale.y = Math.max(0.1, rodLen);
    ud.sucker.quaternion.setFromUnitVectors(_up, new THREE.Vector3(0, 1, 0));
    if (sellState.state === ST.HOSE_OUT || sellState.state === ST.HOSE_IN) {
      ud.reelDrum.rotation.x += dt * 6 * (sellState.state === ST.HOSE_OUT ? 1 : -1);
    }
    if (pumping || sellState.state === ST.TRANSFER) {
      const cycle = (crankPhase % (Math.PI * 2));
      const prevCycle = (prev % (Math.PI * 2));
      if (prevCycle < Math.PI * 1.5 && cycle >= Math.PI * 1.5) spawnDust(-4.6, 0.4, (Math.random() - 0.5) * 1.5);
      const blink = (Math.sin(tt * 6) > 0) ? 1 : 0;
      const beaconMul = sellState.state === ST.TRANSFER ? 1 : lightMul;
      ud.lampMat.emissiveIntensity = blink * 2.6 * beaconMul;
      ud.lampLight.intensity = blink * 2.2 * beaconMul;
      ud.lampGlow.material.opacity = blink * 0.85 * beaconMul;
      ud.smkTimer = (ud.smkTimer || 0) + dt;
      if (ud.smkTimer > 0.13) { ud.smkTimer = 0; spawnSmoke(2.4, 1.9, 1.2); }
    } else {
      ud.lampMat.emissiveIntensity = 0; ud.lampLight.intensity = 0; ud.lampGlow.material.opacity = 0;
    }
    if (vip) { vipGroup.visible = true; const pul = 0.35 + 0.2 * Math.sin(tt * 2.4); vipGlow.material.opacity = pul; vipFlag.rotation.y = Math.sin(tt * 1.5) * 0.2; }
    else vipGroup.visible = false;
  }

  // ============================================================
  //   SELL STATE MACHINE
  // ============================================================
  const ST = {
    IDLE: 'idle', ARRIVE: 'arriving', LIGHTS_ON: 'lights_on', HOSE_OUT: 'connecting',
    TRANSFER: 'transferring', LIGHTS_RESTORE: 'lights_restore', HOSE_IN: 'retracting',
    LEAVE: 'departing', DONE: 'done',
  } as const;

  type SellStateObj = {
    state: typeof ST[keyof typeof ST];
    t: number;
    truckX: number;
    truckFill: number;
    animTank: number;
    hose: number;
    sellStart: number;
    lightTarget: number;
    lightCur: number;
    oilCollected: number;
    oilTarget: number;
    coinsEarned: number;
    headBeam: number;
  };
  const sellState: SellStateObj = {
    state: ST.IDLE, t: 0, truckX: TRUCK_AWAY_X, truckFill: 0, animTank: 0, hose: 0,
    sellStart: 0, lightTarget: 0, lightCur: 0, oilCollected: 0, oilTarget: 0, coinsEarned: 0,
    headBeam: 0,
  };
  let lightMul = 1;

  // Phase durations (seconds). The whole sequence is ~22s.
  const DUR = {
    ARRIVE: 4.8, LIGHTS_ON: 1.0, HOSE_OUT: 2.0, TRANSFER: 7.5,
    LIGHTS_RESTORE: 1.2, HOSE_IN: 1.8, LEAVE: 4.6,
  };

  function easeInOut(k: number) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }

  function displayTankLevel() {
    return sellState.state === ST.IDLE ? oilRatio : sellState.animTank;
  }

  const listeners = new Set<(p: SellProgress) => void>();
  function emit() {
    const totalDur = DUR.ARRIVE + DUR.LIGHTS_ON + DUR.HOSE_OUT + DUR.TRANSFER + DUR.LIGHTS_RESTORE + DUR.HOSE_IN + DUR.LEAVE;
    let elapsed = 0;
    const order: Array<[typeof ST[keyof typeof ST], number]> = [
      [ST.ARRIVE, DUR.ARRIVE], [ST.LIGHTS_ON, DUR.LIGHTS_ON], [ST.HOSE_OUT, DUR.HOSE_OUT],
      [ST.TRANSFER, DUR.TRANSFER], [ST.LIGHTS_RESTORE, DUR.LIGHTS_RESTORE],
      [ST.HOSE_IN, DUR.HOSE_IN], [ST.LEAVE, DUR.LEAVE],
    ];
    for (const [st, d] of order) {
      if (sellState.state === st) { elapsed += sellState.t; break; }
      if (sellState.state === ST.IDLE) { elapsed = 0; break; }
      if (sellState.state === ST.DONE) { elapsed = totalDur; break; }
      elapsed += d;
    }
    const progress = Math.max(0, Math.min(1, elapsed / totalDur));
    const p: SellProgress = {
      phase: sellState.state as SellPhase,
      progress,
      oilCollected: Math.round(sellState.oilCollected),
      oilTarget: Math.round(sellState.oilTarget),
      coinsEarned: Math.round(sellState.coinsEarned),
    };
    for (const cb of listeners) cb(p);
  }

  function spawnArrivalDust() {
    const x = sellState.truckX - 3;
    for (let i = 0; i < 3; i++) spawnDust(x + Math.random() * 1.5, 0.3, (Math.random() - 0.5) * 2);
  }
  function spawnDepartureDust() {
    const x = sellState.truckX + 3;
    for (let i = 0; i < 3; i++) spawnDust(x - Math.random() * 1.5, 0.3, (Math.random() - 0.5) * 2);
  }

  function stepState(dt: number) {
    const S = sellState;
    S.t += dt;
    switch (S.state) {
      case ST.IDLE: break;
      case ST.ARRIVE: {
        const k = Math.min(1, S.t / DUR.ARRIVE);
        S.truckX = TRUCK_AWAY_X + (TRUCK_PARK_X - TRUCK_AWAY_X) * easeInOut(k);
        S.headBeam = 1;
        if (Math.random() < 0.4) spawnArrivalDust();
        if (k >= 1) {
          S.truckX = TRUCK_PARK_X;
          S.state = ST.LIGHTS_ON; S.t = 0;
          S.lightTarget = 1;
          S.headBeam = 0;
        }
        break;
      }
      case ST.LIGHTS_ON: {
        const k = Math.min(1, S.t / DUR.LIGHTS_ON);
        S.lightTarget = 1;
        if (k >= 1) { S.state = ST.HOSE_OUT; S.t = 0; }
        break;
      }
      case ST.HOSE_OUT: {
        const k = Math.min(1, S.t / DUR.HOSE_OUT);
        S.hose = easeInOut(k);
        if (k >= 1) {
          S.hose = 1;
          // Wait for the server's authoritative sale numbers before
          // transferring. This lets the truck roll in while the network
          // call is in flight, but pauses (with the hose connected) until
          // setSaleResult() pushes the real litres+coins — so the moment-
          // by-moment counter always climbs toward the truth.
          if (S.oilTarget > 0) { S.state = ST.TRANSFER; S.t = 0; buildHoseDroplets(10); S.lightTarget = 0.18; }
          else { /* hold in HOSE_OUT waiting for the server */ S.t = DUR.HOSE_OUT - 0.05; }
        }
        break;
      }
      case ST.TRANSFER: {
        const k = Math.min(1, S.t / DUR.TRANSFER);
        const ek = easeInOut(k);
        // Scale transfer by the actual sale size so big sales transfer
        // proportionally more "visually" (the ratio 0..1 of tank level).
        S.animTank = S.sellStart * (1 - ek);
        S.truckFill = S.sellStart * ek;
        S.oilCollected = S.oilTarget * ek;
        S.lightTarget = 0.18;
        if (k >= 1) {
          S.animTank = 0; S.truckFill = S.sellStart; S.oilCollected = S.oilTarget;
          S.state = ST.LIGHTS_RESTORE; S.t = 0;
          S.lightTarget = 1;
          clearHose();
        }
        break;
      }
      case ST.LIGHTS_RESTORE: {
        const k = Math.min(1, S.t / DUR.LIGHTS_RESTORE);
        S.lightTarget = 1;
        if (k >= 1) { S.state = ST.HOSE_IN; S.t = 0; }
        break;
      }
      case ST.HOSE_IN: {
        const k = Math.min(1, S.t / DUR.HOSE_IN);
        S.hose = 1 - easeInOut(k);
        if (k >= 1) { S.hose = 0; S.state = ST.LEAVE; S.t = 0; S.headBeam = 1; }
        break;
      }
      case ST.LEAVE: {
        const k = Math.min(1, S.t / DUR.LEAVE);
        S.truckX = TRUCK_PARK_X + (TRUCK_AWAY_X - TRUCK_PARK_X) * easeInOut(k);
        if (Math.random() < 0.4) spawnDepartureDust();
        if (k >= 1) {
          S.truckX = TRUCK_AWAY_X;
          S.truckFill = 0; S.state = ST.DONE; S.t = 0;
          truck.visible = false; S.headBeam = 0; S.lightTarget = 0;
        }
        break;
      }
      case ST.DONE: break;
    }
    truck.position.x = S.truckX;
    const dx = S.truckX - (truck as any)._px; if ((truck as any)._px === undefined) (truck as any)._px = S.truckX;
    const wheels = (truck.userData as any).wheels;
    for (const w of wheels) w.rotation.z -= dx / 1.05;
    (truck as any)._px = S.truckX;

    S.lightCur += (S.lightTarget - S.lightCur) * Math.min(1, dt * 4);
    lightMul = S.state === ST.IDLE ? 1 : Math.max(0.18, S.lightCur);
    const ud: any = truck.userData;
    const hb = S.headBeam;
    ud.headBeam.intensity = hb * 2.2;
    ud.hlMat.emissiveIntensity = 0.4 + hb * 1.4;

    emit();
  }

  function triggerSell() {
    if (sellState.state !== ST.IDLE && sellState.state !== ST.DONE) return;
    const S = sellState;
    S.sellStart = displayTankLevel();
    S.animTank = S.sellStart;
    S.state = ST.ARRIVE; S.t = 0; S.truckX = TRUCK_AWAY_X;
    truck.visible = true; truck.position.x = TRUCK_AWAY_X;
    S.truckFill = 0; S.hose = 0; S.oilCollected = 0;
    S.oilTarget = 0; S.coinsEarned = 0;
    S.headBeam = 1; S.lightTarget = 0; S.lightCur = 0;
    emit();
  }

  // --- tap detection ---
  let downX = 0, downY = 0, downT = 0, isDown = false;
  function onDown(e: PointerEvent) { isDown = true; downX = e.clientX; downY = e.clientY; downT = performance.now(); }
  function onUp(e: PointerEvent) {
    if (!isDown) return; isDown = false;
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    const dt = performance.now() - downT;
    if (dist < 10 && dt < 320) onTap();
  }
  canvas.addEventListener('pointerdown', onDown as any);
  canvas.addEventListener('pointerup', onUp as any);

  // --- sizing ---
  let lastPortrait: boolean | null = null;
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const portrait = h > w;
    if (lastPortrait !== portrait) {
      lastPortrait = portrait;
      if (portrait) { camera.position.set(48, 30, 60); controls.target.set(14, 6, 0); }
      else { camera.position.set(37, 22, 46); controls.target.set(16, 8, 0); }
      controls.update();
    }
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  // --- main loop ---
  let last = performance.now();
  let rafId = 0;
  function frame(now: number) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const tt = now * 0.001;
    dPumps.forEach((p, i) => { (p.children[1] as any).rotation.z = Math.sin(tt * 1.5 + i) * 0.2; });
    updatePump(dt, tt);
    stepState(dt);
    setTankLevel(displayTankLevel());
    setTruckFill(sellState.truckFill);
    updateHose(sellState.hose);
    if (sellState.state === ST.TRANSFER) animateHoseDroplets(tt);
    updateParticles(dt);
    updateSmoke(dt);
    updateSky(tt, dt);
    const li = sellState.lightCur;
    lampPump.bulbMat.emissiveIntensity = li * 2.2;
    lampPump.glow.material.opacity = li * 0.7;
    lampTruck.bulbMat.emissiveIntensity = li * 2.2;
    lampTruck.glow.material.opacity = li * 0.7;
    workPumpSpot.intensity = li * 3.2;
    workTruckSpot.intensity = li * 3.2;
    workFill.intensity = li * 2.2;
    controls.update();
    renderer.render(scene, camera);
  }
  rafId = requestAnimationFrame(frame);

  return {
    setPumping(b: boolean) { pumping = !!b; },
    setOilRatio(r: number) { oilRatio = Math.max(0, Math.min(1, Number(r) || 0)); },
    setParts(_p: PumpSceneParts) { /* production multipliers are applied by the host */ },
    setSpecialParts(s: PumpSceneSpecial) { vip = !!s.vip_badge; specialBg = !!s.new_background; },
    triggerSell,
    setSaleResult(oilSold: number, coinsEarned: number) {
      sellState.oilTarget = Math.max(0, Number(oilSold) || 0);
      sellState.coinsEarned = Math.max(0, Number(coinsEarned) || 0);
      // If we were holding in HOSE_OUT waiting for the server numbers,
      // unblock the transfer now.
      if (sellState.state === ST.HOSE_OUT && sellState.hose >= 1 && sellState.oilTarget > 0) {
        sellState.state = ST.TRANSFER; sellState.t = 0;
        buildHoseDroplets(10);
        sellState.lightTarget = 0.18;
      }
      emit();
    },
    resetSell() {
      const S = sellState;
      S.state = ST.IDLE; S.t = 0; S.truckX = TRUCK_AWAY_X;
      S.truckFill = 0; S.animTank = 0; S.hose = 0;
      S.oilCollected = 0; S.oilTarget = 0; S.coinsEarned = 0;
      S.lightTarget = 0; S.lightCur = 0; S.headBeam = 0;
      truck.visible = false; clearHose(); lightMul = 1;
      emit();
    },
    onSellEvent(cb: (p: SellProgress) => void) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown as any);
      canvas.removeEventListener('pointerup', onUp as any);
      controls.dispose();
      renderer.dispose();
      scene.traverse((o: any) => { if (o.geometry) o.geometry.dispose?.(); if (o.material) { if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.()); else o.material.dispose?.(); } });
    },
  };
}
