// Everything you can see. The rules live in game.js; this file only draws them.
//
// The camera copies the Unity game: a perspective lens at 32 degrees, tilted 22 degrees off
// straight-down, so bulkheads and figures read as solids rather than as a flat map.

import * as THREE from '../vendor/three/three.module.js';
import { MAP, COLORS } from './map.js';

const worldX = (x) => x + 0.5 - MAP.rows[0].length / 2;
const worldZ = (y) => y + 0.5 - MAP.rows.length / 2;

export class View {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.background);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 900);
    this.pitch = THREE.MathUtils.degToRad(90 - MAP.cameraTilt);
    this.target = new THREE.Vector3(0, 0, 0);
    this.zoom = 1;
    this.dist = 54;

    this.unitViews = new Map();
    this.markers = [];
    this.tracerPool = [];
    this.tracerUsed = 0;

    this.clock = 0;
    this.addLights();
    this.buildMap();
    this.buildChests();
    this.buildPathLayer();
    this.buildFog();
    this.buildEffects();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------------ scene furniture

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0x8fc3e4, 0x0b1a26, 1.15));

    const sun = new THREE.DirectionalLight(0xfff2dc, 1.5);
    sun.position.set(-26, 46, 18);
    sun.castShadow = true;
    const cam = sun.shadow.camera;
    cam.left = -34;
    cam.right = 34;
    cam.top = 30;
    cam.bottom = -30;
    cam.near = 1;
    cam.far = 130;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
  }

  buildMap() {
    const { cols, rows } = this.game.map;

    const waterGeo = new THREE.PlaneGeometry(cols + 120, rows + 120, 60, 60);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      waterGeo,
      new THREE.MeshStandardMaterial({
        color: 0x17516f,
        roughness: 0.32,
        metalness: 0.15,
        flatShading: true,
      })
    );
    water.position.y = -0.42;
    water.receiveShadow = true;
    this.water = water;
    this.waterBase = waterGeo.attributes.position.array.slice();
    this.scene.add(water);

    // Deck, plank, wall and hatch cells, grouped so each needs one draw call.
    const deckCells = [];
    const plankCells = [];
    const wallCells = [];
    const hatchCells = [];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const surface = this.game.map.surface(x, y);
        if (surface === 'wall') wallCells.push([x, y]);
        else if (surface === 'hatch') hatchCells.push([x, y]);
        else if (surface === 'plank') plankCells.push([x, y]);
        else if (surface === 'deck') deckCells.push([x, y]);
      }
    }

    const deckGeo = new THREE.BoxGeometry(0.97, 0.3, 0.97);
    const deckMat = new THREE.MeshStandardMaterial({ color: COLORS.deck, roughness: 0.92 });

    const deck = new THREE.InstancedMesh(deckGeo, deckMat, deckCells.length);
    deck.receiveShadow = true;
    deck.castShadow = false;
    const matrix = new THREE.Matrix4();
    const shade = new THREE.Color();
    deckCells.forEach(([x, y], i) => {
      matrix.makeTranslation(worldX(x), -0.15, worldZ(y));
      deck.setMatrixAt(i, matrix);
      // A little variation per cell, so the deck reads as planking rather than as tiles.
      const tint = 0.9 + ((x * 7 + y * 13) % 5) * 0.035;
      shade.setRGB(tint, tint * 0.97, tint * 0.92);
      deck.setColorAt(i, shade);
    });
    deck.instanceColor.needsUpdate = true;
    this.scene.add(deck);

    const plank = new THREE.InstancedMesh(
      deckGeo,
      new THREE.MeshStandardMaterial({ color: COLORS.plank, roughness: 0.88 }),
      plankCells.length
    );
    plank.receiveShadow = true;
    const plankScale = new THREE.Vector3(1, 0.72, 1);
    const identity = new THREE.Quaternion();
    plankCells.forEach(([x, y], i) => {
      matrix.compose(
        new THREE.Vector3(worldX(x), -0.13, worldZ(y)),
        identity,
        plankScale
      );
      plank.setMatrixAt(i, matrix);
    });
    this.scene.add(plank);

    const wallGeo = new THREE.BoxGeometry(1, 1.3, 1);
    const wall = new THREE.InstancedMesh(
      wallGeo,
      new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.95 }),
      wallCells.length
    );
    wall.castShadow = true;
    wall.receiveShadow = true;
    wallCells.forEach(([x, y], i) => {
      matrix.makeTranslation(worldX(x), 0.65, worldZ(y));
      wall.setMatrixAt(i, matrix);
      const tint = 0.86 + ((x * 3 + y * 5) % 4) * 0.05;
      shade.setRGB(tint, tint, tint);
      wall.setColorAt(i, shade);
    });
    wall.instanceColor.needsUpdate = true;
    this.scene.add(wall);

    const hatchGeo = new THREE.BoxGeometry(0.9, 0.14, 0.9);
    const hatch = new THREE.InstancedMesh(
      hatchGeo,
      new THREE.MeshStandardMaterial({
        color: COLORS.hatch,
        roughness: 0.6,
        emissive: new THREE.Color(COLORS.hatch).multiplyScalar(0.18),
      }),
      hatchCells.length
    );
    hatch.receiveShadow = true;
    hatchCells.forEach(([x, y], i) => {
      matrix.makeTranslation(worldX(x), 0.07, worldZ(y));
      hatch.setMatrixAt(i, matrix);
    });
    this.scene.add(hatch);
  }

  buildChests() {
    this.chestViews = new Map();
    for (const chest of this.game.chests) {
      const group = new THREE.Group();
      const color = chest.team === 'squad' ? COLORS.squadChest : COLORS.hostileChest;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.4, 0.44),
        new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25 })
      );
      body.position.y = 0.2;
      body.castShadow = true;
      group.add(body);
      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.62, 10, 1, false, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x2b1a0e, roughness: 0.7 })
      );
      lid.rotation.z = Math.PI / 2;
      lid.position.y = 0.4;
      group.add(lid);
      this.scene.add(group);
      this.chestViews.set(chest, group);
    }
  }

  buildPathLayer() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 256), 3));
    this.pathLine = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.9 })
    );
    this.pathLine.frustumCulled = false;
    this.scene.add(this.pathLine);

    const markerGeo = new THREE.RingGeometry(0.16, 0.24, 16);
    markerGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const marker = new THREE.Mesh(
        markerGeo,
        new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.85 })
      );
      marker.visible = false;
      this.scene.add(marker);
      this.markers.push(marker);
    }

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.44, 0.54, 28),
      new THREE.MeshBasicMaterial({
        color: COLORS.hatch,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
  }

  buildFog() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.fog,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
    });
    const count = this.game.map.cols * this.game.map.rows;
    this.fog = new THREE.InstancedMesh(geo, mat, count);
    this.fog.frustumCulled = false;
    this.scene.add(this.fog);
    this.refreshFog(true);
  }

  buildEffects() {
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.noisePool = [];
    for (let i = 0; i < 12; i++) {
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffd27a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      ring.visible = false;
      this.scene.add(ring);
      this.noisePool.push(ring);
    }

    for (let i = 0; i < 40; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 1 })
      );
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this.tracerPool.push(line);
    }
  }

  // ------------------------------------------------------------------ units

  makeUnitView(unit) {
    const group = new THREE.Group();
    const color = unit.cls.color;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.56, 6, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.62 })
    );
    body.position.y = 0.58;
    body.castShadow = true;
    group.add(body);

    // A wedge on the chest, so facing is readable from the game's own camera angle.
    const wedge = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.38, 4),
      new THREE.MeshStandardMaterial({ color: 0x12222c, roughness: 0.5 })
    );
    wedge.rotation.z = -Math.PI / 2;
    wedge.position.set(0.42, 0.66, 0);
    group.add(wedge);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.37, 24),
      new THREE.MeshBasicMaterial({
        color: unit.team === 'squad' ? COLORS.squad : COLORS.hostile,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    // One pip per point of health: health is 1 or 2 by class.
    const pips = [];
    for (let i = 0; i < unit.maxHp; i++) {
      const pip = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xf4fbff })
      );
      pip.position.set((i - (unit.maxHp - 1) / 2) * 0.18, 1.14, 0);
      group.add(pip);
      pips.push(pip);
    }

    this.scene.add(group);
    this.unitViews.set(unit.id, { group, body, pips, ring });
  }

  syncUnits() {
    for (const unit of this.game.units) {
      if (!this.unitViews.has(unit.id)) this.makeUnitView(unit);
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt) {
    this.clock += dt;
    const game = this.game;
    this.syncUnits();

    const visible = game.visibleCells();

    for (const unit of game.units) {
      const view = this.unitViews.get(unit.id);
      if (!view) continue;
      const shown = unit.alive && (unit.team === 'squad' || visible.has(unit.cellX + ',' + unit.cellY));
      view.group.visible = shown;
      if (!shown) continue;

      const bob = Math.sin(this.clock * 6 + unit.bob) * 0.015;
      view.group.position.set(worldX(unit.x), bob, worldZ(unit.y));
      view.group.rotation.y = Math.atan2(-unit.face.y, unit.face.x);

      view.body.material.color.setHex(unit.cls.color);
      if (unit.hurt > 0) view.body.material.emissive.setRGB(0.8, 0.1, 0.05);
      else view.body.material.emissive.setRGB(0, 0, 0);
      if (unit.alert > 0 && unit.team === 'hostile') view.ring.material.color.setHex(0xffe08a);
      else view.ring.material.color.setHex(unit.team === 'squad' ? COLORS.squad : COLORS.hostile);

      view.pips.forEach((pip, i) => {
        pip.visible = i < unit.hp;
      });
    }

    for (const [chest, group] of this.chestViews) {
      const carrier = chest.carrier;
      const x = carrier ? carrier.x : chest.x;
      const y = carrier ? carrier.y : chest.y;
      group.position.set(worldX(x), carrier ? 0.55 : 0, worldZ(y));
      // A chest is only drawn where a raider could see it: carried or standing on visible deck.
      const inSight = carrier
        ? carrier.team === 'squad' || visible.has(carrier.cellX + ',' + carrier.cellY)
        : visible.has(chest.x + ',' + chest.y);
      group.visible = inSight;
    }

    const selected = game.selected;
    if (selected && selected.alive) {
      this.selectionRing.visible = true;
      this.selectionRing.position.set(worldX(selected.x), 0.035, worldZ(selected.y));
    } else {
      this.selectionRing.visible = false;
    }

    if (game.dirtyPaths) {
      this.refreshPath();
      game.dirtyPaths = false;
    }
    if (game.dirtyVision) {
      this.refreshFog();
      game.dirtyVision = false;
    }

    this.updateNoise();
    this.updateTracers();
    this.updateWater();
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  refreshPath() {
    const unit = this.game.selected;
    const positions = this.pathLine.geometry.attributes.position;
    let count = 0;

    if (unit && unit.alive && unit.plan.length) {
      const route = this.game.routeFor(unit);
      const points = [{ x: unit.x, y: unit.y }, ...route];
      const limit = Math.min(points.length, positions.count);
      for (let i = 0; i < limit; i++) {
        positions.setXYZ(i, worldX(points[i].x), 0.06, worldZ(points[i].y));
      }
      count = limit;

      let marker = 0;
      for (const waypoint of unit.plan) {
        const mesh = this.markers[marker++];
        if (!mesh) break;
        mesh.visible = true;
        mesh.position.set(worldX(waypoint.x), 0.07, worldZ(waypoint.y));
        mesh.material.color.setHex(waypoint.hold > 0 ? 0xffd27a : 0x9fe6ff);
      }
      for (; marker < this.markers.length; marker++) this.markers[marker].visible = false;
    } else {
      for (const marker of this.markers) marker.visible = false;
    }

    this.pathLine.geometry.setDrawRange(0, count);
    positions.needsUpdate = true;
  }

  refreshFog(force = false) {
    const game = this.game;
    const visible = game.visibleCells();
    const matrix = new THREE.Matrix4();
    let count = 0;
    for (let y = 0; y < game.map.rows; y++) {
      for (let x = 0; x < game.map.cols; x++) {
        if (!game.map.walkable(x, y)) continue;
        if (visible.has(x + ',' + y)) continue;
        matrix.makeTranslation(worldX(x), 0.05, worldZ(y));
        this.fog.setMatrixAt(count++, matrix);
      }
    }
    this.fog.count = count;
    this.fog.instanceMatrix.needsUpdate = true;
    if (force) this.fog.computeBoundingSphere();
  }

  updateNoise() {
    this.noisePool.forEach((ring) => {
      ring.visible = false;
    });
    this.game.noise.forEach((puff, i) => {
      const ring = this.noisePool[i];
      if (!ring) return;
      const t = puff.age / puff.life;
      ring.visible = true;
      ring.position.set(worldX(puff.x), 0.08, worldZ(puff.y));
      const scale = puff.radius * (0.25 + t * 0.95);
      ring.scale.set(scale, 1, scale);
      ring.material.opacity = (1 - t) * 0.5;
      ring.material.color.setHex(puff.team === 'squad' ? 0xffd27a : 0xff9a7a);
    });
  }

  updateTracers() {
    this.tracerUsed = 0;
    this.game.tracers.forEach((tracer) => {
      const line = this.tracerPool[this.tracerUsed++];
      if (!line) return;
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, worldX(tracer.from.x), 0.7, worldZ(tracer.from.y));
      pos.setXYZ(1, worldX(tracer.to.x), 0.7, worldZ(tracer.to.y));
      pos.needsUpdate = true;
      line.material.opacity = 1 - tracer.age / 0.18;
      line.material.color.setHex(tracer.hit ? 0xfff0c8 : 0x6f8794);
      line.visible = true;
    });
    for (let i = this.tracerUsed; i < this.tracerPool.length; i++) {
      this.tracerPool[i].visible = false;
    }
  }

  updateWater() {
    const positions = this.water.geometry.attributes.position;
    const base = this.waterBase;
    for (let i = 0; i < positions.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      positions.setY(
        i,
        Math.sin(x * 0.22 + this.clock * 0.8) * 0.09 +
          Math.cos(z * 0.3 + this.clock * 0.55) * 0.07
      );
    }
    positions.needsUpdate = true;
  }

  // ------------------------------------------------------------------ camera

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame();
  }

  frame() {
    const cols = this.game.map.cols;
    const rows = this.game.map.rows;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const halfW = cols / 2 + 2;
    const halfD = (rows / 2) * Math.sin(this.pitch) + 2;
    const fitting = Math.max(halfW / (Math.tan(vFov / 2) * this.camera.aspect), halfD / Math.tan(vFov / 2));
    this.baseDist = fitting * 1.18;
  }

  updateCamera(dt) {
    const speed = 16 * dt * this.zoom;
    if (this.keys) {
      if (this.keys.has('w')) this.target.z -= speed * 0.9;
      if (this.keys.has('s')) this.target.z += speed * 0.9;
      if (this.keys.has('a')) this.target.x -= speed;
      if (this.keys.has('d')) this.target.x += speed;
    }

    this.dist += ((this.baseDist || 54) * this.zoom - this.dist) * Math.min(1, dt * 8);
    this.camera.position.set(
      this.target.x,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.pitch) * this.dist
    );
    this.camera.lookAt(this.target);
  }

  zoomBy(factor) {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.42, 2.2);
  }

  panBy(dx, dy) {
    this.target.x -= dx * 0.04 * this.zoom;
    this.target.z -= dy * 0.045 * this.zoom;
  }

  /// Drops the per-run objects and builds them again: used when the run is restarted.
  resetFor() {
    for (const view of this.unitViews.values()) this.scene.remove(view.group);
    this.unitViews.clear();
    for (const group of this.chestViews.values()) this.scene.remove(group);
    this.chestViews.clear();
    this.buildChests();
    this.game.dirtyPaths = true;
    this.game.dirtyVision = true;
    this.target.set(0, 0, 0);
    this.zoom = 1;
  }

  /// Screen point -> deck cell, using the y = 0 plane the way the core's cursor does.
  pickCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    if (!raycaster.ray.intersectPlane(plane, point)) return null;
    const x = Math.round(point.x + this.game.map.cols / 2 - 0.5);
    const y = Math.round(point.z + this.game.map.rows / 2 - 0.5);
    if (x < 0 || y < 0 || x >= this.game.map.cols || y >= this.game.map.rows) return null;
    return { x, y };
  }
}
