// ----------- TYPES & INTERFACES (unchanged) -----------

export type Vec2 = { x: number; y: number };

export interface ShipConfig {
  mass: number;
  maxLinearSpeed: number;
  maxReverseSpeed: number;
  maxAngularSpeed: number;
  thrustAccel: number;
  reverseAccel: number;
  strafeAccel: number;
  turnAccel: number;
  linearDrag: number;
  angularDrag: number;
  stopEpsilon: number;
  inputSmoothing: number;          // now treated as a time constant (seconds)
}

export interface ShipCommand {
  throttle: number;   // -1..1
  strafe: number;     // -1..1
  turn: number;       // -1..1
  aimAngle?: number;
}

export interface ShipPhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  angularVelocity: number;
}

export interface PhysicsModifiers {
  empMul?: number;
  boostImpulse?: number;
}

// ----------- UTILITY FUNCTIONS -----------

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Exponential smoothing factor that is frame‑rate independent.
 *  Assumes `timeConstant` is in seconds. */
function smoothFactor(dt: number, timeConstant: number): number {
  return 1 - Math.exp(-dt / timeConstant);
}

// ----------- PHYSICS CLASS -----------

export class ShipPhysics {
  position: Vec2 = { x: 0, y: 0 };
  velocity: Vec2 = { x: 0, y: 0 };
  heading = 0;
  angularVelocity = 0;

  private readonly config: ShipConfig;
  private smoothedThrottle = 0;
  private smoothedStrafe = 0;
  private smoothedTurn = 0;

  constructor(config: ShipConfig) {
    this.config = config;
  }

  reset(x: number, y: number, heading = 0): void {
    this.position.x = x;
    this.position.y = y;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.heading = heading;
    this.angularVelocity = 0;
    this.smoothedThrottle = 0;
    this.smoothedStrafe = 0;
    this.smoothedTurn = 0;
  }

  getState(): ShipPhysicsState {
    return {
      x: this.position.x,
      y: this.position.y,
      vx: this.velocity.x,
      vy: this.velocity.y,
      heading: this.heading,
      angularVelocity: this.angularVelocity,
    };
  }

  setState(state: ShipPhysicsState): void {
    this.position.x = state.x;
    this.position.y = state.y;
    this.velocity.x = state.vx;
    this.velocity.y = state.vy;
    this.heading = state.heading;
    this.angularVelocity = state.angularVelocity;
  }

  update(cmd: ShipCommand, dt: number, modifiers: PhysicsModifiers = {}): void {
    const safeDt = Math.min(dt, 0.1);

    // Convertir aimAngle a velocidad angular deseada
    let desiredAngularVel = 0;
    if (cmd.aimAngle !== undefined) {
      const error = normalizeAngle(cmd.aimAngle - this.heading);
      const ANGULAR_GAIN = 3.5;
      desiredAngularVel = clamp(error * ANGULAR_GAIN, -this.config.maxAngularSpeed, this.config.maxAngularSpeed);
    } else {
      // Suavizado del turn
      const alpha = smoothFactor(safeDt, this.config.inputSmoothing);
      this.smoothedTurn += (cmd.turn - this.smoothedTurn) * alpha;
      desiredAngularVel = this.smoothedTurn * this.config.maxAngularSpeed;
    }

    // PD Controller para torque
    const m = this.config.mass;
    const kp = this.config.turnAccel / m;
    const kd = this.config.angularDrag;  // Usamos angularDrag como coeficiente de amortiguación
    let torque = kp * (desiredAngularVel - this.angularVelocity) - kd * this.angularVelocity;
    const MAX_TORQUE = this.config.turnAccel * 2 / m;
    torque = clamp(torque, -MAX_TORQUE, MAX_TORQUE);
    this.angularVelocity += torque * safeDt;
    this.angularVelocity = clamp(this.angularVelocity, -this.config.maxAngularSpeed, this.config.maxAngularSpeed);

    // Resto igual: local axes, thrust, modifiers, drag (solo linearDrag), speed caps, integración...
    const forward = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    const right = { x: -Math.sin(this.heading), y: Math.cos(this.heading) };

    // Throttle smoothing (igual que antes)
    const alphaLin = smoothFactor(safeDt, this.config.inputSmoothing);
    this.smoothedThrottle += (cmd.throttle - this.smoothedThrottle) * alphaLin;
    this.smoothedStrafe += (cmd.strafe - this.smoothedStrafe) * alphaLin;

    const forwardAccel = this.smoothedThrottle >= 0
      ? (this.smoothedThrottle * this.config.thrustAccel) / m
      : (this.smoothedThrottle * this.config.reverseAccel) / m;
    const strafeAccel = (this.smoothedStrafe * this.config.strafeAccel) / m;
    this.velocity.x += (forward.x * forwardAccel + right.x * strafeAccel) * safeDt;
    this.velocity.y += (forward.y * forwardAccel + right.y * strafeAccel) * safeDt;

    // Modifiers
    if (modifiers.empMul !== undefined) {
      this.velocity.x *= modifiers.empMul;
      this.velocity.y *= modifiers.empMul;
      this.angularVelocity *= modifiers.empMul;
    }
    if (modifiers.boostImpulse !== undefined) {
      this.velocity.x += forward.x * modifiers.boostImpulse;
      this.velocity.y += forward.y * modifiers.boostImpulse;
    }

    // Linear drag (opcional, si quieres que la nave frene sola)
    this.velocity.x -= this.velocity.x * this.config.linearDrag * safeDt;
    this.velocity.y -= this.velocity.y * this.config.linearDrag * safeDt;

    // Micro-drift kill
    if (Math.abs(this.velocity.x) < this.config.stopEpsilon) this.velocity.x = 0;
    if (Math.abs(this.velocity.y) < this.config.stopEpsilon) this.velocity.y = 0;
    if (Math.abs(this.angularVelocity) < this.config.stopEpsilon) this.angularVelocity = 0;

    // Speed caps
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > 0.001) {
      const forwardSpeed = this.velocity.x * forward.x + this.velocity.y * forward.y;
      if (forwardSpeed >= 0) {
        if (speed > this.config.maxLinearSpeed) {
          const k = this.config.maxLinearSpeed / speed;
          this.velocity.x *= k; this.velocity.y *= k;
        }
      } else {
        if (speed > this.config.maxReverseSpeed) {
          const k = this.config.maxReverseSpeed / speed;
          this.velocity.x *= k; this.velocity.y *= k;
        }
      }
    }

    // Integración final
    this.position.x += this.velocity.x * safeDt;
    this.position.y += this.velocity.y * safeDt;
    this.heading = normalizeAngle(this.heading + this.angularVelocity * safeDt);
  }
}