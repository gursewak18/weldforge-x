/* WELDFORGE-X: Three.js 3D Simulation & 6-Axis Kinematics Engine */

let scene, camera, renderer, orbitControls;
let robotArm = {}; // Holds joint groups
let workpieceNode = null;
let jigClamps = { left: null, right: null };
let weldSeamBeads = [];
let sparks = null; // Particle system reference

let isWeldingActive = false;
let currentWeldProgress = 0.0;
let activeWorkpieceMaterial = 'steel';
let activeWeldingMode = 'mig';
let activeFault = 'none';
let activeCustomConfig = null;

// Joint angles (in degrees) and safe constraints
let jointAngles = [0, 15, -45, 0, 30, 0];
const jointLimits = [
  [-170, 170], // J1
  [-45, 85],   // J2
  [-120, 60],  // J3
  [-185, 185], // J4
  [-120, 120], // J5
  [-360, 360]  // J6
];

// Predefined Targets in 3D Space
const homeTarget = new THREE.Vector3(0, 1.8, 1.3);
let currentTCPPosition = new THREE.Vector3();
let ikTarget = new THREE.Vector3().copy(homeTarget);
let isMovingToTarget = false;
let moveDuration = 1.5; // seconds
let moveTimer = 0;
let moveStartAngles = [...jointAngles];
let moveTargetAngles = [...jointAngles];

// Spool and Cable elements
let spoolMesh, umbilicalCable;

function init3DScene() {
  const container = document.getElementById('viewport-container');
  if (!container) return;

  // 1. Create Scene & Bright Premium Foggy Studio
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.fog = new THREE.FogExp2(0xffffff, 0.05);

  // 2. Camera Rig
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(3, 4, 6);

  // 3. Renderer with Premium Settings (Antialias, Shadows)
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 4. Orbit Controls
  orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevents camera going below floor
  orbitControls.minDistance = 2;
  orbitControls.maxDistance = 15;

  // 5. Lighting Setup (Neon Accents & Dynamic Arc Glow)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const spotLight = new THREE.SpotLight(0xffffff, 1.5);
  spotLight.position.set(4, 8, 4);
  spotLight.angle = Math.PI / 4;
  spotLight.penumbra = 0.5;
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 1024;
  spotLight.shadow.mapSize.height = 1024;
  scene.add(spotLight);

  // Cool cobalt neon accent light
  const blueLight = new THREE.DirectionalLight(0x0066ff, 0.8);
  blueLight.position.set(-4, 3, -4);
  scene.add(blueLight);

  // Glowing arc light (flickers during active welds)
  const arcLight = new THREE.PointLight(0x00f0ff, 0, 8);
  arcLight.position.set(0, 0.5, 0); // Positioned at active jig table
  scene.add(arcLight);
  scene.arcLightRef = arcLight;

  // 6. Floor & Grid (Clean studio floor grid)
  const gridHelper = new THREE.GridHelper(20, 40, 0x0088cc, 0xd0d5dd);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  const floorGeo = new THREE.PlaneGeometry(30, 30);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.6,
    metalness: 0.1
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 7. Procedural Robot Construction
  buildKukaRobot();

  // 8. Build Jig & Environment
  buildEnvironment();

  // 9. Particles Sparks System Initializer
  sparks = new SparkParticles(scene);

  // Window Resize
  window.addEventListener('resize', onWindowResize, false);

  // Boot simulation loop
  animate();
  
  logSystemEvent("WebGL Three.js physics & kinematics engine loaded successfully.");
}

