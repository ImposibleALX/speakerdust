export let audioCtx: AudioContext | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let cachedNoiseBuffer: AudioBuffer | null = null;

export type AudioEvent =
    | { type: "weapon"; weapon: string }
    | { type: "impact"; strong: boolean }
    | { type: "explosion" }
    | { type: "objective" }
    | { type: "tone"; freq: number; duration: number; oscType: OscillatorType; gain: number; sweepTo: number | null }
    | { type: "haptic"; duration?: number; intensity?: number };

const audioQueue: AudioEvent[] = [];

function flushAudioQueue(): void {
    while (audioQueue.length) {
        const evt = audioQueue.shift()!;
        switch (evt.type) {
            case "weapon": playWeaponSound(evt.weapon); break;
            case "impact": playImpactSound(evt.strong); break;
            case "explosion": playExplosionSound(); break;
            case "objective": playObjectiveSound(); break;
            case "tone": playTone(evt.freq, evt.duration, evt.oscType, evt.gain, evt.sweepTo); break;
            case "haptic": triggerHaptic(evt.duration, evt.intensity); break;
        }
    }
}

export function enqueueAudio(event: AudioEvent): void {
    audioQueue.push(event);
}

export function updateAudio(nearDreadnought: boolean): void {
    if (nearDreadnought && Math.random() < 0.1) playTone(40, 0.1, "sine", 0.02, 35);
    flushAudioQueue();
}

function getNoiseBuffer(ctxAudio: AudioContext): AudioBuffer {
    if (cachedNoiseBuffer) return cachedNoiseBuffer;
    const length = ctxAudio.sampleRate * 2;
    const buffer = ctxAudio.createBuffer(1, length, ctxAudio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    cachedNoiseBuffer = buffer;
    return buffer;
}

export function ensureAudio(): AudioContext | null {
    if (!audioCtx) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return null;
        audioCtx = new Ctor();
        masterCompressor = audioCtx.createDynamicsCompressor();
        // Ajustes de compresión master para "pegar" mejor los sonidos sin ahogarlos
        masterCompressor.threshold.setValueAtTime(-16, audioCtx.currentTime);
        masterCompressor.knee.setValueAtTime(5, audioCtx.currentTime);
        masterCompressor.ratio.setValueAtTime(8, audioCtx.currentTime);
        masterCompressor.attack.setValueAtTime(0.002, audioCtx.currentTime);
        masterCompressor.release.setValueAtTime(0.15, audioCtx.currentTime);
        masterCompressor.connect(audioCtx.destination);
        cachedNoiseBuffer = null;
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => { });
    return audioCtx;
}

export function triggerHaptic(duration = 50, intensity = 0.5): void {
    try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
            if (gp && gp.vibrationActuator) {
                (gp.vibrationActuator as any).playEffect("dual-rumble", {
                    duration,
                    strongMagnitude: intensity,
                    weakMagnitude: intensity * 0.5,
                }).catch(() => { });
            }
        }
    } catch (_) { }
    if (audioCtx && audioCtx.state === "running" && navigator.vibrate) {
        try { navigator.vibrate(duration); } catch (_) { }
    }
}

export function playTone(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.06, sweepTo: number | null = null): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const osc = ctxAudio.createOscillator();
    const amp = ctxAudio.createGain();
    osc.type = type;
    const now = ctxAudio.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (sweepTo !== null) {
        // Envolvente de pitch exponencial (vital para SFX de impacto)
        osc.frequency.exponentialRampToValueAtTime(Math.max(10, sweepTo), now + duration);
    }
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.002); // Attack
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration); // Decay exponencial suena más natural
    osc.connect(amp);
    amp.connect(masterCompressor);
    osc.start(now);
    osc.stop(now + duration);
}

// Añadimos sweepToFreq para emular la pérdida acústica de energía
export function playNoise(duration: number, gain = 0.06, filterType: BiquadFilterType = "bandpass", freq = 520, Q = 1, sweepToFreq: number | null = null): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const source = ctxAudio.createBufferSource();
    const amp = ctxAudio.createGain();
    const filter = ctxAudio.createBiquadFilter();

    filter.type = filterType;
    const now = ctxAudio.currentTime;
    filter.frequency.setValueAtTime(freq, now);
    if (sweepToFreq !== null) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(10, sweepToFreq), now + duration);
    }
    filter.Q.value = Q;
    source.buffer = getNoiseBuffer(ctxAudio);

    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(amp);
    amp.connect(masterCompressor);
    source.start(now);
    source.stop(now + duration);
}

