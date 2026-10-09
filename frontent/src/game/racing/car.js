import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

function getLoadingManager() {
  return typeof window !== 'undefined' ? window.loadingManager : null;
}

/**
 * One car per player: the one who sent the challenge is the host ('blue'),
 * the one who accepted is the guest ('red'). Both players see the same pair.
 */
const CAR_BY_COLOR = {
  blue: '/models/ergoninane-fast-72.glb',
  red: '/models/ergoninane-fast-74.glb',
};
const FALLBACK_CAR_URL = '/models/car_red.glb';

function carModelUrl(carColor) {
  return CAR_BY_COLOR[carColor] || CAR_BY_COLOR.blue;
}

/** Each call loads a fresh GLTF (player mutates scene — never reuse the same scene). */
function loadCarGltf(url, onOk, onErr) {
  const loader = new GLTFLoader(getLoadingManager() || undefined);
  loader.load(url, onOk, undefined, onErr);
}

/** Visual-only opponent car; counted by LoadingManager when present. */
export function loadOpponentCarVisual(scene, carColor, onRoot) {
  const url = carModelUrl(carColor);
  loadCarGltf(
    url,
    (gltf) => {
      const root = buildOpponentCarRoot(gltf);
      scene.add(root);
      onRoot?.(root);
    },
    (err) => {
      console.error('[car] opponent model load failed:', err);
      onRoot?.(null);
    }
  );
}

/** Deep-clone car scene for a second visual (opponent); keeps wheels on body. */
export function cloneCarVisualScene(sourceScene) {
  let hasSkinned = false;
  sourceScene.traverse((n) => {
    if (n.isSkinnedMesh) hasSkinned = true;
  });
  if (hasSkinned) {
    try {
      return cloneSkeleton(sourceScene);
    } catch (e) {
      console.warn('[car] cloneSkeleton failed, using scene.clone', e);
    }
  }
  return sourceScene.clone(true);
}

const CAR_MODEL_SCALE = 4;
/** Tyres rest a hair above the road so the body never scrapes on a bump. */
const BODY_GROUND_GAP = 0.09;

/** Wheel nodes in the order the physics wheels are added (see wheelPositions). */
const WHEEL_SLOT_PATTERNS = [
  /(front.?right|wheel-fr)/i,
  /(front.?left|wheel-fl)/i,
  /(rear.?right|back.?right|wheel-br)/i,
  /(rear.?left|back.?left|wheel-bl)/i,
];

/** GLTFLoader drops dots from node names, so match loosely rather than by exact name. */
function findWheelNodes(model) {
  const found = [];
  model.traverse((node) => {
    if (node.isMesh && /wheel/i.test(node.name || '')) found.push(node);
  });
  return WHEEL_SLOT_PATTERNS.map((re) => found.find((node) => re.test(node.name)) || null);
}

/** Width of the body alone. Wheels are left out; they are placed by physics. */
function measureBodyHalfWidth(model) {
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  model.traverse((node) => {
    if (!node.isMesh || /wheel/i.test(node.name || '')) return;
    box.union(meshBox.setFromObject(node));
  });
  return box.isEmpty() ? 0 : Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
}

/**
 * Fit any car GLB to the raycast vehicle: scale the body to the chassis width, then
 * drop it so the tyres touch the road. Matching the width is what keeps the tyres
 * visible beside the body — fit by wheel track instead and a wide body swallows them.
 */
function applyCarBodyScale(model) {
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3();
  const halfWidth = measureBodyHalfWidth(model);
  const scale = halfWidth > 1e-6 ? (VEHICLE_WIDTH / 2) / halfWidth : CAR_MODEL_SCALE;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  box.setFromObject(model);
  if (!box.isEmpty()) {
    const lift = -(WHEEL_RADIUS + SUSPENSION_REST_LENGTH - BODY_GROUND_GAP) - box.min.y;
    for (const child of model.children) child.position.y += lift / scale;
    model.updateMatrixWorld(true);
  }

  // Opponent cars keep wheels on the body, so trim stubs here too.
  for (const wheel of findWheelNodes(model)) {
    if (wheel) trimWheelAxleStub(wheel);
  }

  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = false;
      node.frustumCulled = true;
    }
  });
}