/* Procedural CAD-Style KUKA Robotic Arm Builder */
function buildKukaRobot() {
  // Common premium industrial materials
  const orangeMat = new THREE.MeshStandardMaterial({
    color: 0xff5000,
    roughness: 0.15,
    metalness: 0.85,
    name: 'kuka-orange'
  });
  const darkGrayMat = new THREE.MeshStandardMaterial({
    color: 0x1a1f26,
    roughness: 0.3,
    metalness: 0.9,
    name: 'link-dark'
  });
  const slateMat = new THREE.MeshStandardMaterial({
    color: 0x3a4250,
    roughness: 0.25,
    metalness: 0.7,
    name: 'link-slate'
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.1,
    metalness: 0.9,
    name: 'nozzle-brass'
  });

  // Base Plate (Static)
  const basePedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.25, 32), darkGrayMat);
  basePedestal.position.set(0, 0.125, 1.0); // Shifted slightly back
  basePedestal.castShadow = true;
  basePedestal.receiveShadow = true;
  scene.add(basePedestal);

  // Joint 1: Pivot Group
  robotArm.j1 = new THREE.Group();
  robotArm.j1.position.set(0, 0.125, 0); // local to base
  basePedestal.add(robotArm.j1);

  // J1 column geometry
  const j1Column = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 32), orangeMat);
  j1Column.position.y = 0.25;
  j1Column.castShadow = true;
  robotArm.j1.add(j1Column);

  // Joint 2: Pivot Group
  robotArm.j2 = new THREE.Group();
  robotArm.j2.position.set(0, 0.4, 0);
  robotArm.j1.add(robotArm.j2);

  // J2 shoulder sphere
  const j2Sphere = new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 32), slateMat);
  robotArm.j2.add(j2Sphere);

  // J2 long upper arm link
  const j2Link = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 1.4, 32), orangeMat);
  j2Link.position.y = 0.7; // extend up
  j2Link.castShadow = true;
  robotArm.j2.add(j2Link);

  // Joint 3: Pivot Group
  robotArm.j3 = new THREE.Group();
  robotArm.j3.position.set(0, 1.4, 0);
  robotArm.j2.add(robotArm.j3);

  // J3 elbow casing
  const j3Sphere = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 32), slateMat);
  robotArm.j3.add(j3Sphere);

  // J3 forearm link
  const j3Link = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 1.1, 32), orangeMat);
  j3Link.position.y = 0.55;
  j3Link.castShadow = true;
  robotArm.j3.add(j3Link);

  // Foreground spooled wire-feeder electronics (Exclusive details)
  const wireFeeder = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), darkGrayMat);
  wireFeeder.position.set(-0.16, 0.4, 0);
  robotArm.j3.add(wireFeeder);

  spoolMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 24), brassMat);
  spoolMesh.position.set(0.13, 0, 0);
  spoolMesh.rotation.z = Math.PI / 2;
  wireFeeder.add(spoolMesh);

  // Joint 4: Forearm Roll Group
  robotArm.j4 = new THREE.Group();
  robotArm.j4.position.set(0, 1.1, 0);
  robotArm.j3.add(robotArm.j4);

  // J4 casing
  const j4Casing = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 24), slateMat);
  robotArm.j4.add(j4Casing);

  // Joint 5: Wrist Pitch Group
  robotArm.j5 = new THREE.Group();
  robotArm.j5.position.set(0, 0.12, 0);
  robotArm.j4.add(robotArm.j5);

  const j5Casing = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 24), darkGrayMat);
  robotArm.j5.add(j5Casing);

  // Joint 6: Flange / Torch Roll Group
  robotArm.j6 = new THREE.Group();
  robotArm.j6.position.set(0, 0.1, 0);
  robotArm.j5.add(robotArm.j6);

  // 6-Axis Tool End-effector (Specialized Welding Torch)
  const torchMount = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 24), slateMat);
  robotArm.j6.add(torchMount);

  // Slanted Torch body (45-degree angle neck)
  const torchBody = new THREE.Group();
  torchBody.position.set(0, 0.02, 0);
  torchBody.rotation.x = -Math.PI / 4; // Angle torch
  robotArm.j6.add(torchBody);

  const neckGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.22, 16);
  const neck = new THREE.Mesh(neckGeo, darkGrayMat);
  neck.position.y = 0.11;
  neck.castShadow = true;
  torchBody.add(neck);

  // Cool cooling fins
  for (let offset = 0.06; offset <= 0.16; offset += 0.05) {
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 16), darkGrayMat);
    fin.position.y = offset;
    torchBody.add(fin);
  }

  // Brass nozzle
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.08, 16), brassMat);
  nozzle.position.y = 0.26;
  torchBody.add(nozzle);

  // Dynamic TCP tip node representing active weld spot
  robotArm.tcpNode = new THREE.Object3D();
  robotArm.tcpNode.position.set(0, 0.31, 0); // Tip of nozzle
  torchBody.add(robotArm.tcpNode);

  // Assemble organic sagging umbilical cable (Base of column to elbow joint)
  buildUmbilicalCable(basePedestal, robotArm.j3);
}

function buildUmbilicalCable(base, elbow) {
  const curvePoints = [
    new THREE.Vector3(0, 0.5, 0.9),  // Base column offset
    new THREE.Vector3(0, 0.4, 0.4),  // Gravity sag center
    new THREE.Vector3(0, 1.4, 0.95)   // Elbow bracket offset
  ];
  
  const cableCurve = new THREE.QuadraticBezierCurve3(
    curvePoints[0],
    curvePoints[1],
    curvePoints[2]
  );

  const cableGeo = new THREE.TubeGeometry(cableCurve, 20, 0.03, 8, false);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0x111317,
    roughness: 0.8,
    metalness: 0.2
  });

  umbilicalCable = new THREE.Mesh(cableGeo, cableMat);
  scene.add(umbilicalCable);
}

