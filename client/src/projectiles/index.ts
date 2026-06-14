import { ProjectileRenderer, type BulletData } from "./ProjectileRenderer";
import { CodeSpriteProjectile } from "./CodeSpriteProjectile";
import { MatrixSpriteProjectile } from "./MatrixSpriteProjectile";

export { ProjectileRenderer, type BulletData };
export { CodeSpriteProjectile };
export { MatrixSpriteProjectile };

// SO: Factory que elige entre CodeSprite o MatrixSprite según el tipo de proyectil
// R: https://stackoverflow.com/questions/5574241/factory-pattern-for-projectiles
//    Los proyectiles "grandes/complejos" usan CodeSprite (dibujo procedural).
//    Los proyectiles "simples" pueden usar MatrixSprite (pixel art predefinido).
//    Ambos heredan de ProjectileRenderer y se renderizan con la misma interfaz.

const MATRIX_KINDS = new Set(["torpedo", "guided_missile"]);

let codeRenderer: CodeSpriteProjectile | null = null;
let matrixRenderer: MatrixSpriteProjectile | null = null;

export function getProjectileRenderer(kind: string): ProjectileRenderer {
  if (MATRIX_KINDS.has(kind)) {
    if (!matrixRenderer) matrixRenderer = new MatrixSpriteProjectile();
    return matrixRenderer;
  }
  if (!codeRenderer) codeRenderer = new CodeSpriteProjectile();
  return codeRenderer;
}