/** Opponent-only visual (wheels stay on the body — no physics detach). */
export function buildOpponentCarRoot(gltf) {
  const model = cloneCarVisualScene(gltf.scene);
  applyCarBodyScale(model);
  const root = new THREE.Group();
  root.name = 'opponentCarRoot';
  root.position.set(0, 100, 0);
  root.visible = false;
  root.add(model);
  return root;
}

// Vehicle parameters
const VEHICLE_WIDTH = 2.0;
const VEHICLE_HEIGHT = 0.6;
const VEHICLE_LENGTH = 4.0;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.25;
const SUSPENSION_REST_LENGTH = 0.3;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

// Physics tuning parameters
const SUSPENSION_STIFFNESS = 50;
const SUSPENSION_DAMPING = 10;
const SUSPENSION_COMPRESSION = 4.0;
const ROLL_INFLUENCE = 0.1;
const WHEEL_FRICTION = 12;

/**
 * These car GLBs bake a short axle rod into each wheel mesh. From behind that looks
 * like a grey cylinder sticking out of the tyre. Keep only the middle band of the
 * mesh along the axle (x), which is the tyre itself.
 */
function trimWheelAxleStub(wheelMesh) {
  if (!wheelMesh?.geometry?.attributes?.position) return;
  const geometry = wheelMesh.geometry.clone();
  const position = geometry.attributes.position;
  const count = position.count;
  if (count < 8) return;

  const xs = new Float32Array(count);
  for (let i = 0; i < count; i++) xs[i] = position.getX(i);
  xs.sort();
  const lo = xs[Math.floor(count * 0.1)];
  const hi = xs[Math.floor(count * 0.9)];
  if (!(hi > lo)) return;

  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    if (x < lo) position.setX(i, lo);
    else if (x > hi) position.setX(i, hi);
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  wheelMesh.geometry = geometry;
}

/**
 * Bullet raycast wheels use `WHEEL_RADIUS` (m). GLB wheels are scaled with the body;
 * an extra scale after detaching can make tires huge vs physics → they look “drowned” in the road.
 * Uniformly scale each wheel mesh so its bounding extent matches the physics radius.
 */
function fitWheelMeshToPhysicsRadius(wheelMesh, targetRadius = WHEEL_RADIUS) {
  if (!wheelMesh || !wheelMesh.geometry) return;
  trimWheelAxleStub(wheelMesh);
  const geometry = wheelMesh.geometry.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);
  // The axle runs along x, so the tyre is as big as its reach in y/z.
  const approxR = Math.max(size.y, size.z) / 2;
  if (!(approxR > 1e-6) || !Number.isFinite(approxR)) return;

  // Physics drives the mesh origin, and models often author each wheel at its place
  // on the body, so move the tyre onto its own origin.
  const position = geometry.attributes.position;
  const xs = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) xs[i] = position.getX(i);
  xs.sort();
  geometry.translate(
    -xs[xs.length >> 1],
    -(box.min.y + box.max.y) / 2,
    -(box.min.z + box.max.z) / 2
  );

  wheelMesh.geometry = geometry;
  wheelMesh.position.set(0, 0, 0);
  wheelMesh.scale.setScalar(targetRadius / approxR);
}

