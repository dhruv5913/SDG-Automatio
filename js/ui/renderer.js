(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var TILES_2D = {
    river:       { fill: '#1b639e', left: '#144d7c', right: '#103e63', wave: true, h: 4 },
    dirt:        { fill: '#5e4834', left: '#483727', right: '#382b1e', ground: true, h: 8 },
    floor:       { fill: '#414754', left: '#323742', right: '#262a33', ground: true, h: 8 },
    lot:         { fill: '#444a56', left: '#343942', right: '#272b32', ground: true, h: 8 },
    barren:      { fill: '#736347', left: '#5a4d37', right: '#453b2a', ground: true, h: 8 },
    farm:        { fill: '#3d7e37', left: '#2d5e29', right: '#20431c', h: 8 },
    shelter:     { fill: '#8f715c', left: '#6d5545', right: '#524034', h: 8 },
    panel:       { fill: '#2e4f82', left: '#213b63', right: '#182b47', h: 8 },
    mine:        { fill: '#4f4a56', left: '#3d3942', right: '#2d2a30', h: 8 },
    recycler:    { fill: '#327254', left: '#25543e', right: '#1a3c2c', h: 8 },
    forest:      { fill: '#2e7035', left: '#215427', right: '#173d1c', h: 8 },
    wetland:     { fill: '#31857b', left: '#236159', right: '#19453f', h: 6 },
    factory:     { fill: '#625b68', left: '#4c4652', right: '#39343d', h: 8 },
    filter:      { fill: '#4175a8', left: '#30577d', right: '#233f5c', h: 8 },
    gym:         { fill: '#834e9a', left: '#623a73', right: '#472a54', h: 8 },
    park:        { fill: '#42994e', left: '#307039', right: '#225229', h: 8 },
    kitchen:     { fill: '#aa7142', left: '#825632', right: '#5e3e24', h: 8 }
  };

  function Renderer(canvas2d, canvas3d) {
    this.canvas2d = typeof canvas2d === 'string' ? document.getElementById(canvas2d) : canvas2d;
    this.canvas3d = typeof canvas3d === 'string' ? document.getElementById(canvas3d) : (canvas3d || document.getElementById('world3d'));

    if (!this.canvas2d) this.canvas2d = document.getElementById('world');
    if (!this.canvas3d) this.canvas3d = document.getElementById('world3d');

    this.ctx = this.canvas2d ? this.canvas2d.getContext('2d') : null;
    this.floaters = [];
    this.particles = [];
    this.lastEventCount = 0;
    this.flash = null;
    this.bot = { x: 1.5, y: 1.5 };
    this.botTarget = null;
    this.botState = 'idle';
    this.viewMode = '3d'; // '3d' (WebGL Real 3D) | '2d' (Top-down / 2D Canvas)

    try {
      var saved = localStorage.getItem('sdg-view-mode');
      if (saved === '2d' || saved === '3d') this.viewMode = saved;
    } catch (e) { /* ignore */ }

    this.useThree = !!root.THREE && !!this.canvas3d;
    if (this.useThree) {
      this.initThree();
    }

    this.updateCanvasVisibility();
    this.resize();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    this.initCameraControls();
  }

  Renderer.prototype.updateCanvasVisibility = function () {
    var is3D = this.viewMode === '3d' && this.useThree;
    if (this.canvas3d) this.canvas3d.style.display = is3D ? 'block' : 'none';
    if (this.canvas2d) this.canvas2d.style.display = is3D ? 'none' : 'block';

    var camControls = document.getElementById('camControls');
    if (camControls) camControls.style.display = is3D ? 'flex' : 'none';
    var camHint = document.getElementById('camHint');
    if (camHint) camHint.style.display = is3D ? 'block' : 'none';
  };

  // =========================================================================
  // THREE.JS REAL 3D ENGINE
  // =========================================================================

  Renderer.prototype.initThree = function () {
    var THREE = root.THREE;
    var canvas = this.canvas3d;
    if (!canvas) {
      this.useThree = false;
      return;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e131a);
    this.scene.fog = new THREE.FogExp2(0x0e131a, 0.015);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 300);
    this.camTarget = new THREE.Vector3(3.5, 0, 3.5);
    this.camSpherical = { radius: 24, theta: Math.PI / 4, phi: Math.PI / 3 };
    this.updateCameraPos();

    try {
      this.glRenderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
      this.glRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.glRenderer.shadowMap.enabled = true;
      this.glRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.glRenderer.toneMappingExposure = 1.15;
    } catch (e) {
      console.warn('WebGL init failed, falling back to 2D canvas', e);
      this.useThree = false;
      this.ctx = canvas.getContext('2d');
      return;
    }

    // --- Lighting ---
    this.hemiLight = new THREE.HemisphereLight(0xe8f2ff, 0x3d352c, 0.9);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff7e8, 1.8);
    this.sunLight.position.set(18, 30, 22);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 80;
    var d = 16;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Accent fill light
    this.fillLight = new THREE.DirectionalLight(0x7397b8, 0.45);
    this.fillLight.position.set(-15, 10, -15);
    this.scene.add(this.fillLight);

    // --- Object Caches & Meshes ---
    this.tileMeshes = [];
    this.humans = [];
    this.curGridHash = '';

    // Robot companion 3D model
    this.create3DBot();

    // Ground platform base
    this.createBasePlatform();

    // Shared Materials
    this.initSharedMaterials();
  };

  Renderer.prototype.updateCameraPos = function () {
    var s = this.camSpherical;
    var x = this.camTarget.x + s.radius * Math.sin(s.phi) * Math.sin(s.theta);
    var y = this.camTarget.y + s.radius * Math.cos(s.phi);
    var z = this.camTarget.z + s.radius * Math.sin(s.phi) * Math.cos(s.theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.camTarget);
  };

  Renderer.prototype.initCameraControls = function () {
    var self = this;
    var isDragging = false;
    var isPanning = false;
    var startX = 0, startY = 0;
    var targetCanvas = this.canvas3d || this.canvas2d;
    if (!targetCanvas) return;

    targetCanvas.addEventListener('mousedown', function (e) {
      if (self.viewMode !== '3d' || !self.useThree) return;
      isDragging = true;
      isPanning = e.button === 2 || e.shiftKey;
      startX = e.clientX;
      startY = e.clientY;
    });

    window.addEventListener('mousemove', function (e) {
      if (!isDragging || self.viewMode !== '3d' || !self.useThree) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      startX = e.clientX;
      startY = e.clientY;

      if (isPanning) {
        var panSpeed = self.camSpherical.radius * 0.0018;
        var forward = new root.THREE.Vector3();
        self.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        var right = new root.THREE.Vector3().crossVectors(forward, new root.THREE.Vector3(0, 1, 0)).normalize();

        self.camTarget.addScaledVector(right, -dx * panSpeed);
        self.camTarget.addScaledVector(forward, dy * panSpeed);
      } else {
        self.camSpherical.theta -= dx * 0.007;
        self.camSpherical.phi = Math.max(0.12, Math.min(Math.PI / 2.05, self.camSpherical.phi - dy * 0.007));
      }
      self.updateCameraPos();
    });

    window.addEventListener('mouseup', function () { isDragging = false; });
    targetCanvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    targetCanvas.addEventListener('wheel', function (e) {
      if (self.viewMode !== '3d' || !self.useThree) return;
      e.preventDefault();
      self.camSpherical.radius = Math.max(8, Math.min(50, self.camSpherical.radius + e.deltaY * 0.025));
      self.updateCameraPos();
    }, { passive: false });

    // Floating UI Camera Buttons
    var btnReset = document.getElementById('btnCamReset');
    var btnIso = document.getElementById('btnCamIso');
    var btnTop = document.getElementById('btnCamTop');

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        self.camTarget.set(3.5, 0, 3.5);
        self.camSpherical = { radius: 24, theta: Math.PI / 4, phi: Math.PI / 3 };
        self.updateCameraPos();
      });
    }
    if (btnIso) {
      btnIso.addEventListener('click', function () {
        self.camSpherical.theta = Math.PI / 4;
        self.camSpherical.phi = Math.PI / 3;
        self.updateCameraPos();
        btnIso.classList.add('active');
        if (btnTop) btnTop.classList.remove('active');
      });
    }
    if (btnTop) {
      btnTop.addEventListener('click', function () {
        self.camSpherical.phi = 0.08;
        self.updateCameraPos();
        btnTop.classList.add('active');
        if (btnIso) btnIso.classList.remove('active');
      });
    }
  };

  Renderer.prototype.initSharedMaterials = function () {
    var THREE = root.THREE;
    this.materials = {
      grass: new THREE.MeshStandardMaterial({ color: 0x3d703b, roughness: 0.85, metalness: 0.05 }),
      dirt: new THREE.MeshStandardMaterial({ color: 0x6e5239, roughness: 0.95 }),
      barren: new THREE.MeshStandardMaterial({ color: 0x8a7452, roughness: 0.9 }),
      floor: new THREE.MeshStandardMaterial({ color: 0x474f5d, roughness: 0.7, metalness: 0.2 }),
      lot: new THREE.MeshStandardMaterial({ color: 0x515866, roughness: 0.8 }),
      water: new THREE.MeshStandardMaterial({
        color: 0x1b7ac7,
        roughness: 0.15,
        metalness: 0.2,
        transparent: true,
        opacity: 0.88
      }),
      stone: new THREE.MeshStandardMaterial({ color: 0x8a929e, roughness: 0.8 }),
      darkWood: new THREE.MeshStandardMaterial({ color: 0x4a3221, roughness: 0.75 }),
      lightWood: new THREE.MeshStandardMaterial({ color: 0xb58c5c, roughness: 0.7 }),
      roofTile: new THREE.MeshStandardMaterial({ color: 0xb84b36, roughness: 0.65 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0xffea9f,
        emissive: 0xffd152,
        emissiveIntensity: 0.6,
        roughness: 0.2,
        metalness: 0.3
      }),
      solarCell: new THREE.MeshStandardMaterial({
        color: 0x1a3b6b,
        emissive: 0x0f2545,
        emissiveIntensity: 0.4,
        roughness: 0.25,
        metalness: 0.85
      }),
      metal: new THREE.MeshStandardMaterial({ color: 0xbdc3c7, roughness: 0.35, metalness: 0.8 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xf1f2f6, roughness: 0.15, metalness: 0.95 }),
      leafGreen: new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.85 }),
      leafDark: new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.85 }),
      carrot: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7 }),
      tomato: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 }),
      brick: new THREE.MeshStandardMaterial({ color: 0x994d38, roughness: 0.9 }),
      skin: [
        new THREE.MeshStandardMaterial({ color: 0xf5cba7, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.8 })
      ],
      clothes: [
        new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x9333ea, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x0891b2, roughness: 0.8 })
      ],
      pants: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 }),
      shoes: new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.9 }),
      hair: [
        new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.9 })
      ]
    };
  };

  Renderer.prototype.createBasePlatform = function () {
    var THREE = root.THREE;
    var baseGeo = new THREE.BoxGeometry(11, 2.5, 9.5);
    var baseMat = new THREE.MeshStandardMaterial({ color: 0x222933, roughness: 0.9 });
    var base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(3.5, -1.3, 3.5);
    base.receiveShadow = true;
    this.scene.add(base);
  };

  Renderer.prototype.create3DBot = function () {
    var THREE = root.THREE;
    var botGroup = new THREE.Group();

    // Chrome body
    var bodyGeo = new THREE.SphereGeometry(0.35, 16, 16);
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.85, roughness: 0.2 });
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    botGroup.add(body);

    // Glowing cyan visor
    var visorGeo = new THREE.TorusGeometry(0.28, 0.05, 8, 24);
    var visorMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    var visor = new THREE.Mesh(visorGeo, visorMat);
    visor.rotation.x = Math.PI / 2;
    botGroup.add(visor);

    // Outer anti-gravity ring
    var ringGeo = new THREE.TorusGeometry(0.52, 0.025, 8, 32);
    var ringMat = new THREE.MeshStandardMaterial({ color: 0x70a1ff, metalness: 0.9, roughness: 0.2 });
    this.botRing = new THREE.Mesh(ringGeo, ringMat);
    botGroup.add(this.botRing);

    // Thruster base
    var thrusterGeo = new THREE.CylinderGeometry(0.08, 0.18, 0.22, 12);
    var thrusterMat = new THREE.MeshStandardMaterial({ color: 0x2f3542, metalness: 0.7 });
    var thruster = new THREE.Mesh(thrusterGeo, thrusterMat);
    thruster.position.y = -0.32;
    botGroup.add(thruster);

    // Thruster light
    this.botLight = new THREE.PointLight(0x00f0ff, 1.2, 5);
    this.botLight.position.set(0, -0.4, 0);
    botGroup.add(this.botLight);

    botGroup.position.set(1.5, 1.6, 1.5);
    this.scene.add(botGroup);
    this.botMesh = botGroup;
  };

  // =========================================================================
  // REAL 3D HUMAN CHARACTERS ("Like a Human")
  // =========================================================================

  Renderer.prototype.createHuman = function (idx) {
    var THREE = root.THREE;
    var m = this.materials;
    var human = new THREE.Group();

    var skinMat = m.skin[idx % m.skin.length];
    var shirtMat = m.clothes[idx % m.clothes.length];
    var hairMat = m.hair[idx % m.hair.length];

    // Pelvis root
    var pelvis = new THREE.Group();
    pelvis.position.y = 0.55;
    human.add(pelvis);

    // Torso (Shirt)
    var torsoGeo = new THREE.BoxGeometry(0.3, 0.38, 0.18);
    var torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.y = 0.19;
    torso.castShadow = true;
    pelvis.add(torso);

    // Neck & Head
    var headGroup = new THREE.Group();
    headGroup.position.y = 0.44;
    pelvis.add(headGroup);

    var headGeo = new THREE.SphereGeometry(0.13, 12, 12);
    var head = new THREE.Mesh(headGeo, skinMat);
    head.castShadow = true;
    headGroup.add(head);

    // Hair
    var hairGeo = new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7);
    var hair = new THREE.Mesh(hairGeo, hairMat);
    hair.rotation.x = -0.2;
    headGroup.add(hair);

    // Eyes
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    var eyeGeo = new THREE.SphereGeometry(0.02, 6, 6);
    var leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.04, 0.02, 0.12);
    var rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.04, 0.02, 0.12);
    headGroup.add(leftEye);
    headGroup.add(rightEye);

    // Limbs - Arms
    var armGeo = new THREE.BoxGeometry(0.08, 0.32, 0.08);
    armGeo.translate(0, -0.14, 0);

    var leftArm = new THREE.Mesh(armGeo, shirtMat);
    leftArm.position.set(-0.2, 0.34, 0);
    leftArm.castShadow = true;
    pelvis.add(leftArm);

    var rightArm = new THREE.Mesh(armGeo, shirtMat);
    rightArm.position.set(0.2, 0.34, 0);
    rightArm.castShadow = true;
    pelvis.add(rightArm);

    // Limbs - Legs
    var legGeo = new THREE.BoxGeometry(0.1, 0.42, 0.1);
    legGeo.translate(0, -0.2, 0);

    var leftLeg = new THREE.Mesh(legGeo, m.pants);
    leftLeg.position.set(-0.09, 0, 0);
    leftLeg.castShadow = true;
    pelvis.add(leftLeg);

    var rightLeg = new THREE.Mesh(legGeo, m.pants);
    rightLeg.position.set(0.09, 0, 0);
    rightLeg.castShadow = true;
    pelvis.add(rightLeg);

    // Shoes
    var shoeGeo = new THREE.BoxGeometry(0.11, 0.07, 0.15);
    var leftShoe = new THREE.Mesh(shoeGeo, m.shoes);
    leftShoe.position.set(-0.09, -0.39, 0.03);
    leftShoe.castShadow = true;
    pelvis.add(leftShoe);

    var rightShoe = new THREE.Mesh(shoeGeo, m.shoes);
    rightShoe.position.set(0.09, -0.39, 0.03);
    rightShoe.castShadow = true;
    pelvis.add(rightShoe);

    human.scale.set(0.9, 0.9, 0.9);

    var hObj = {
      mesh: human,
      pelvis: pelvis,
      torso: torso,
      head: headGroup,
      leftArm: leftArm,
      rightArm: rightArm,
      leftLeg: leftLeg,
      rightLeg: rightLeg,
      x: 2 + Math.random() * 4,
      z: 2 + Math.random() * 4,
      targetX: 2 + Math.random() * 4,
      targetZ: 2 + Math.random() * 4,
      speed: 0.8 + Math.random() * 0.5,
      walkPhase: Math.random() * 10,
      state: 'walk',
      idleTimer: Math.random() * 3
    };

    human.position.set(hObj.x, 0, hObj.z);
    this.scene.add(human);
    return hObj;
  };

  Renderer.prototype.syncHumans = function (world, stage) {
    var desiredCount = 4;
    if (world.population) desiredCount = Math.max(3, Math.min(12, Math.floor(world.population / 12)));
    if (stage.id === 'stage4') desiredCount = Math.max(6, desiredCount);

    while (this.humans.length < desiredCount) {
      this.humans.push(this.createHuman(this.humans.length));
    }
    while (this.humans.length > desiredCount) {
      var h = this.humans.pop();
      this.scene.remove(h.mesh);
    }
  };

  Renderer.prototype.updateHumans = function (dt, world) {
    for (var i = 0; i < this.humans.length; i++) {
      var h = this.humans[i];
      if (h.state === 'walk') {
        var dx = h.targetX - h.x;
        var dz = h.targetZ - h.z;
        var dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.15) {
          h.state = 'idle';
          h.idleTimer = 1.5 + Math.random() * 3;
          h.leftLeg.rotation.x = 0;
          h.rightLeg.rotation.x = 0;
          h.leftArm.rotation.x = 0;
          h.rightArm.rotation.x = 0;
        } else {
          var step = h.speed * dt;
          h.x += (dx / dist) * Math.min(step, dist);
          h.z += (dz / dist) * Math.min(step, dist);

          var targetAngle = Math.atan2(dx, dz);
          h.mesh.rotation.y = targetAngle;

          h.walkPhase += dt * 8.5;
          var swing = Math.sin(h.walkPhase) * 0.6;
          h.leftLeg.rotation.x = swing;
          h.rightLeg.rotation.x = -swing;
          h.leftArm.rotation.x = -swing * 0.75;
          h.rightArm.rotation.x = swing * 0.75;
          h.pelvis.position.y = 0.55 + Math.abs(Math.sin(h.walkPhase * 2)) * 0.04;
        }
      } else if (h.state === 'idle') {
        h.idleTimer -= dt;
        h.torso.rotation.x = Math.sin(performance.now() * 0.003) * 0.05;
        if (h.idleTimer <= 0) {
          // Pick new valid walk destination
          var validTiles = world.grid.filter(function (t) { return t.type !== 'river'; });
          if (validTiles.length > 0) {
            var dest = validTiles[Math.floor(Math.random() * validTiles.length)];
            h.targetX = dest.x + 0.3 + Math.random() * 0.4;
            h.targetZ = dest.y + 0.3 + Math.random() * 0.4;
          }
          h.state = 'walk';
        }
      }
      h.mesh.position.set(h.x, 0, h.z);
    }
  };

  // =========================================================================
  // REAL 3D OBJECTS & BUILDINGS
  // =========================================================================

  Renderer.prototype.buildTile3D = function (tile, stage) {
    var THREE = root.THREE;
    var m = this.materials;
    var group = new THREE.Group();
    group.position.set(tile.x, 0, tile.y);

    // 1) Terrain Slab
    var slabH = 0.35;
    var slabMat = m.dirt;
    if (tile.type === 'river') slabH = 0.15;
    else if (tile.type === 'floor') slabMat = m.floor;
    else if (tile.type === 'lot') slabMat = m.lot;
    else if (tile.type === 'farm' || tile.type === 'forest' || tile.type === 'park') slabMat = m.grass;
    else if (tile.type === 'barren') slabMat = m.barren;

    if (tile.type === 'river') {
      var waterGeo = new THREE.BoxGeometry(0.96, 0.15, 0.96);
      var waterMesh = new THREE.Mesh(waterGeo, m.water);
      waterMesh.position.y = -0.05;
      waterMesh.receiveShadow = true;
      group.add(waterMesh);
      group.waterMesh = waterMesh;
    } else {
      var slabGeo = new THREE.BoxGeometry(0.96, slabH, 0.96);
      var slab = new THREE.Mesh(slabGeo, slabMat);
      slab.position.y = slabH / 2 - 0.2;
      slab.receiveShadow = true;
      group.add(slab);
    }

    // 2) 3D Structures
    switch (tile.type) {
      case 'shelter':
        this.addCottage3D(group);
        break;
      case 'farm':
        this.addFarm3D(group, tile.crop);
        break;
      case 'panel':
        this.addSolarArray3D(group);
        break;
      case 'factory':
        this.addFactory3D(group);
        break;
      case 'recycler':
        this.addRecycler3D(group);
        break;
      case 'forest':
        this.addForest3D(group);
        break;
      case 'mine':
        this.addMine3D(group);
        break;
      case 'gym':
        this.addGym3D(group);
        break;
      case 'park':
        this.addPark3D(group);
        break;
      case 'kitchen':
        this.addKitchen3D(group);
        break;
      case 'river':
        this.addRiverDetails3D(group);
        break;
    }

    return group;
  };

  Renderer.prototype.addCottage3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    // Stone foundation
    var fGeo = new THREE.BoxGeometry(0.72, 0.1, 0.72);
    var found = new THREE.Mesh(fGeo, m.stone);
    found.position.y = 0.2;
    found.receiveShadow = true;
    found.castShadow = true;
    g.add(found);

    // House walls
    var wGeo = new THREE.BoxGeometry(0.66, 0.52, 0.66);
    var walls = new THREE.Mesh(wGeo, m.lightWood);
    walls.position.y = 0.48;
    walls.castShadow = true;
    walls.receiveShadow = true;
    g.add(walls);

    // Gabled Roof
    var rGeo = new THREE.ConeGeometry(0.55, 0.42, 4);
    var roof = new THREE.Mesh(rGeo, m.roofTile);
    roof.position.y = 0.92;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);

    // Glowing window
    var winGeo = new THREE.PlaneGeometry(0.18, 0.18);
    var win = new THREE.Mesh(winGeo, m.glass);
    win.position.set(0, 0.52, 0.34);
    g.add(win);

    // Wooden door
    var dGeo = new THREE.PlaneGeometry(0.16, 0.28);
    var door = new THREE.Mesh(dGeo, m.darkWood);
    door.position.set(0, 0.35, -0.34);
    door.rotation.y = Math.PI;
    g.add(door);

    // Brick Chimney
    var chimGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
    var chim = new THREE.Mesh(chimGeo, m.brick);
    chim.position.set(0.2, 0.95, 0.15);
    chim.castShadow = true;
    g.add(chim);
  };

  Renderer.prototype.addFarm3D = function (g, crop) {
    var THREE = root.THREE;
    var m = this.materials;

    // Tilled soil ridges
    for (var r = -0.3; r <= 0.3; r += 0.2) {
      var ridgeGeo = new THREE.BoxGeometry(0.75, 0.08, 0.12);
      var ridge = new THREE.Mesh(ridgeGeo, m.dirt);
      ridge.position.set(0, 0.19, r);
      ridge.receiveShadow = true;
      g.add(ridge);
    }

    // Fence posts
    var postGeo = new THREE.BoxGeometry(0.06, 0.28, 0.06);
    [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]].forEach(function (pos) {
      var post = new THREE.Mesh(postGeo, m.darkWood);
      post.position.set(pos[0], 0.28, pos[1]);
      post.castShadow = true;
      g.add(post);
    });

    // Crops
    var cropCount = crop === 'vegetable' ? 6 : 4;
    var cropMat = crop === 'fruit' ? m.tomato : m.carrot;

    for (var i = 0; i < cropCount; i++) {
      var cx = -0.25 + (i % 3) * 0.25;
      var cz = -0.2 + Math.floor(i / 3) * 0.4;

      var leafGeo = new THREE.ConeGeometry(0.09, 0.18, 5);
      var leaf = new THREE.Mesh(leafGeo, m.leafGreen);
      leaf.position.set(cx, 0.28, cz);
      leaf.castShadow = true;
      g.add(leaf);

      var fruitGeo = new THREE.SphereGeometry(0.045, 6, 6);
      var fruit = new THREE.Mesh(fruitGeo, cropMat);
      fruit.position.set(cx, 0.24, cz + 0.05);
      g.add(fruit);
    }
  };

  Renderer.prototype.addSolarArray3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    // Steel post mount
    var postGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.45, 8);
    var post = new THREE.Mesh(postGeo, m.metal);
    post.position.y = 0.35;
    post.castShadow = true;
    g.add(post);

    // Angled PV Panel Array
    var panelGeo = new THREE.BoxGeometry(0.78, 0.03, 0.62);
    var panel = new THREE.Mesh(panelGeo, m.solarCell);
    panel.position.set(0, 0.58, 0);
    panel.rotation.x = -Math.PI / 5;
    panel.castShadow = true;
    panel.receiveShadow = true;
    g.add(panel);

    // Aluminum frame border
    var frameGeo = new THREE.BoxGeometry(0.82, 0.02, 0.03);
    var topFrame = new THREE.Mesh(frameGeo, m.metal);
    topFrame.position.set(0, 0.68, -0.24);
    topFrame.rotation.x = -Math.PI / 5;
    g.add(topFrame);
  };

  Renderer.prototype.addFactory3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    // Industrial warehouse
    var whGeo = new THREE.BoxGeometry(0.72, 0.45, 0.58);
    var wh = new THREE.Mesh(whGeo, m.floor);
    wh.position.set(0, 0.38, -0.06);
    wh.castShadow = true;
    wh.receiveShadow = true;
    g.add(wh);

    // Roll-up industrial bay door
    var doorGeo = new THREE.PlaneGeometry(0.3, 0.28);
    var door = new THREE.Mesh(doorGeo, m.metal);
    door.position.set(0, 0.3, 0.24);
    g.add(door);

    // Twin Brick Smokestacks
    var s1Geo = new THREE.CylinderGeometry(0.08, 0.1, 0.72, 12);
    var s1 = new THREE.Mesh(s1Geo, m.brick);
    s1.position.set(-0.22, 0.75, -0.15);
    s1.castShadow = true;
    g.add(s1);

    var s2Geo = new THREE.CylinderGeometry(0.08, 0.1, 0.85, 12);
    var s2 = new THREE.Mesh(s2Geo, m.brick);
    s2.position.set(0.22, 0.82, -0.15);
    s2.castShadow = true;
    g.add(s2);
  };

  Renderer.prototype.addRecycler3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    var baseGeo = new THREE.BoxGeometry(0.68, 0.35, 0.55);
    var base = new THREE.Mesh(baseGeo, m.leafDark);
    base.position.set(0, 0.32, 0);
    base.castShadow = true;
    g.add(base);

    // Sorting bins
    var colors = [0x2563eb, 0x16a34a, 0xfacc15];
    for (var i = 0; i < 3; i++) {
      var binGeo = new THREE.BoxGeometry(0.18, 0.22, 0.18);
      var binMat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.7 });
      var bin = new THREE.Mesh(binGeo, binMat);
      bin.position.set(-0.22 + i * 0.22, 0.24, 0.32);
      bin.castShadow = true;
      g.add(bin);
    }
  };

  Renderer.prototype.addForest3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    var treePositions = [[-0.2, -0.18], [0.22, -0.12], [-0.05, 0.22]];
    treePositions.forEach(function (tp, idx) {
      var trunkGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.25, 6);
      var trunk = new THREE.Mesh(trunkGeo, m.darkWood);
      trunk.position.set(tp[0], 0.25, tp[1]);
      trunk.castShadow = true;
      g.add(trunk);

      // Layered pine cones
      var scales = [0.28, 0.22, 0.15];
      var heights = [0.42, 0.58, 0.72];
      var mat = idx % 2 === 0 ? m.leafDark : m.leafGreen;

      for (var l = 0; l < 3; l++) {
        var coneGeo = new THREE.ConeGeometry(scales[l], 0.24, 7);
        var cone = new THREE.Mesh(coneGeo, mat);
        cone.position.set(tp[0], heights[l], tp[1]);
        cone.castShadow = true;
        g.add(cone);
      }
    });
  };

  Renderer.prototype.addMine3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    // Rock mound
    var rockGeo = new THREE.DodecahedronGeometry(0.42, 1);
    var rock = new THREE.Mesh(rockGeo, m.stone);
    rock.position.set(0, 0.38, -0.08);
    rock.scale.set(1, 0.8, 1);
    rock.castShadow = true;
    g.add(rock);

    // Mine shaft entrance
    var portalGeo = new THREE.BoxGeometry(0.28, 0.32, 0.18);
    var portal = new THREE.Mesh(portalGeo, m.pants);
    portal.position.set(0, 0.26, 0.2);
    g.add(portal);

    // Ore cart
    var cartGeo = new THREE.BoxGeometry(0.22, 0.16, 0.16);
    var cart = new THREE.Mesh(cartGeo, m.metal);
    cart.position.set(0, 0.22, 0.38);
    cart.castShadow = true;
    g.add(cart);
  };

  Renderer.prototype.addGym3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    var pavilionGeo = new THREE.BoxGeometry(0.72, 0.45, 0.72);
    var pavilion = new THREE.Mesh(pavilionGeo, m.glass);
    pavilion.position.set(0, 0.38, 0);
    g.add(pavilion);

    // Barbell & weight bench
    var benchGeo = new THREE.BoxGeometry(0.18, 0.12, 0.4);
    var bench = new THREE.Mesh(benchGeo, m.darkWood);
    bench.position.set(0, 0.22, 0);
    g.add(bench);
  };

  Renderer.prototype.addPark3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    // Cobblestone path
    var pathGeo = new THREE.BoxGeometry(0.3, 0.04, 0.9);
    var path = new THREE.Mesh(pathGeo, m.stone);
    path.position.set(0, 0.16, 0);
    g.add(path);

    // Wooden park bench
    var benchGeo = new THREE.BoxGeometry(0.28, 0.14, 0.14);
    var bench = new THREE.Mesh(benchGeo, m.lightWood);
    bench.position.set(0.26, 0.24, 0);
    bench.castShadow = true;
    g.add(bench);

    // Streetlamp
    var poleGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.65, 8);
    var pole = new THREE.Mesh(poleGeo, m.metal);
    pole.position.set(-0.28, 0.45, -0.2);
    pole.castShadow = true;
    g.add(pole);

    var lampGeo = new THREE.SphereGeometry(0.06, 8, 8);
    var lampMat = new THREE.MeshBasicMaterial({ color: 0xffe599 });
    var lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(-0.28, 0.78, -0.2);
    g.add(lamp);
  };

  Renderer.prototype.addKitchen3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    // Pergola dining roof
    var roofGeo = new THREE.BoxGeometry(0.75, 0.05, 0.65);
    var roof = new THREE.Mesh(roofGeo, m.lightWood);
    roof.position.set(0, 0.72, 0);
    roof.castShadow = true;
    g.add(roof);

    // Pergola posts
    [[-0.32, -0.28], [0.32, -0.28], [-0.32, 0.28], [0.32, 0.28]].forEach(function (pos) {
      var postGeo = new THREE.BoxGeometry(0.05, 0.6, 0.05);
      var post = new THREE.Mesh(postGeo, m.darkWood);
      post.position.set(pos[0], 0.42, pos[1]);
      post.castShadow = true;
      g.add(post);
    });

    // Brick bread/pizza oven
    var ovenGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.35, 10);
    var oven = new THREE.Mesh(ovenGeo, m.brick);
    oven.position.set(0, 0.32, -0.1);
    oven.castShadow = true;
    g.add(oven);
  };

  Renderer.prototype.addRiverDetails3D = function (g) {
    var THREE = root.THREE;
    var m = this.materials;

    // Intake pipe
    var pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8);
    var pipe = new THREE.Mesh(pipeGeo, m.metal);
    pipe.position.set(0.38, 0.15, 0);
    pipe.rotation.z = Math.PI / 4;
    pipe.castShadow = true;
    g.add(pipe);
  };

  // =========================================================================
  // SCENE SYNCHRONIZATION & RENDER LOOP
  // =========================================================================

  Renderer.prototype.syncWorld3D = function (world, stage) {
    var gridHash = world.grid.map(function (t) { return t.type + (t.crop || ''); }).join(',');
    if (gridHash === this.curGridHash) return;
    this.curGridHash = gridHash;

    // Remove old meshes
    for (var i = 0; i < this.tileMeshes.length; i++) {
      this.scene.remove(this.tileMeshes[i]);
    }
    this.tileMeshes = [];

    // Build new 3D meshes for each tile
    for (var j = 0; j < world.grid.length; j++) {
      var mesh = this.buildTile3D(world.grid[j], stage);
      this.scene.add(mesh);
      this.tileMeshes.push(mesh);
    }
  };

  Renderer.prototype.draw = function (world, stage, dt) {
    if (this.viewMode === '3d' && this.useThree) {
      this.draw3D(world, stage, dt);
    } else {
      this.draw2D(world, stage, dt);
    }
  };

  Renderer.prototype.draw3D = function (world, stage, dt) {
    dt = dt || 0.016;
    this.collectEvents(world);
    this.syncWorld3D(world, stage);
    this.syncHumans(world, stage);
    this.updateHumans(dt, world);
    this.updateBot3D(dt);
    this.animateAtmosphere(dt);

    this.glRenderer.render(this.scene, this.camera);
  };

  Renderer.prototype.updateBot3D = function (dt) {
    if (!this.botMesh) return;

    // Spin outer gimbal ring
    if (this.botRing) {
      this.botRing.rotation.x += dt * 3.5;
      this.botRing.rotation.y += dt * 2.2;
    }

    // Hover bobbing
    var hoverOffset = Math.sin(performance.now() * 0.005) * 0.08;

    if (this.botTarget) {
      var dx = this.botTarget.x - this.botMesh.position.x;
      var dz = this.botTarget.y - this.botMesh.position.z;
      var dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.1) {
        this.botTarget = null;
      } else {
        var spd = Math.min(dist * 6.0, 10.0);
        this.botMesh.position.x += (dx / dist) * spd * dt;
        this.botMesh.position.z += (dz / dist) * spd * dt;
        this.botMesh.rotation.y = Math.atan2(dx, dz);
      }
    }

    this.botMesh.position.y = 1.35 + hoverOffset;
  };

  Renderer.prototype.animateAtmosphere = function (dt) {
    // Water wave pulsation
    var time = performance.now() * 0.003;
    for (var i = 0; i < this.tileMeshes.length; i++) {
      var tm = this.tileMeshes[i];
      if (tm.waterMesh) {
        tm.waterMesh.position.y = -0.05 + Math.sin(time + tm.position.z * 1.5) * 0.02;
      }
    }
  };

  // =========================================================================
  // 2D CANVAS FALLBACK / TACTICAL MODE
  // =========================================================================

  Renderer.prototype.draw2D = function (world, stage, dt) {
    if (!this.ctx && this.canvas2d) this.ctx = this.canvas2d.getContext('2d');
    var ctx = this.ctx;
    if (!ctx) return;
    var w = this.cssW || 400;
    var h = this.cssH || 300;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0f1319';
    ctx.fillRect(0, 0, w, h);

    var cols = stage.COLS || 8;
    var rows = stage.ROWS || 6;
    var cellW = Math.min((w - 24) / cols, (h - 24) / rows);
    var ox = (w - cols * cellW) / 2;
    var oy = (h - rows * cellW) / 2;

    for (var i = 0; i < world.grid.length; i++) {
      var t = world.grid[i];
      var rx = ox + t.x * cellW;
      var ry = oy + t.y * cellW;

      var info = TILES_2D[t.type] || { fill: '#3d4452' };
      ctx.fillStyle = info.fill;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(rx + 2, ry + 2, cellW - 4, cellW - 4, 4);
        ctx.fill();
      } else {
        ctx.fillRect(rx + 2, ry + 2, cellW - 4, cellW - 4);
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeRect(rx + 2, ry + 2, cellW - 4, cellW - 4);

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.textAlign = 'center';
      var label = t.crop ? t.type + ':' + t.crop : t.type;
      ctx.fillText(label, rx + cellW / 2, ry + cellW / 2 + 4);
    }

    if (this.botTarget) {
      var bx = ox + this.botTarget.x * cellW + cellW / 2;
      var by = oy + this.botTarget.y * cellW + cellW / 2;
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(5, cellW * 0.18), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };

  Renderer.prototype.collectEvents = function (world) {
    var now = performance.now();
    for (var i = this.lastEventCount; i < world.events.length; i++) {
      var ev = world.events[i];
      if (ev.tile != null && world.grid[ev.tile]) {
        this.botTarget = { x: world.grid[ev.tile].x, y: world.grid[ev.tile].y };
      }
    }
    this.lastEventCount = world.events.length;
  };

  Renderer.prototype.toggleViewMode = function () {
    this.viewMode = this.viewMode === '3d' ? '2d' : '3d';
    try { localStorage.setItem('sdg-view-mode', this.viewMode); } catch (e) { /* ignore */ }
    this.updateCanvasVisibility();
    this.resize();
    return this.viewMode;
  };

  Renderer.prototype.reset = function (stage) {
    this.lastEventCount = 0;
    this.curGridHash = '';
    this.botTarget = null;
    if (this.botMesh) {
      this.botMesh.position.set(1.5, 1.4, 1.5);
    }
  };

  Renderer.prototype.resize = function () {
    var container = (this.canvas2d && this.canvas2d.parentElement) || (this.canvas3d && this.canvas3d.parentElement);
    if (!container) return;
    var rect = container.getBoundingClientRect();
    var w = Math.max(320, rect.width);
    var resBar = document.getElementById('resourceBar');
    var h = Math.max(240, rect.height - (resBar ? resBar.getBoundingClientRect().height : 0));
    var dpr = window.devicePixelRatio || 1;

    this.cssW = w;
    this.cssH = h;

    if (this.canvas2d) {
      this.canvas2d.width = Math.round(w * dpr);
      this.canvas2d.height = Math.round(h * dpr);
      this.canvas2d.style.width = w + 'px';
      this.canvas2d.style.height = h + 'px';
      if (!this.ctx) this.ctx = this.canvas2d.getContext('2d');
      if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (this.canvas3d && this.glRenderer && this.camera) {
      this.canvas3d.width = Math.round(w * dpr);
      this.canvas3d.height = Math.round(h * dpr);
      this.canvas3d.style.width = w + 'px';
      this.canvas3d.style.height = h + 'px';
      this.glRenderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  };

  SDG.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