function updateUmbilicalCable() {
  if (!umbilicalCable || !robotArm.j1 || !robotArm.j3) return;

  // Retrieve current world positions of endpoints to update sagging curve
  const startWorld = new THREE.Vector3();
  robotArm.j1.getWorldPosition(startWorld);
  startWorld.y += 0.2; // Offset slightly higher
  
  const endWorld = new THREE.Vector3();
  robotArm.j3.getWorldPosition(endWorld);
  
  // Calculate mid-sag point under gravity
  const midPoint = new THREE.Vector3()
    .addVectors(startWorld, endWorld)
    .multiplyScalar(0.5);
  midPoint.y -= 0.6; // Gravity sag

  const updatedCurve = new THREE.QuadraticBezierCurve3(
    startWorld,
    midPoint,
    endWorld
  );

  umbilicalCable.geometry.dispose();
  umbilicalCable.geometry = new THREE.TubeGeometry(updatedCurve, 20, 0.03, 8, false);
}

/* Build Central Jig & Background Factory Enclosure */
function buildEnvironment() {
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.4, metalness: 0.8 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x1a202c, roughness: 0.5, metalness: 0.9 });
  const goldClamp = new THREE.MeshStandardMaterial({ color: 0xecc94b, roughness: 0.3, metalness: 0.7 });

  // 1. Central Weld Table stand
  const jigTable = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.45, 32), steelMat);
  jigTable.position.set(0, 0.225, 0);
  jigTable.receiveShadow = true;
  jigTable.castShadow = true;
  scene.add(jigTable);

  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.05, 32), darkSteel);
  tableTop.position.set(0, 0.475, 0);
  tableTop.receiveShadow = true;
  scene.add(tableTop);

  // 2. Clamping Brackets (Dynamic swinging pneumatic holddowns)
  jigClamps.left = new THREE.Group();
  jigClamps.left.position.set(-0.35, 0.5, 0);
  scene.add(jigClamps.left);

  const armLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), steelMat);
  armLeft.position.x = 0.06;
  jigClamps.left.add(armLeft);

  const padLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 16), goldClamp);
  padLeft.position.set(0.12, -0.02, 0);
  armLeft.add(padLeft);

  jigClamps.right = new THREE.Group();
  jigClamps.right.position.set(0.35, 0.5, 0);
  scene.add(jigClamps.right);

  const armRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), steelMat);
  armRight.position.x = -0.06;
  jigClamps.right.add(armRight);

  const padRight = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 16), goldClamp);
  padRight.position.set(-0.12, -0.02, 0);
  armRight.add(padRight);

  // Set clamps initially open
  setJigClamping(0.0);

  // 3. Spawn Initial Workpiece
  spawnWorkpiece(activeWorkpieceMaterial);
}

function setJigClamping(pct) {
  // Clamp angle swings up to 45 degrees
  const angle = (Math.PI / 4) * (1.0 - pct);
  jigClamps.left.rotation.z = angle;
  jigClamps.right.rotation.z = -angle;
}