// Reused for start-line / respawn lateral offset (host vs guest lanes)
const _laneRight = new THREE.Vector3();
const _laneForward = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/** Horizontal unit vector perpendicular to the track direction (side-by-side), not gate-local +X (often along the road). */
function setLaneLateralFromGateQuaternion(quat, out) {
  // Car / gate forward in Three.js is typically −Z in local space
  _laneForward.set(0, 0, -1).applyQuaternion(quat);
  _laneForward.y = 0;
  if (_laneForward.lengthSq() < 1e-10) {
    // Gate aimed straight up/down — fallback: old gate-local +X projected flat
    out.set(1, 0, 0).applyQuaternion(quat);
    out.y = 0;
    if (out.lengthSq() < 1e-10) {
      out.set(1, 0, 0);
    } else {
      out.normalize();
    }
    return;
  }
  _laneForward.normalize();
  out.crossVectors(_worldUp, _laneForward);
  out.y = 0;
  if (out.lengthSq() < 1e-10) {
    out.set(1, 0, 0).applyQuaternion(quat);
    out.y = 0;
    if (out.lengthSq() < 1e-10) out.set(1, 0, 0);
    else out.normalize();
  } else {
    out.normalize();
  }
}

// Steering parameters
const MAX_STEERING_ANGLE = 0.15;
const STEERING_SPEED = 1.5;
const STEERING_RETURN_SPEED = 2; 

