import * as THREE from 'three';

// Initialize physics world
export function initPhysics(ammo) {
  // Create physics configuration
  const collisionConfig = new ammo.btDefaultCollisionConfiguration();
  const dispatcher = new ammo.btCollisionDispatcher(collisionConfig);
  const broadphase = new ammo.btDbvtBroadphase();
  const solver = new ammo.btSequentialImpulseConstraintSolver();
  
  // Create physics world
  const physicsWorld = new ammo.btDiscreteDynamicsWorld(
    dispatcher, broadphase, solver, collisionConfig
  );
  
  // Set gravity
  physicsWorld.setGravity(new ammo.btVector3(0, -20, 0));
  
  // Create temporary transform for reuse
  const tmpTrans = new ammo.btTransform();
  
  console.log("Physics world initialized");
  
  return { physicsWorld, tmpTrans };
}

// Throttle eases in so a full press does not kick the rear wheels and hop the car.
let driveForce = 0;
const _carForward = new THREE.Vector3();
const _velocity = new THREE.Vector3();

function moveToward(current, target, maxDelta) {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return target;
}

// Update physics simulation
export function updatePhysics(deltaTime, ammo, physicsState, carState, debugObjects, raceState) {
  const { physicsWorld, tmpTrans } = physicsState;
  const { 
    carBody, vehicle, carModel, wheelMeshes, 
    keyState, currentSteeringAngle, updateSteering
  } = carState;
  
  if (!vehicle || !carModel) return { currentSpeed: 0 };
  
  // Get current velocity to determine if we're moving forward or backward
  const velocity = carBody.getLinearVelocity();
  
  // Get forward direction using Three.js
  const carForward = _carForward;
  carModel.getWorldDirection(carForward);
  
  // Convert Ammo velocity to Three.js vector
  const velocityThree = _velocity.set(velocity.x(), velocity.y(), velocity.z());
  
  // Calculate dot product using Three.js
  const dotForward = carForward.dot(velocityThree);
  const maxEngineForce = 2000;
  const maxBrakingForce = 80;
  
  // Calculate car speed in km/h
  const speedKPH = velocityThree.length() * 3.6;
  
  // Check if the race has started before allowing engine forces
  let brakingForce = 0;
  let targetDrive = 0;
  
  // Only allow movement if race has started and not finished
  if (raceState.raceStarted && !raceState.raceFinished) {
    // Handle key inputs with proper braking logic
    if (keyState.w) {
      targetDrive = maxEngineForce;
      brakingForce = 0;
    } else if (keyState.s) {
      if (dotForward > 0.1) {
        // Moving forward - apply brakes when S is pressed
        targetDrive = 0;
        brakingForce = maxBrakingForce;
      } else {
        // Stopped or moving backward - apply reverse
        targetDrive = -maxEngineForce / 2;
        brakingForce = 0;
      }
    } else {
      targetDrive = 0;
      brakingForce = 14;
    }
  } else {
    targetDrive = 0;
    brakingForce = maxBrakingForce;
  }

  const rise = 2400 * deltaTime;
  const fall = 3600 * deltaTime;
  driveForce = moveToward(driveForce, targetDrive, targetDrive > driveForce ? rise : fall);
  const engineForce = driveForce;
  
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i >= 2) vehicle.applyEngineForce(engineForce, i);
    else vehicle.applyEngineForce(0, i);
    vehicle.setBrake(brakingForce, i);
  }

  let newSteeringAngle = 0;
  
  // Call updateSteering to update the steering angle, passing the current speed
  if (!raceState.raceFinished) {
    newSteeringAngle = updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle, speedKPH);
  }
  
  // Clean up Ammo.js objects to prevent memory leaks
  ammo.destroy(velocity);
  
  // Step physics simulation
  physicsWorld.stepSimulation(deltaTime, 10);
  
  // Update debug objects if any
  if (debugObjects && debugObjects.length > 0) {
    updateDebugObjects(vehicle, debugObjects, tmpTrans);
  }
  
  // Return both speed and the new steering angle
  return { 
    currentSpeed: speedKPH,
    currentSteeringAngle: newSteeringAngle 
  };
}

// Update debug objects
function updateDebugObjects(vehicle, debugObjects, tmpTrans) {
  debugObjects.forEach((obj, index) => {
    if (obj.isWheel) {
      const wheelIndex = obj.wheelIndex % 4;
      vehicle.updateWheelTransform(wheelIndex, true);
      const transform = vehicle.getWheelInfo(wheelIndex).get_m_worldTransform();
      const pos = transform.getOrigin();
      const quat = transform.getRotation();
      
      obj.mesh.position.set(pos.x(), pos.y(), pos.z());
      obj.mesh.quaternion.set(quat.x(), quat.y(), quat.z(), quat.w());
    } else if (obj.body) {
      const ms = obj.body.getMotionState();
      if (ms) {
        ms.getWorldTransform(tmpTrans);
        const p = tmpTrans.getOrigin();
        const q = tmpTrans.getRotation();
        
        obj.mesh.position.set(p.x(), p.y(), p.z());
        obj.mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
      }
    }
  });
}

// Physics time step constants
export const FIXED_PHYSICS_STEP = 1/60; // 60Hz physics

// Add a rigid body to the physics world
export function addRigidBody(
  ammo, physicsWorld, shape, mass, position, quaternion, 
  friction = 0.5, restitution = 0.2
) {
  const transform = new ammo.btTransform();
  transform.setIdentity();
  
  // Set position
  transform.setOrigin(
    new ammo.btVector3(position.x, position.y, position.z)
  );
  
  // Set rotation
  if (quaternion) {
    transform.setRotation(
      new ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    );
  }
  
  const motionState = new ammo.btDefaultMotionState(transform);
  const localInertia = new ammo.btVector3(0, 0, 0);
  
  // Calculate inertia for dynamic bodies
  if (mass > 0) {
    shape.calculateLocalInertia(mass, localInertia);
  }
  
  // Create rigid body info
  const rbInfo = new ammo.btRigidBodyConstructionInfo(
    mass, motionState, shape, localInertia
  );
  
  // Create rigid body
  const body = new ammo.btRigidBody(rbInfo);
  
  // Set friction and restitution
  body.setFriction(friction);
  body.setRestitution(restitution);
  
  // Add to physics world
  physicsWorld.addRigidBody(body);
  
  // Clean up temporary Ammo objects
  ammo.destroy(transform);
  ammo.destroy(localInertia);
  ammo.destroy(rbInfo);
  
  return body;
}