function spawnWorkpiece(material, customConfig) {
  // Clear any existing workpiece
  if (workpieceNode) {
    scene.remove(workpieceNode);
    workpieceNode = null;
  }
  weldSeamBeads.forEach(bead => scene.remove(bead));
  weldSeamBeads = [];

  const materialDB = {
    steel: { color: 0x5a6578, metalness: 0.8, roughness: 0.3 },
    iron: { color: 0x272c35, metalness: 0.85, roughness: 0.45 },
    aluminum: { color: 0xccd9e8, metalness: 0.95, roughness: 0.1 },
    copper: { color: 0xcd7f32, metalness: 0.9, roughness: 0.2 },
    titanium: { color: 0x8a95a5, metalness: 0.9, roughness: 0.4 },
    gold: { color: 0xffd700, metalness: 0.95, roughness: 0.15 },
    silver: { color: 0xcccccc, metalness: 0.95, roughness: 0.1 },
    bronze: { color: 0xa87900, metalness: 0.85, roughness: 0.25 },
    brass: { color: 0xb5a642, metalness: 0.85, roughness: 0.2 },
    platinum: { color: 0xe5e4e2, metalness: 0.95, roughness: 0.1 },
    nickel: { color: 0x9e9e9e, metalness: 0.85, roughness: 0.25 },
    cobalt: { color: 0x3b5998, metalness: 0.85, roughness: 0.25 },
    lead: { color: 0x4f545a, metalness: 0.5, roughness: 0.5 },
    zinc: { color: 0xa9b2c0, metalness: 0.8, roughness: 0.3 }
  };

  let color = 0x5a6578;
  let metalness = 0.8;
  let roughness = 0.3;

  const matLower = material ? material.toLowerCase().trim() : 'steel';
  if (materialDB[matLower]) {
    color = materialDB[matLower].color;
    metalness = materialDB[matLower].metalness;
    roughness = materialDB[matLower].roughness;
  } else {
    // Procedural color hashing for any random/exotic metal
    let hash = 0;
    for (let i = 0; i < matLower.length; i++) {
      hash = matLower.charCodeAt(i) + ((hash << 5) - hash);
    }
    const r = (hash & 0xFF0000) >> 16;
    const g = (hash & 0x00FF00) >> 8;
    const b = hash & 0x0000FF;
    
    // Normalize and blend with silver sheen
    const rawColor = new THREE.Color(`rgb(${Math.abs(r % 200)}, ${Math.abs(g % 200)}, ${Math.abs(b % 200)})`);
    const silver = new THREE.Color(0xdcdcdc);
    const blendedColor = rawColor.clone().lerp(silver, 0.45);
    
    color = blendedColor.getHex();
    metalness = 0.9;
    roughness = 0.2;
    if (typeof logSystemEvent === 'function') {
      logSystemEvent(`WebGL: Procedurally generated color Hex #${blendedColor.getHexString()} for exotic material '${material}'.`);
    }
  }

  const mat = new THREE.MeshStandardMaterial({
    color: color,
    metalness: metalness,
    roughness: roughness
  });

  workpieceNode = new THREE.Group();
  workpieceNode.position.set(0, 0.51, 0);
  scene.add(workpieceNode);

  let finalLength = 0.48;
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x1e293b, linewidth: 2 });

  // Render custom parts if specified by AI supervisor
  if (customConfig) {
    const length = customConfig.length || 0.36; // unit scale
    const width = customConfig.width || 0.08;
    const thickness = customConfig.thickness || 0.015;
    const qty = customConfig.qty || 2;
    finalLength = length;

    if (qty === 2) {
      const jointType = customConfig.jointType || 'square';

      if (jointType === 'lap') {
        // Lap joint: Left piece flat on table, right piece overlapping on top
        const matLeft = mat.clone();
        matLeft.color.multiplyScalar(0.88);

        const pieceLeft = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), matLeft);
        pieceLeft.position.set(0, thickness / 2, -width / 4);
        pieceLeft.castShadow = true;
        pieceLeft.receiveShadow = true;
        workpieceNode.add(pieceLeft);

        // Add outline
        const edgesLeft = new THREE.EdgesGeometry(pieceLeft.geometry);
        const lineLeft = new THREE.LineSegments(edgesLeft, outlineMaterial);
        pieceLeft.add(lineLeft);

        const pieceRight = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), mat);
        pieceRight.position.set(0, thickness + thickness / 2, width / 4);
        pieceRight.castShadow = true;
        pieceRight.receiveShadow = true;
        workpieceNode.add(pieceRight);

        // Add outline
        const edgesRight = new THREE.EdgesGeometry(pieceRight.geometry);
        const lineRight = new THREE.LineSegments(edgesRight, outlineMaterial);
        pieceRight.add(lineRight);

        logSystemEvent(`Dynamic 3D Spawner: Generated LAP joint overlap configuration.`);
      } else if (jointType === 't-joint' || jointType === 'tee') {
        // T-Joint: Bottom plate flat, vertical plate standing perpendicular in the middle
        const matBottom = mat.clone();
        matBottom.color.multiplyScalar(0.88);

        const pieceLeft = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width * 2), matBottom);
        pieceLeft.position.set(0, thickness / 2, 0);
        pieceLeft.castShadow = true;
        pieceLeft.receiveShadow = true;
        workpieceNode.add(pieceLeft);

        // Add outline
        const edgesLeft = new THREE.EdgesGeometry(pieceLeft.geometry);
        const lineLeft = new THREE.LineSegments(edgesLeft, outlineMaterial);
        pieceLeft.add(lineLeft);

        const pieceRight = new THREE.Mesh(new THREE.BoxGeometry(length, width, thickness), mat);
        pieceRight.position.set(0, thickness + width / 2, 0);
        pieceRight.castShadow = true;
        pieceRight.receiveShadow = true;
        workpieceNode.add(pieceRight);

        // Add outline
        const edgesRight = new THREE.EdgesGeometry(pieceRight.geometry);
        const lineRight = new THREE.LineSegments(edgesRight, outlineMaterial);
        pieceRight.add(lineRight);

        logSystemEvent(`Dynamic 3D Spawner: Generated T-JOINT perpendicular standing configuration.`);
      } else {
        // Square Joint (default butt weld)
        const matLeft = mat.clone();
        matLeft.color.multiplyScalar(0.88);

        const pieceLeft = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), matLeft);
        pieceLeft.position.set(0, thickness / 2, -width / 2 - 0.008);
        pieceLeft.castShadow = true;
        pieceLeft.receiveShadow = true;
        workpieceNode.add(pieceLeft);

        // Add a CAD outline around Left Piece
        const edgesLeft = new THREE.EdgesGeometry(pieceLeft.geometry);
        const lineLeft = new THREE.LineSegments(edgesLeft, outlineMaterial);
        pieceLeft.add(lineLeft);

        const pieceRight = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), mat);
        pieceRight.position.set(0, thickness / 2, width / 2 + 0.008);
        pieceRight.castShadow = true;
        pieceRight.receiveShadow = true;
        workpieceNode.add(pieceRight);

        // Add a CAD outline around Right Piece
        const edgesRight = new THREE.EdgesGeometry(pieceRight.geometry);
        const lineRight = new THREE.LineSegments(edgesRight, outlineMaterial);
        pieceRight.add(lineRight);

        // Add a copper backing bar underneath the seam to make the welding look amazingly realistic!
        const copperBacking = new THREE.Mesh(
          new THREE.BoxGeometry(length + 0.02, 0.004, 0.02),
          new THREE.MeshStandardMaterial({ color: 0xcd7f32, metalness: 0.9, roughness: 0.2 })
        );
        copperBacking.position.set(0, 0.002, 0);
        workpieceNode.add(copperBacking);

        const edgesBacking = new THREE.EdgesGeometry(copperBacking.geometry);
        const lineBacking = new THREE.LineSegments(edgesBacking, outlineMaterial);
        copperBacking.add(lineBacking);

        logSystemEvent(`Dynamic 3D Spawner: Generated SQUARE butt joint configuration.`);
      }
    } else {
      // Single continuous piece
      const plate = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width * 2), mat);
      plate.position.set(0, thickness / 2, 0);
      plate.castShadow = true;
      plate.receiveShadow = true;
      workpieceNode.add(plate);

      const edges = new THREE.EdgesGeometry(plate.geometry);
      const line = new THREE.LineSegments(edges, outlineMaterial);
      plate.add(line);
    }

    logSystemEvent(`Dynamic 3D Spawner: Created ${qty} pieces of custom ${material.toUpperCase()} (${(length * 100).toFixed(0)}cm) side-by-side with CAD outlines.`);
  } else {
    // Steel carrier block (default) - Render as two distinct plates with a gap & backing plate for instant visual verification!
    const pieceLeft = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.02, 0.1), mat.clone());
    pieceLeft.material.color.multiplyScalar(0.88); // darken left piece slightly
    pieceLeft.position.set(0, 0.01, -0.05 - 0.008);
    pieceLeft.castShadow = true;
    pieceLeft.receiveShadow = true;
    workpieceNode.add(pieceLeft);

    const edgesLeft = new THREE.EdgesGeometry(pieceLeft.geometry);
    const lineLeft = new THREE.LineSegments(edgesLeft, outlineMaterial);
    pieceLeft.add(lineLeft);

    const pieceRight = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.02, 0.1), mat);
    pieceRight.position.set(0, 0.01, 0.05 + 0.008);
    pieceRight.castShadow = true;
    pieceRight.receiveShadow = true;
    workpieceNode.add(pieceRight);

    const edgesRight = new THREE.EdgesGeometry(pieceRight.geometry);
    const lineRight = new THREE.LineSegments(edgesRight, outlineMaterial);
    pieceRight.add(lineRight);

    // Copper backing bar
    const copperBacking = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.004, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xcd7f32, metalness: 0.9, roughness: 0.2 })
    );
    copperBacking.position.set(0, 0.002, 0);
    workpieceNode.add(copperBacking);

    const edgesBacking = new THREE.EdgesGeometry(copperBacking.geometry);
    const lineBacking = new THREE.LineSegments(edgesBacking, outlineMaterial);
    copperBacking.add(lineBacking);

    logSystemEvent(`Workpiece spawned: Two STEEL carrier plates positioned on locator table with CAD outlines.`);
  }

  // Adjust table pneumatic clamps positioning based on parts final length bounds
  const clampOffset = finalLength / 2 + 0.11;
  if (jigClamps.left) jigClamps.left.position.x = -clampOffset;
  if (jigClamps.right) jigClamps.right.position.x = clampOffset;
}

