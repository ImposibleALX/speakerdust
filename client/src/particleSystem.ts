export interface Particle {
    x: number; y: number; vx: number; vy: number;
    sz: number; color: string; life: number; maxLife: number;
}
export let particles: Particle[] = [];

export function explode(x: number, y: number, colors: string[], n: number, spd = 4.5, scale = 1): void {
    const effectiveN = Math.round(n * scale);
    const effectiveSpd = spd * scale;
    for (let i = 0; i < effectiveN; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * effectiveSpd + 0.8;
        particles.push({
            x, y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            sz: Math.floor(Math.random() * 5 + 2),
            color: colors[Math.floor(Math.random() * colors.length)] ?? "#fff",
            life: 30 + Math.random() * 15, maxLife: 45,
        });
    }
}

export function tickParticles(): void {
    let write = 0;
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!;
        if (p.life <= 0) continue;
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.91; p.vy *= 0.91;
        p.life--;
        particles[write++] = p;
    }
    particles.length = write;
}

export function drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of particles) {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        const s = Math.max(1, Math.ceil(p.sz * (p.life / p.maxLife)));
        ctx.fillRect(p.x, p.y, s, s);
    }
    ctx.globalAlpha = 1;
}

export function clearParticles(): void {
    particles = [];
}