// Modify createVehicle to accept a callback for when the car is fully loaded
export function createVehicle(ammo, scene, physicsWorld, debugObjects, onCarLoaded, carColor = 'blue') {
  console.log("Starting vehicle creation, color:", carColor);
  
  // Store car color for model loading
  window._playerCarColor = carColor;
  
  // Car components that will be returned immediately for physics setup
  const carComponents = {
    carBody: null,
    vehicle: null,
    wheelMeshes: [],
    carModel: null,
    currentSteeringAngle: 0
  };
  
  // Create chassis physics body with modified dimensions
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH/2, VEHICLE_HEIGHT/2 * 0.8, VEHICLE_LENGTH/2 * 0.9)
  );
  
  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  // Move the chassis origin up slightly to prevent underbody scraping
  chassisTransform.setOrigin(new ammo.btVector3(0, 5.2, 0));
  
  const chassisMotionState = new ammo.btDefaultMotionState(chassisTransform);
  const chassisMass = 200;
  const localInertia = new ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(chassisMass, localInertia);
  
  const chassisRbInfo = new ammo.btRigidBodyConstructionInfo(
    chassisMass, chassisMotionState, chassisShape, localInertia
  );
  
  carComponents.carBody = new ammo.btRigidBody(chassisRbInfo);
  carComponents.carBody.setActivationState(4);
  carComponents.carBody.setFriction(0.1);
  carComponents.carBody.setRestitution(0.05);
  // Stronger angular damping reduces violent rolls / tumbles on curbs and barriers
  carComponents.carBody.setDamping(0.48, 0.72);
  if (typeof carComponents.carBody.setCcdMotionThreshold === 'function') {
    carComponents.carBody.setCcdMotionThreshold(0.25);
  }
  if (typeof carComponents.carBody.setCcdSweptSphereRadius === 'function') {
    carComponents.carBody.setCcdSweptSphereRadius(0.55);
  }
  physicsWorld.addRigidBody(carComponents.carBody);
  
  // Create vehicle raycaster
  const tuning = new ammo.btVehicleTuning();
  const vehicleRaycaster = new ammo.btDefaultVehicleRaycaster(physicsWorld);
  carComponents.vehicle = new ammo.btRaycastVehicle(tuning, carComponents.carBody, vehicleRaycaster);
  
  // Configure vehicle
  carComponents.vehicle.setCoordinateSystem(0, 1, 2); 
  physicsWorld.addAction(carComponents.vehicle);
  
  // Wheel directions and axles
  const wheelDirCS = new ammo.btVector3(0, -1, 0);
  const wheelAxleCS = new ammo.btVector3(-1, 0, 0);
  
  // Add all four wheels
  const wheelPositions = [
    { x: -WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fl' }, 
    { x: WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fr' },  
    { x: -WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' }, 
    { x: WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-br' }  
  ];
  
  // Create wheels with physics (but without visuals yet)
  for (let i = 0; i < wheelPositions.length; i++) {
    const pos = wheelPositions[i];
    const isFront = i < 2; 
    
    // Connect wheel to vehicle
    const connectionPoint = new ammo.btVector3(pos.x, pos.y, pos.z);
    carComponents.vehicle.addWheel(
      connectionPoint,
      wheelDirCS,
      wheelAxleCS,
      SUSPENSION_REST_LENGTH,
      WHEEL_RADIUS,
      tuning,
      isFront
    );
    
    // Configure wheel
    const wheelInfo = carComponents.vehicle.getWheelInfo(i);
    wheelInfo.set_m_suspensionStiffness(SUSPENSION_STIFFNESS);
    wheelInfo.set_m_wheelsDampingRelaxation(SUSPENSION_DAMPING);
    wheelInfo.set_m_wheelsDampingCompression(SUSPENSION_COMPRESSION);
    wheelInfo.set_m_frictionSlip(WHEEL_FRICTION);
    wheelInfo.set_m_rollInfluence(ROLL_INFLUENCE);
    wheelInfo.set_m_maxSuspensionTravelCm(SUSPENSION_REST_LENGTH * 150); 
    
    // Add a placeholder for the wheel mesh
    carComponents.wheelMeshes.push(null);
  }
  
  // Now load the car model with a callback
  loadCarModel(ammo, scene, carComponents, wheelPositions, (updatedComponents) => {
    console.log("Car model fully loaded, calling onCarLoaded callback");
    // When the car model is fully loaded, call the callback with the updated components
    if (onCarLoaded) onCarLoaded(updatedComponents);
  }, carColor);
  
  // Return physics body immediately for setting up physics
  return carComponents;
}

// Modify loadCarModel to accept and use a callback
function loadCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded, selectedColor) {
  // Get the player ID
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  // Determine car color with proper priority:
  let carColor = selectedColor || 'red';
  
  // Try getting from gameConfig that might be in sessionStorage
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gameConfig = JSON.parse(savedConfig);
      if (gameConfig && gameConfig.players) {
        const playerInfo = gameConfig.players.find(p => p.id === myPlayerId);
        if (playerInfo && playerInfo.playerColor) {
          carColor = playerInfo.playerColor;
          console.log(`Using car color from gameConfig: ${carColor}`);
        }
      }
    }
  } catch (e) {
    console.error('Error getting car color from game config:', e);
  }
  
  // Fall back to sessionStorage if not found in gameConfig
  if (carColor === 'red') {
    const storedColor = sessionStorage.getItem('carColor');
    if (storedColor) {
      carColor = storedColor;
      console.log(`Using car color from sessionStorage: ${carColor}`);
    } else {
      console.log('Using default red color');
    }
  }
  
  const url = carModelUrl(carColor);

  const applyGltfToPlayer = (gltf) => {
      const carModel = gltf.scene;
      applyCarBodyScale(carModel);
      carModel.visible = false;
      
      const wheelModelMeshes = findWheelNodes(carModel);
      
      // Store reference to wheel meshes and detach them from car model
      for (let i = 0; i < wheelModelMeshes.length; i++) {
        if (wheelModelMeshes[i]) {
          // Get the original world matrix before removal to preserve transformations
          wheelModelMeshes[i].updateMatrixWorld(true);
          
          // Remove from car model
          carModel.remove(wheelModelMeshes[i]);
          
          // Add directly to scene so we can control it separately
          scene.add(wheelModelMeshes[i]);
          
          // Match visual tire size to Bullet wheel radius (do not stack another ×4 on top of body scale)
          fitWheelMeshToPhysicsRadius(wheelModelMeshes[i]);
          
          // Save reference
          carComponents.wheelMeshes[i] = wheelModelMeshes[i];
          
          console.log(`Found and set up wheel: ${wheelPositions[i].name}`);
        } else {
          console.warn(`Could not find wheel mesh: ${wheelPositions[i].name}`);
          
          // Create a default wheel as fallback
          const wheelGeometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
          );
          wheelGeometry.rotateZ(Math.PI/2); 
          
          const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheelMesh.castShadow = true;
          scene.add(wheelMesh);
          // Geometry radius is already WHEEL_RADIUS — no extra ×4 (that made tires 1.6m vs physics 0.4m)
          
          // Use this default wheel
          carComponents.wheelMeshes[i] = wheelMesh;
        }
      }
      
      scene.add(carModel);
      carComponents.carModel = carModel;

      const wheelsReady = carComponents.wheelMeshes.every((w) => w != null);
      if (wheelsReady) {
        carModel.visible = true;
        console.log('Car model loaded successfully');
        if (onModelLoaded) onModelLoaded(carComponents);
      } else {
        console.warn('[car] Missing wheel meshes — retrying with fallback model');
        if (url !== FALLBACK_CAR_URL) {
          loadFallbackCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded);
        } else {
          carModel.visible = true;
          if (onModelLoaded) onModelLoaded(carComponents);
        }
      }
  };

  loadCarGltf(
    url,
    applyGltfToPlayer,
    (error) => {
      console.error(`Error loading ${carColor} car model:`, error);
      if (url !== FALLBACK_CAR_URL) {
        loadFallbackCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded);
      }
    }
  );
}