function playFM(freq: number, modFreq: number, modIndex: number, duration: number, type: OscillatorType = "square", gain = 0.035, sweepTo: number | null = null): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const carrier = ctxAudio.createOscillator();
    const modulator = ctxAudio.createOscillator();
    const modGain = ctxAudio.createGain();
    const amp = ctxAudio.createGain();
    const now = ctxAudio.currentTime;

    carrier.type = type;
    carrier.frequency.setValueAtTime(freq, now);
    if (sweepTo !== null) {
        carrier.frequency.exponentialRampToValueAtTime(Math.max(10, sweepTo), now + duration);
    }

    // SFX Theory: Barrido también en la modulación para que el timbre evolucione
    modulator.frequency.setValueAtTime(modFreq, now);
    modulator.frequency.exponentialRampToValueAtTime(Math.max(10, modFreq * 0.1), now + duration);
    modGain.gain.setValueAtTime(modIndex, now);
    modGain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(amp);
    amp.connect(masterCompressor);

    modulator.start(now);
    carrier.start(now);
    carrier.stop(now + duration);
    modulator.stop(now + duration);
}

// Mejora: Añadimos transitorio de Pitch en el kick para mayor "Punch" (Estilo 808/Arma)
function playKickSound(freq = 120, duration = 0.5, gain = 0.04): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const now = ctxAudio.currentTime;

    const osc = ctxAudio.createOscillator();
    const amp = ctxAudio.createGain();
    osc.type = "sine"; // Usamos sine pura pero con un ataque de pitch muy agresivo

    // Transitorio de "Punch": Cae extremadamente rápido de agudo a grave en 0.03s
    osc.frequency.setValueAtTime(freq * 3, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.03);
    osc.frequency.exponentialRampToValueAtTime(20, now + duration);

    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(amp);
    amp.connect(masterCompressor);

    osc.start(now);
    osc.stop(now + duration);
}

export function playWeaponSound(weapon: string): void {
    switch (weapon) {
        case "pdc":
        case "autocannon":
            // PDC MEJORADO: Corto, chasquido metálico, estricto control dinámico para evitar "ruido de masa" al disparar en ráfaga.
            // 1. Transitorio inicial ("Click" del percutor mecánico)
            playTone(1200, 0.03, "square", 0.015, 200);
            // 2. Ruido de gas expulsado (Cae de agudo a medio rápidamente)
            playNoise(0.05, 0.02, "bandpass", 4000, 1.5, 1000);
            // 3. Mini "Kick" para dar un ligero empuje que no embarre los graves
            playKickSound(180, 0.04, 0.02);
            break;

        case "naval_cannon":
            // Artillería pesada: Caída de frecuencia grave + explosión de aire
            playKickSound(120, 0.8, 0.07);
            playNoise(0.6, 0.05, "lowpass", 600, 1, 100); // El ruido se oscurece al decaer
            playTone(80, 0.4, "triangle", 0.04, 30);
            break;

        case "railgun":
            // Latigazo supersónico electromagnético
            playTone(800, 0.05, "sawtooth", 0.03, 3000); // "Carga" ultrarrápida (hacia arriba)
            playNoise(0.2, 0.04, "highpass", 2500, 1, 500); // Crujido supersónico (crack)
            playKickSound(250, 0.2, 0.04);
            break;

        case "plasma_broadside":
            // Energía disipándose, láser ionizado clásico de SCI-FI
            playFM(1500, 400, 1000, 0.35, "sine", 0.025, 150); // Caída pronunciada y limpia
            playNoise(0.25, 0.015, "bandpass", 2000, 3, 500);
            break;

        case "torpedo":
            // Subacuático, sonido burbujeante de cavitación y lanzamiento ahogado
            playKickSound(60, 0.6, 0.05);
            playNoise(0.7, 0.03, "lowpass", 300, 2, 50);
            playFM(100, 20, 50, 0.9, "triangle", 0.03, 40);
            break;

        case "guided_missile":
            // Ignición inicial rápida seguida del siseo del propulsor alejándose
            playKickSound(200, 0.08, 0.03); // Pop de salida
            playNoise(0.7, 0.035, "bandpass", 1500, 1.2, 300); // Propulsor alejándose (barrido grave)
            playTone(300, 0.6, "sawtooth", 0.015, 60); // Resonancia del motor
            break;

        default:
            playFM(880, 280, 240, 0.05, "square", 0.035, 1600);
    }
}

