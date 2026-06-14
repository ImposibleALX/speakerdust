export type Vec2 = { x: number; y: number };

export interface ShipConfig {
  mass: number;
  maxLinearSpeed: number;
  maxReverseSpeed: number;
  maxAngularSpeed: number;
  thrustAccel: number; // Tratados como "Fuerza" internamente al dividirse por masa
  reverseAccel: number;
  strafeAccel: number;
  turnAccel: number;   // Torque máximo de giro
  linearDrag: number;
  angularDrag: number;
  stopEpsilon: number;
  inputSmoothing: number; // Constante de tiempo en segundos
}

export interface ShipCommand {
  throttle: number; // -1..1
  strafe: number;   // -1..1
  turn: number;     // -1..1
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
  speedMul?: number;
  thrustMul?: number;
}

// ----------- FUNCIONES DE UTILIDAD -----------

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function smoothFactor(dt: number, timeConstant: number): number {
  if (timeConstant <= 0) return 1;
  return 1 - Math.exp(-dt / timeConstant);
}

// ----------- CLASE DE FÍSICAS -----------

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
    if (dt <= 0) return;
    const safeDt = Math.min(dt, 0.1); // Prevenir explosiones de físicas en lag spikes

    const m = this.config.mass;
    const alphaInput = smoothFactor(safeDt, this.config.inputSmoothing);

    // ==========================================
    // 1. ROTACIÓN (Físicas de Torque + Drag)
    // ==========================================
    let desiredAngularVel = 0;

    if (cmd.aimAngle !== undefined) {
      // Si apuntamos con ratón/mando, calculamos la velocidad necesaria para llegar
      const error = normalizeAngle(cmd.aimAngle - this.heading);
      const ANGULAR_GAIN = 5.0; // Qué tan agresivo busca el ángulo
      desiredAngularVel = clamp(error * ANGULAR_GAIN, -this.config.maxAngularSpeed, this.config.maxAngularSpeed);
      // Reseteamos el turn manual para que no haya latigazos si se desactiva el aimAngle
      this.smoothedTurn = desiredAngularVel / this.config.maxAngularSpeed;
    } else {
      // Giro manual con teclas/stick suavizado
      this.smoothedTurn += (cmd.turn - this.smoothedTurn) * alphaInput;
      desiredAngularVel = this.smoothedTurn * this.config.maxAngularSpeed;
    }

    // Aceleración necesaria para alcanzar la velocidad deseada
    const requiredAngularAccel = (desiredAngularVel - this.angularVelocity) / safeDt;

    // El motor aplica torque, limitado por su capacidad física
    const maxEngineAngularAccel = this.config.turnAccel / m;
    let appliedAngularAccel = clamp(requiredAngularAccel, -maxEngineAngularAccel, maxEngineAngularAccel);

    // Aplicar aceleración del motor
    this.angularVelocity += appliedAngularAccel * safeDt;

    // Aplicar fricción angular de forma independiente al framerate (Drag real)
    this.angularVelocity *= Math.exp(-this.config.angularDrag * safeDt);

    // Límite duro de velocidad angular
    this.angularVelocity = clamp(this.angularVelocity, -this.config.maxAngularSpeed, this.config.maxAngularSpeed);

    // ==========================================
    // 2. TRASLACIÓN (Movimiento Lineal)
    // ==========================================

    // Optimización trigonométrica: Calcular seno y coseno solo UNA vez por frame
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);

    // Suavizado lineal
    this.smoothedThrottle += (cmd.throttle - this.smoothedThrottle) * alphaInput;
    this.smoothedStrafe += (cmd.strafe - this.smoothedStrafe) * alphaInput;

    // Fuerzas (divididas por masa para obtener aceleración)
    const thrustMul = modifiers.thrustMul ?? 1;
    const forwardForce = this.smoothedThrottle >= 0
      ? this.smoothedThrottle * this.config.thrustAccel * thrustMul
      : this.smoothedThrottle * this.config.reverseAccel * thrustMul;

    const strafeForce = this.smoothedStrafe * this.config.strafeAccel * thrustMul;

    const forwardAccel = forwardForce / m;
    const strafeAccel = strafeForce / m;

    // Transformar fuerzas locales a ejes globales (X, Y) sin crear objetos en memoria
    const accelX = (cosH * forwardAccel) - (sinH * strafeAccel);
    const accelY = (sinH * forwardAccel) + (cosH * strafeAccel);

    this.velocity.x += accelX * safeDt;
    this.velocity.y += accelY * safeDt;

    // ==========================================
    // 3. MODIFICADORES EXTERNOS
    // ==========================================
    if (modifiers.empMul !== undefined) {
      this.velocity.x *= modifiers.empMul;
      this.velocity.y *= modifiers.empMul;
      this.angularVelocity *= modifiers.empMul;
    }

    // ==========================================
    // 4. FRICCIÓN LINEAL (Drag independiente del framerate)
    // ==========================================
    const linearDragFactor = Math.exp(-this.config.linearDrag * safeDt);
    this.velocity.x *= linearDragFactor;
    this.velocity.y *= linearDragFactor;

    // ==========================================
    // 5. LÍMITES DE VELOCIDAD DINÁMICOS
    // ==========================================
    const speedSq = this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y;

    if (speedSq > 0.000001) {
      const speed = Math.sqrt(speedSq);

      // Proyección de la velocidad sobre el vector "Forward" (-1 a 1)
      // Indica si la nave va hacia adelante (1), de lado (0) o en reversa (-1)
      const forwardDot = (this.velocity.x * cosH + this.velocity.y * sinH) / speed;

      // Interpolar el límite de velocidad: transiciones suaves si hace strafe y reversa a la vez
      const t = (forwardDot + 1) / 2; // Normalizar de [-1, 1] a [0, 1]
      const speedMul = modifiers.speedMul ?? 1;
      const currentMaxSpeed = (this.config.maxReverseSpeed + t * (this.config.maxLinearSpeed - this.config.maxReverseSpeed)) * speedMul;

      if (speed > currentMaxSpeed) {
        const k = currentMaxSpeed / speed;
        this.velocity.x *= k;
        this.velocity.y *= k;
      }
    }

    // ==========================================
    // 6. MICRO-DRIFT KILL (Epsilon)
    // ==========================================
    if (Math.abs(this.velocity.x) < this.config.stopEpsilon) this.velocity.x = 0;
    if (Math.abs(this.velocity.y) < this.config.stopEpsilon) this.velocity.y = 0;
    if (Math.abs(this.angularVelocity) < this.config.stopEpsilon) this.angularVelocity = 0;

    // ==========================================
    // 7. INTEGRACIÓN FINAL
    // ==========================================
    this.position.x += this.velocity.x * safeDt;
    this.position.y += this.velocity.y * safeDt;
    this.heading = normalizeAngle(this.heading + this.angularVelocity * safeDt);
  }
}