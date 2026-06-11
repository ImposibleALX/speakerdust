export let audioCtx: AudioContext | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let cachedNoiseBuffer: AudioBuffer | null = null;

type AudioEvent =
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
        masterCompressor.threshold.setValueAtTime(-14, audioCtx.currentTime);
        masterCompressor.knee.setValueAtTime(0, audioCtx.currentTime);
        masterCompressor.ratio.setValueAtTime(12, audioCtx.currentTime);
        masterCompressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
        masterCompressor.release.setValueAtTime(0.1, audioCtx.currentTime);
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
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), now + duration);
    }
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.002);
    const releaseStart = now + duration - 0.004;
    amp.gain.setValueAtTime(gain, releaseStart);
    amp.gain.linearRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp);
    amp.connect(masterCompressor);
    osc.start(now);
    osc.stop(now + duration);
}

export function playNoise(duration: number, gain = 0.06, filterType: BiquadFilterType = "bandpass", freq = 520, Q = 1): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const source = ctxAudio.createBufferSource();
    const amp = ctxAudio.createGain();
    const filter = ctxAudio.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = Q;
    source.buffer = getNoiseBuffer(ctxAudio);
    const now = ctxAudio.currentTime;
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
        carrier.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), now + duration);
    }
    modulator.frequency.value = modFreq;
    modGain.gain.value = modIndex;

    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.002);
    const releaseStart = now + duration - 0.004;
    amp.gain.setValueAtTime(gain, releaseStart);
    amp.gain.linearRampToValueAtTime(0.0001, now + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(amp);
    amp.connect(masterCompressor);

    modulator.start(now);
    carrier.start(now);
    carrier.stop(now + duration);
    modulator.stop(now + duration);
}

function playLaserSound(gain = 0.03, duration = 0.05, baseFreq = 40): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const now = ctxAudio.currentTime;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const bandpass = ctxAudio.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 10000;
    const highpass = ctxAudio.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 7000;
    const masterGain = ctxAudio.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(gain, now + 0.001);
    const releaseStart = now + duration - 0.004;
    masterGain.gain.setValueAtTime(gain, releaseStart);
    masterGain.gain.linearRampToValueAtTime(0.0001, now + duration);
    masterGain.connect(masterCompressor);

    for (const ratio of ratios) {
        const osc = ctxAudio.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(baseFreq * ratio, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * ratio * 1.5, now + duration);
        osc.connect(bandpass);
        osc.start(now);
        osc.stop(now + duration);
    }
    bandpass.connect(highpass);
    highpass.connect(masterGain);
}

function playKickSound(freq = 120, duration = 0.5, gain = 0.04): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const now = ctxAudio.currentTime;

    const osc1 = ctxAudio.createOscillator();
    const osc2 = ctxAudio.createOscillator();
    const g1 = ctxAudio.createGain();
    const g2 = ctxAudio.createGain();
    const master = ctxAudio.createGain();

    osc1.type = "triangle";
    osc2.type = "sine";

    osc1.frequency.setValueAtTime(freq, now);
    osc1.frequency.exponentialRampToValueAtTime(20, now + duration);
    osc2.frequency.setValueAtTime(freq * 0.4, now);
    osc2.frequency.exponentialRampToValueAtTime(10, now + duration);

    g1.gain.setValueAtTime(0, now);
    g1.gain.linearRampToValueAtTime(gain, now + 0.002);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(gain * 0.7, now + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    master.gain.setValueAtTime(gain, now);

    osc1.connect(g1);
    osc2.connect(g2);
    g1.connect(master);
    g2.connect(master);
    master.connect(masterCompressor);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
}