/* Forward Kinematics (FK) angles orientation solver */
function updateForwardKinematics() {
  // Draw copy of joints to allow visual jitter superposition without corrupting base coordinates
  let drawAngles = [...jointAngles];

  if (typeof activeFault !== 'undefined' && activeFault === 'gear_slip') {
    if (isWeldingActive || isMovingToTarget) {
      // 180Hz mechanical resonance tooth-slip chattering jitter simulation
      const chattering = Math.sin(Date.now() * 0.08) * 3.5; 
      drawAngles[2] += chattering;      // Elbow chattering
      drawAngles[3] += chattering * 0.4; // Forearm Roll chattering
    }
  }

  // Convert angles to radians and orient pivot groups
  robotArm.j1.rotation.y = THREE.MathUtils.degToRad(drawAngles[0]);
  robotArm.j2.rotation.z = THREE.MathUtils.degToRad(drawAngles[1]);
  robotArm.j3.rotation.z = THREE.MathUtils.degToRad(drawAngles[2]);
  robotArm.j4.rotation.y = THREE.MathUtils.degToRad(drawAngles[3]);
  robotArm.j5.rotation.z = THREE.MathUtils.degToRad(drawAngles[4]);
  robotArm.j6.rotation.y = THREE.MathUtils.degToRad(drawAngles[5]);

  // Rotates copper spool mesh dynamically during welding
  if (isWeldingActive && spoolMesh) {
    spoolMesh.rotation.y += 0.1;
  }

  // Update dynamic umbilical sag
  updateUmbilicalCable();

  // Update current TCP Tip World Coordinate
  if (robotArm.tcpNode) {
    robotArm.tcpNode.getWorldPosition(currentTCPPosition);
  }
}

