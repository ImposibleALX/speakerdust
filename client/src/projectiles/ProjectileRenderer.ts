// SO: Clase base abstracta para renderizar proyectiles con POO
// R: https://stackoverflow.com/questions/6944961/abstract-base-class-for-game-projectile
//    Cada proyectil define SU PROPIA lógica de render. No más switch() gigante.
//    CodeSpriteProjectile = dibujo procedural (círculos, rects, glow).
//    MatrixSpriteProjectile = sprite basado en matriz de píxeles (bitmap).

export interface BulletData {
  x: number;
  y: number;
  angle?: number;
  vx: number;
  vy: number;
  kind: string;
}

export abstract class ProjectileRenderer {
  abstract render(
    ctx: CanvasRenderingContext2D,
    bullet: BulletData,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
    margin: number,
  ): void;

  protected isOnScreen(bullet: BulletData, cameraX: number, cameraY: number, viewW: number, viewH: number, margin: number): boolean {
    return !(
      bullet.x < cameraX - margin ||
      bullet.y < cameraY - margin ||
      bullet.x > cameraX + viewW + margin ||
      bullet.y > cameraY + viewH + margin
    );
  }
}