export function playWeaponSound(weapon: string): void {
    switch (weapon) {
        case "naval_cannon":
            playFM(880, 280, 240, 0.05, "square", 0.035, 1600);
            playNoise(0.04, 0.025, "lowpass", 4000, 2);
            playKickSound(200, 0.04, 0.02);
            break;
        case "railgun":
            playFM(1400, 380, 400, 0.06, "sawtooth", 0.03, 2200);
            playNoise(0.03, 0.04, "lowpass", 6000, 3);
            playLaserSound(0.015, 0.03, 80);
            break;
        case "plasma_broadside":
            playFM(620, 150, 120, 0.04, "sawtooth", 0.025, 900);
            playTone(820, 0.04, "triangle", 0.02, 1200);
            playNoise(0.015, 0.015, "bandpass", 3200, 4);
            playLaserSound(0.01, 0.02, 60);
            break;
        case "autocannon":
            playFM(550, 200, 180, 0.035, "square", 0.03, 1100);
            playTone(700, 0.03, "triangle", 0.02, 900);
            playNoise(0.02, 0.02, "highpass", 3000, 2);
            break;
        case "torpedo":
            playFM(140, 30, 60, 0.18, "sawtooth", 0.04, 60);
            playTone(70, 0.2, "triangle", 0.03, 35);
            playNoise(0.1, 0.03, "lowpass", 400, 2);
            break;
        case "guided_missile":
            playFM(180, 40, 80, 0.15, "sawtooth", 0.035, 80);
            playTone(90, 0.18, "triangle", 0.025, 50);
            playNoise(0.08, 0.025, "lowpass", 500, 3);
            break;
        default:
            playFM(880, 280, 240, 0.05, "square", 0.035, 1600);
    }
}

export function playImpactSound(strong = false): void {
    if (strong) {
        playNoise(0.06, 0.04, "lowpass", 800, 2);
        playKickSound(260, 0.12, 0.03);
        playFM(260, 80, 120, 0.06, "square", 0.025, 100);
    } else {
        playNoise(0.04, 0.018, "bandpass", 1200, 3);
        playKickSound(420, 0.06, 0.015);
        playTone(420, 0.03, "square", 0.012, 260);
    }
}

export function playExplosionSound(): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const now = ctxAudio.currentTime;

    const source = ctxAudio.createBufferSource();
    const amp = ctxAudio.createGain();
    const filter = ctxAudio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3000, now);
    filter.frequency.exponentialRampToValueAtTime(60, now + 0.45);
    filter.Q.value = 1.5;
    source.buffer = getNoiseBuffer(ctxAudio);
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(0.2, now + 0.005);
    amp.gain.setValueAtTime(0.2, now + 0.03);
    amp.gain.linearRampToValueAtTime(0.15, now + 0.06);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(masterCompressor);
    source.start(now);
    source.stop(now + 0.5);

    const source2 = ctxAudio.createBufferSource();
    const amp2 = ctxAudio.createGain();
    const filter2 = ctxAudio.createBiquadFilter();
    filter2.type = "highpass";
    filter2.frequency.setValueAtTime(4000, now);
    filter2.frequency.exponentialRampToValueAtTime(200, now + 0.2);
    filter2.Q.value = 2;
    source2.buffer = getNoiseBuffer(ctxAudio);
    amp2.gain.setValueAtTime(0, now);
    amp2.gain.linearRampToValueAtTime(0.06, now + 0.002);
    amp2.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    source2.connect(filter2);
    filter2.connect(amp2);
    amp2.connect(masterCompressor);
    source2.start(now);
    source2.stop(now + 0.2);

    const osc = ctxAudio.createOscillator();
    const amp3 = ctxAudio.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(72, now);
    osc.frequency.exponentialRampToValueAtTime(18, now + 0.4);
    amp3.gain.setValueAtTime(0, now);
    amp3.gain.linearRampToValueAtTime(0.04, now + 0.003);
    amp3.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(amp3);
    amp3.connect(masterCompressor);
    osc.start(now);
    osc.stop(now + 0.45);
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
        if (document.hidden) audioCtx?.suspend().catch(() => {});
        else audioCtx?.resume().catch(() => {});
    });
    const init = () => { ensureAudio(); cleanup(); };
    window.addEventListener("click", init, { once: true });
    window.addEventListener("keydown", init, { once: true });
    function cleanup() {
        window.removeEventListener("click", init);
        window.removeEventListener("keydown", init);
    }
}