/* Fast Numerical CCD (Cyclic Coordinate Descent) IK Path solver */
function solveCCDIK(targetPos, maxIterations = 8) {
  const tolerance = 0.01;
  const pivotList = [
    { group: robotArm.j5, axis: 'z', idx: 4 },
    { group: robotArm.j3, axis: 'z', idx: 2 },
    { group: robotArm.j2, axis: 'z', idx: 1 },
    { group: robotArm.j1, axis: 'y', idx: 0 }
  ];

  for (let iter = 0; iter < maxIterations; iter++) {
    // 1. Calculate TCP Tip World Coordinate
    robotArm.tcpNode.getWorldPosition(currentTCPPosition);
    let dist = currentTCPPosition.distanceTo(targetPos);
    if (dist < tolerance) break;

    // 2. Iterate backward from wrist to column base
    for (let pivot of pivotList) {
      const pivotWorldPos = new THREE.Vector3();
      pivot.group.getWorldPosition(pivotWorldPos);

      robotArm.tcpNode.getWorldPosition(currentTCPPosition);

      // Vectors from joint to TCP, and joint to Target
      const jointToTCP = new THREE.Vector3().subVectors(currentTCPPosition, pivotWorldPos);
      const jointToTarget = new THREE.Vector3().subVectors(targetPos, pivotWorldPos);

      // Project vectors onto the orthogonal rotation plane
      if (pivot.axis === 'y') {
        jointToTCP.y = 0;
        jointToTarget.y = 0;
      } else {
        // Z-axis pitch (in world space we pitch around X/Z axis depending on base rot)
        // For simplicity inside solver, calculate relative angle offset
        jointToTCP.z = 0;
        jointToTarget.z = 0;
      }

      jointToTCP.normalize();
      jointToTarget.normalize();

      let dot = jointToTCP.dot(jointToTarget);
      dot = Math.max(-1.0, Math.min(1.0, dot));
      
      let angleDiff = Math.acos(dot);
      if (angleDiff < 0.001) continue;

      // Determine rotation sign using cross product
      const cross = new THREE.Vector3().crossVectors(jointToTCP, jointToTarget);
      let sign = 1.0;
      if (pivot.axis === 'y') {
        if (cross.y < 0) sign = -1.0;
      } else {
        if (cross.z < 0) sign = -1.0;
      }

      let deltaAngle = THREE.MathUtils.radToDeg(angleDiff) * sign;
      
      // Safety limits clamping
      let nextAngle = jointAngles[pivot.idx] + deltaAngle;
      const limits = jointLimits[pivot.idx];
      nextAngle = Math.max(limits[0], Math.min(limits[1], nextAngle));

      jointAngles[pivot.idx] = nextAngle;
      updateForwardKinematics();
    }
  }
}

/* Smooth interpolation wrapper to target angles */
function setTargetJointAngles(angles, duration = 1.2) {
  moveStartAngles = [...jointAngles];
  moveTargetAngles = [...angles];
  moveDuration = duration;
  moveTimer = 0;
  isMovingToTarget = true;
}

/* Collaborative Automation Tasks & Routines */
function startAutomationSequence(material, mode) {
  if (isWeldingActive || isMovingToTarget) return;

  activeWorkpieceMaterial = material;
  activeWeldingMode = mode;

  // Adapt indicators
  updateHUDStatus("WELDING CYCLE ACTIVE", 'welding');

  // Trigger state machine sequence steps
  executeAutomatedStage(0);
}

function executeAutomatedStage(stage) {
  switch (stage) {
    case 0: // Spawn / Seat Workpiece
      if (typeof activeCustomConfig !== 'undefined' && activeCustomConfig) {
        spawnWorkpiece(activeWorkpieceMaterial, activeCustomConfig);
      } else {
        spawnWorkpiece(activeWorkpieceMaterial);
      }
      setTimeout(() => executeAutomatedStage(1), 800);
      break;

    case 1: // Engage pneumatic Clamps
      logSystemEvent("State Machine [STAGE 2/6]: Locking locator holddown brackets.");
      animateJigClamps(1.0, 500, () => executeAutomatedStage(2));
      break;

    case 2: // Torch Approach Seam Start
      logSystemEvent("State Machine [STAGE 3/6]: Robotic wrist aligning to track inlet seam.");
      // Seam start coordinates: ( -0.18, 0.52, 0.0 )
      setTargetJointAngles([0, 32, -65, 0, 38, 0], 1.2);
      setTimeout(() => executeAutomatedStage(3), 1300);
      break;

    case 3: // Weld Sweep Seam
      logSystemEvent(`State Machine [STAGE 4/6]: Electrical arc ignited. Laying cooling weld pool.`);
      isWeldingActive = true;
      currentWeldProgress = 0.0;
      break;

    case 4: // Welder Retracts to clearance
      logSystemEvent("State Machine [STAGE 5/6]: Weld finished. Returning arm to home standby.");
      isWeldingActive = false;
      if (scene.arcLightRef) scene.arcLightRef.intensity = 0;
      setTargetJointAngles([0, 15, -45, 0, 30, 0], 1.0);
      setTimeout(() => executeAutomatedStage(5), 1100);
      break;

    case 5: // Disengage Clamps & Eject
      logSystemEvent("State Machine [STAGE 6/6]: Releasing table fixtures. Workpiece weld inspection complete.");
      animateJigClamps(0.0, 500, () => {
        updateHUDStatus("CELL: READY (IDLE)", 'idle');
        logSystemEvent("Autonomous cycle successfully complete. Cell cleared.");
      });
      break;
  }
}