// Update fallback model function to also use callback
function loadFallbackCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded) {
  console.log('Falling back to red car model');

  loadCarGltf(
    FALLBACK_CAR_URL,
    (gltf) => {
      if (carComponents.carModel) {
        scene.remove(carComponents.carModel);
      }
      carComponents.wheelMeshes.forEach((w) => {
        if (w) scene.remove(w);
      });
      carComponents.wheelMeshes = [];

      const carModel = gltf.scene;
      applyCarBodyScale(carModel);
      
      // Process wheel meshes (same as in loadCarModel)
      const wheelModelMeshes = findWheelNodes(carModel);
      
      for (let i = 0; i < wheelModelMeshes.length; i++) {
        if (wheelModelMeshes[i]) {
          wheelModelMeshes[i].updateMatrixWorld(true);
          carModel.remove(wheelModelMeshes[i]);
          scene.add(wheelModelMeshes[i]);
          fitWheelMeshToPhysicsRadius(wheelModelMeshes[i]);
          carComponents.wheelMeshes[i] = wheelModelMeshes[i];
        } else {
          // Create default wheel
          const wheelGeometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
          );
          wheelGeometry.rotateZ(Math.PI/2);
          
          const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheelMesh.castShadow = true;
          scene.add(wheelMesh);
          carComponents.wheelMeshes[i] = wheelMesh;
        }
      }
      
      scene.add(carModel);
      carComponents.carModel = carModel;
      carModel.visible = true;
      console.log('Fallback car model loaded successfully');
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    (error) => {
      console.error('Error loading fallback red car model:', error);
    }
  );
}

// Update steering based on key state
export function updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle, currentSpeed = 0) {
  // Calculate dynamic maximum steering angle based on speed
  const maxSteeringAngle = calculateMaxSteeringAngle(currentSpeed);
  
  // Calculate target steering angle based on key state
  let targetSteeringAngle = 0;
  
  if (keyState.a) {
    targetSteeringAngle = maxSteeringAngle; 
  } else if (keyState.d) {
    targetSteeringAngle = -maxSteeringAngle;
  }
  
  // Determine appropriate steering speed
  const steeringSpeed = (targetSteeringAngle === 0 || 
                         (currentSteeringAngle > 0 && targetSteeringAngle < 0) || 
                         (currentSteeringAngle < 0 && targetSteeringAngle > 0)) ? 
    STEERING_RETURN_SPEED : 
    STEERING_SPEED;         
  
  // Smoothly interpolate current steering angle towards target
  const steeringDelta = targetSteeringAngle - currentSteeringAngle;
  const maxSteeringDelta = steeringSpeed * deltaTime;
  
  let newSteeringAngle = currentSteeringAngle;
  
  // Limit the steering change per frame
  if (Math.abs(steeringDelta) > maxSteeringDelta) {
    newSteeringAngle += Math.sign(steeringDelta) * maxSteeringDelta;
  } else {
    newSteeringAngle = targetSteeringAngle;
  }
  
  // Apply steering to front wheels
  for (let i = 0; i < 2; i++) {
    vehicle.setSteeringValue(newSteeringAngle, i);
  }
  
  return newSteeringAngle;
}