export function playImpactSound(strong = false): void {
    if (strong) {
        // Impacto estructural: transitorio alto seguido de retumbo profundo
        playNoise(0.5, 0.04, "lowpass", 1000, 1, 200);
        playKickSound(90, 0.4, 0.06);
        playFM(200, 50, 100, 0.3, "sawtooth", 0.02, 40); // Crujido del metal
    } else {
        // Rebote o desvío de blindaje (Ricochet)
        playNoise(0.15, 0.03, "highpass", 4000, 2, 800);
        playTone(1800, 0.15, "triangle", 0.025, 400); // El famoso "piiiing"
        playKickSound(400, 0.06, 0.015);
    }
}

export function playExplosionSound(): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const now = ctxAudio.currentTime;

    // 1. Transitorio (El "Snap" inicial agudo)
    playNoise(0.1, 0.05, "highpass", 2000, 1, 800);

    // 2. Cuerpo de la explosión (Ruido de paso bajo que pierde energía)
    const source = ctxAudio.createBufferSource();
    const amp = ctxAudio.createGain();
    const filter = ctxAudio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3500, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + 0.6); // Barrido clásico de explosión acústica
    filter.Q.value = 1.2;

    source.buffer = getNoiseBuffer(ctxAudio);
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(0.18, now + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.7); // Caída natural no lineal

    source.connect(filter);
    filter.connect(amp);
    amp.connect(masterCompressor);
    source.start(now);
    source.stop(now + 0.7);

    // 3. Sub-Rumble Caótico (Modulación de Amplitud para simular el retumbe orgánico)
    const osc = ctxAudio.createOscillator();
    const ampRumble = ctxAudio.createGain();
    const lfo = ctxAudio.createOscillator(); // Genera vibración (tremolo) en el sub-grave
    const lfoGain = ctxAudio.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.8); // Caída pesada

    ampRumble.gain.setValueAtTime(0, now);
    ampRumble.gain.linearRampToValueAtTime(0.08, now + 0.05); // Tarda un poquito en alcanzar su pico
    ampRumble.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(15, now); // Retumba a 15 hz
    lfo.frequency.exponentialRampToValueAtTime(5, now + 0.8); // El retumbe se hace más lento al disiparse

    lfoGain.gain.value = 1;

    // LFO controla la amplitud
    lfo.connect(ampRumble.gain);
    osc.connect(ampRumble);
    ampRumble.connect(masterCompressor);

    lfo.start(now);
    osc.start(now);
    osc.stop(now + 0.8);
    lfo.stop(now + 0.8);
}

export function playObjectiveSound(): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const now = ctxAudio.currentTime;

    const lfo = ctxAudio.createOscillator();
    const lfoGain = ctxAudio.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 12;
    lfoGain.gain.value = 0.015;

    const osc1 = ctxAudio.createOscillator();
    const amp1 = ctxAudio.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(660, now);
    osc1.frequency.linearRampToValueAtTime(880, now + 0.06);
    amp1.gain.setValueAtTime(0, now);
    amp1.gain.linearRampToValueAtTime(0.03, now + 0.005);
    amp1.gain.setValueAtTime(0.03, now + 0.06);
    amp1.gain.linearRampToValueAtTime(0.0001, now + 0.08);
    lfo.connect(lfoGain);
    lfoGain.connect(amp1.gain);
    osc1.connect(amp1);
    amp1.connect(masterCompressor);
    lfo.start(now);
    osc1.start(now);
    osc1.stop(now + 0.08);

    const osc2 = ctxAudio.createOscillator();
    const amp2 = ctxAudio.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(990, now + 0.06);
    osc2.frequency.linearRampToValueAtTime(1320, now + 0.12);
    amp2.gain.setValueAtTime(0, now + 0.06);
    amp2.gain.linearRampToValueAtTime(0.03, now + 0.065);
    amp2.gain.setValueAtTime(0.03, now + 0.13);
    amp2.gain.linearRampToValueAtTime(0.0001, now + 0.16);
    const lfo2 = ctxAudio.createOscillator();
    const lfoGain2 = ctxAudio.createGain();
    lfo2.type = "sine";
    lfo2.frequency.value = 16;
    lfoGain2.gain.value = 0.015;
    lfo2.connect(lfoGain2);
    lfoGain2.connect(amp2.gain);
    osc2.connect(amp2);
    amp2.connect(masterCompressor);
    lfo2.start(now + 0.06);
    osc2.start(now + 0.06);
    osc2.stop(now + 0.06 + 0.1);
    lfo.stop(now + 0.08);
    lfo2.stop(now + 0.16);
}

if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) audioCtx?.suspend().catch(() => { });
        else audioCtx?.resume().catch(() => { });
    });
    const init = () => { ensureAudio(); cleanup(); };
    window.addEventListener("click", init, { once: true });
    window.addEventListener("keydown", init, { once: true });
    function cleanup() {
        window.removeEventListener("click", init);
        window.removeEventListener("keydown", init);
    }
}