function animateJigClamps(targetPct, duration, callback) {
  const start = Date.now();
  const initPct = jigClamps.left.rotation.z / (Math.PI / 4); // open=1.0, closed=0.0
  const startPct = 1.0 - initPct;

  const timer = setInterval(() => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1.0);
    const currentPct = startPct + (targetPct - startPct) * progress;
    
    setJigClamping(currentPct);
    
    if (progress >= 1.0) {
      clearInterval(timer);
      if (callback) callback();
    }
  }, 16);
}

function generateWeldBead(progress) {
  let seamLength = 0.36;
  if (typeof activeCustomConfig !== 'undefined' && activeCustomConfig) {
    seamLength = activeCustomConfig.length || 0.36;
  }
  // Interpolates weld path along central groove: X from -seamLength/2 to seamLength/2
  const pathX = -seamLength / 2 + seamLength * progress;
  const pathY = 0.525;
  const pathZ = 0.0;

  // Spawn glowing sphere bead representing welding ripple pool
  const sphereGeo = new THREE.SphereGeometry(0.018, 12, 12);
  
  // Decide glowing color based on selected welding mode & material
  const modeColors = {
    mig: 0xff6600,
    tig: 0x00ffcc,
    laser: 0xff00ff,
    plasma: 0x00f0ff,
    stick: 0xffea00,
    mma: 0xffea00,
    friction: 0xff3300,
    electronbeam: 0x9900ff,
    saw: 0xff4500
  };
  const modeKey = activeWeldingMode ? activeWeldingMode.toLowerCase().replace(/[^a-z]/g, '') : 'mig';
  let colorHex = modeColors[modeKey] || 0xff3300;

  const beadMat = new THREE.MeshBasicMaterial({ color: colorHex });
  const bead = new THREE.Mesh(sphereGeo, beadMat);
  bead.position.set(pathX, pathY, pathZ);
  scene.add(bead);
  weldSeamBeads.push(bead);

  // Animate dynamic cooling aging inside tick loop
  bead.coolingAge = 0;
  bead.initColor = new THREE.Color(colorHex);
}