// Add a new function to calculate max steering angle based on speed
function calculateMaxSteeringAngle(speedKPH) {
  // Constants for steering behavior
  const MIN_SPEED = 0;   
  const MAX_SPEED = 150; 
  const MIN_ANGLE = 0.15;
  const MAX_ANGLE = 0.4; 
  
  // Clamp the speed to avoid extreme values
  const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speedKPH));
  
  const speedFactor = (clampedSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  const steeringAngle = MAX_ANGLE - speedFactor * (MAX_ANGLE - MIN_ANGLE);
  
  return steeringAngle;
}

// Reset car position
// laneOffsetMeters: shift sideways across the track (same distance along the road for both; host +, guest −)
export function resetCarPosition(ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion, laneOffsetMeters = 0) {
  // Cancel all movement
  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);
  
  let ox = currentGatePosition.x;
  let oy = currentGatePosition.y + 2;
  let oz = currentGatePosition.z;
  if (laneOffsetMeters) {
    setLaneLateralFromGateQuaternion(currentGateQuaternion, _laneRight);
    _laneRight.multiplyScalar(laneOffsetMeters);
    ox += _laneRight.x;
    oy += _laneRight.y;
    oz += _laneRight.z;
  }

  // Reset position transform
  const resetTransform = new ammo.btTransform();
  resetTransform.setIdentity();
  resetTransform.setOrigin(new ammo.btVector3(ox, oy, oz)); 
  
  const rotQuat = new ammo.btQuaternion(
    currentGateQuaternion.x,
    currentGateQuaternion.y,
    currentGateQuaternion.z,
    currentGateQuaternion.w
  );
  resetTransform.setRotation(rotQuat);
  
  // Apply transform
  carBody.setWorldTransform(resetTransform);
  carBody.getMotionState().setWorldTransform(resetTransform);
  
  // Reset steering
  let newSteeringAngle = 0;
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i < 2) { // Front wheels only
      vehicle.setSteeringValue(0, i);
    }
    
    // Reset wheel rotation and position
    vehicle.updateWheelTransform(i, true);
  }
  
  // Clean up
  ammo.destroy(zero);
  ammo.destroy(rotQuat);
  ammo.destroy(resetTransform);
  
  return newSteeringAngle;
}

// Update car and wheel positions from physics
export function updateCarPosition(ammo, vehicle, carModel, wheelMeshes) {
  if (!vehicle || !carModel || !carModel.visible) return;
  
  // Update chassis transform
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();

  // Update car model position
  carModel.position.set(position.x(), position.y(), position.z());
  carModel.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());
  
  // Update wheel transforms
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    // Sync wheels with physics
    vehicle.updateWheelTransform(i, true);
    const transform = vehicle.getWheelInfo(i).get_m_worldTransform();
    const wheelPosition = transform.getOrigin();
    const wheelQuaternion = transform.getRotation();
    
    const wm = wheelMeshes[i];
    if (!wm) continue;
    wm.position.set(wheelPosition.x(), wheelPosition.y(), wheelPosition.z());
    wm.quaternion.set(
      wheelQuaternion.x(),
      wheelQuaternion.y(),
      wheelQuaternion.z(),
      wheelQuaternion.w()
    );
  }
}