/* Master Render/Tick Frame Loop */
function animate() {
  requestAnimationFrame(animate);

  const dt = 0.016; // mock frame time

  // 1. Joint angles linear interpolation
  if (isMovingToTarget) {
    moveTimer += dt;
    const progress = Math.min(moveTimer / moveDuration, 1.0);
    
    // Smooth easeInOutCubic curve
    const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    for (let i = 0; i < 6; i++) {
      jointAngles[i] = moveStartAngles[i] + (moveTargetAngles[i] - moveStartAngles[i]) * t;
    }
    updateForwardKinematics();

    if (progress >= 1.0) {
      isMovingToTarget = false;
    }
  }

  // 2. Welding Sweeper simulation
  if (isWeldingActive) {
    currentWeldProgress += dt * 0.22; // Sweep takes approx 4.5 seconds
    if (currentWeldProgress >= 1.0) {
      currentWeldProgress = 1.0;
      executeAutomatedStage(4); // Retract
    } else {
      // Guide robot tip along track seam
      let seamLength = 0.36;
      if (typeof activeCustomConfig !== 'undefined' && activeCustomConfig) {
        seamLength = activeCustomConfig.length || 0.36;
      }
      const seamTarget = new THREE.Vector3(-seamLength / 2 + seamLength * currentWeldProgress, 0.52, 0);
      solveCCDIK(seamTarget);

      // Flickering high-intensity electric arc point light
      if (scene.arcLightRef) {
        scene.arcLightRef.position.copy(currentTCPPosition);
        scene.arcLightRef.intensity = 1.5 + Math.random() * 2.0; // flickers
      }

      // Generate metallic glowing beads
      if (Math.random() < 0.35) {
        generateWeldBead(currentWeldProgress);
      }

      // Spray dynamic sparks based on welding mode
      const modeKey = activeWeldingMode ? activeWeldingMode.toLowerCase().replace(/[^a-z]/g, '') : 'mig';
      let colorMode = 'orange';
      let sparkCount = 3;

      if (modeKey === 'laser') {
        colorMode = 'magenta';
        sparkCount = 0; // laser is clean
      } else if (modeKey === 'plasma') {
        colorMode = 'cyan';
        sparkCount = 2;
      } else if (modeKey === 'tig') {
        colorMode = 'cyan';
        sparkCount = 1; // TIG precision clean
      } else if (modeKey === 'stick' || modeKey === 'mma') {
        colorMode = 'yellow';
        sparkCount = 8; // stick spatter heavy
      } else if (modeKey === 'friction') {
        colorMode = 'orange';
        sparkCount = 0; // friction solid state, zero sparks
      } else if (modeKey === 'electronbeam') {
        colorMode = 'magenta';
        sparkCount = 1;
      } else if (modeKey === 'saw') {
        colorMode = 'yellow';
        sparkCount = 0; // submerged arc has zero visible sparks
      }

      if (typeof activeFault !== 'undefined' && activeFault === 'gas_leak') {
        sparkCount = 12; // Massive spatter due to atmosphere shield rupture
        colorMode = 'yellow'; // Contaminated yellow sparks
      }

      if (sparkCount > 0 && Math.random() < 0.8) {
        sparks.spawn(currentTCPPosition, colorMode, sparkCount);
      }
    }
  }

  // 3. Update active weld pool cooling colors
  weldSeamBeads.forEach(bead => {
    bead.coolingAge += dt;
    
    // Smooth metal thermal cooling interpolation:
    // Hot pool -> Incandescent Amber -> Dull Cherry Red -> Steel Gray Slag
    const agePct = Math.min(bead.coolingAge / 3.0, 1.0); // Cools down completely over 3s
    
    let targetCol = new THREE.Color(0x3a4250); // Slag dark gray
    const matLower = activeWorkpieceMaterial ? activeWorkpieceMaterial.toLowerCase().trim() : 'steel';
    const coolingDB = {
      steel: 0x3a4250,
      iron: 0x272c35,
      aluminum: 0xccd9e8,
      copper: 0xb87333,
      titanium: 0x8a95a5,
      gold: 0xffd700,
      silver: 0xcccccc,
      bronze: 0xa87900,
      brass: 0xb5a642,
      platinum: 0xe5e4e2,
      nickel: 0x9e9e9e,
      cobalt: 0x3b5998,
      lead: 0x4f545a,
      zinc: 0xa9b2c0
    };
    if (coolingDB[matLower]) {
      targetCol = new THREE.Color(coolingDB[matLower]);
    } else {
      // Procedural color hashing matching spawner
      let hash = 0;
      for (let i = 0; i < matLower.length; i++) {
        hash = matLower.charCodeAt(i) + ((hash << 5) - hash);
      }
      const r = (hash & 0xFF0000) >> 16;
      const g = (hash & 0x00FF00) >> 8;
      const b = hash & 0x0000FF;
      const rawColor = new THREE.Color(`rgb(${Math.abs(r % 200)}, ${Math.abs(g % 200)}, ${Math.abs(b % 200)})`);
      targetCol = rawColor.lerp(new THREE.Color(0xdcdcdc), 0.45);
    }

    // Mix colors
    bead.material.color.copy(bead.initColor).lerp(targetCol, agePct);

    // Scale bead down slightly as it cools and shrinks
    const scale = 1.0 - 0.15 * agePct;
    bead.scale.set(scale, scale, scale);
  });

  // 4. Update flying sparks particles kinematics
  if (sparks) {
    sparks.update(dt);
  }

  // 5. Render active frame viewport
  if (orbitControls) orbitControls.update();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }

  // Synchronize state to localStorage for the Telemetry Dashboard
  if (!window.stateFrameCount) window.stateFrameCount = 0;
  window.stateFrameCount++;
  if (window.stateFrameCount % 10 === 0) {
    localStorage.setItem('weldforge_cell_state', JSON.stringify({
      systemMode: (typeof systemMode !== 'undefined') ? systemMode : 'IDLE',
      activeWorkpieceMaterial: activeWorkpieceMaterial,
      activeWeldingMode: activeWeldingMode,
      isWeldingActive: isWeldingActive,
      currentWeldProgress: currentWeldProgress,
      jointAngles: jointAngles,
      activeFault: (typeof activeFault !== 'undefined') ? activeFault : 'none',
      customPartConfig: (typeof activeCustomConfig !== 'undefined') ? activeCustomConfig : null
    }));
  }
}

function onWindowResize() {
  const container = document.getElementById('viewport-container');
  if (!container || !camera || !renderer) return;

  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function toggleSidebar() {
  document.body.classList.toggle('sidebar-active');
}

function updateHUDStatus(text, badgeClass) {
  const label = document.getElementById('system-status-text');
  const dot = document.getElementById('system-status-dot');
  if (label) label.textContent = text;
  
  if (dot) {
    dot.className = 'status-dot'; // reset
    if (badgeClass) dot.classList.add(badgeClass);
  }
}
