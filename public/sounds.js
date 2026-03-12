// === Synthesized Sound Effects (Web Audio API) ===
// No audio files needed — all sounds generated programmatically

const SFX = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Helper: create a gain node with envelope
  function makeGain(audioCtx, volume = 0.3) {
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.connect(audioCtx.destination);
    return gain;
  }

  // Helper: play a tone with options
  function playTone({ freq = 440, type = 'square', duration = 0.1, volume = 0.3, delay = 0, rampTo = null } = {}) {
    const audioCtx = getCtx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
    if (rampTo !== null) {
      osc.frequency.linearRampToValueAtTime(rampTo, audioCtx.currentTime + delay + duration);
    }

    gain.gain.setValueAtTime(volume, audioCtx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(audioCtx.currentTime + delay);
    osc.stop(audioCtx.currentTime + delay + duration);
  }

  // Helper: noise burst (for percussion/swoosh effects)
  function playNoise({ duration = 0.1, volume = 0.15, delay = 0, filterFreq = 3000 } = {}) {
    const audioCtx = getCtx();
    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(filterFreq, audioCtx.currentTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(volume, audioCtx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    source.start(audioCtx.currentTime + delay);
    source.stop(audioCtx.currentTime + delay + duration);
  }

  return {
    // UI click — subtle blip
    click() {
      playTone({ freq: 600, type: 'sine', duration: 0.06, volume: 0.15 });
    },

    // Player joins lobby — friendly pop
    playerJoin() {
      playTone({ freq: 500, type: 'sine', duration: 0.1, volume: 0.2 });
      playTone({ freq: 750, type: 'sine', duration: 0.12, volume: 0.2, delay: 0.08 });
    },

    // Transfer host — soft confirm
    setFacilitator() {
      playTone({ freq: 400, type: 'triangle', duration: 0.1, volume: 0.2 });
      playTone({ freq: 600, type: 'triangle', duration: 0.15, volume: 0.2, delay: 0.1 });
    },

    // Dice roll tick — each slot cycle step
    slotTick() {
      playTone({ freq: 300 + Math.random() * 200, type: 'square', duration: 0.04, volume: 0.1 });
    },

    // Dice lands — dramatic ding
    slotLand() {
      playTone({ freq: 880, type: 'sine', duration: 0.3, volume: 0.3 });
      playTone({ freq: 1320, type: 'sine', duration: 0.4, volume: 0.25, delay: 0.1 });
      playTone({ freq: 1760, type: 'sine', duration: 0.5, volume: 0.2, delay: 0.2 });
      playNoise({ duration: 0.15, volume: 0.1, filterFreq: 5000 });
    },

    // RPS countdown / tension building
    rpsTension() {
      playTone({ freq: 200, type: 'sawtooth', duration: 0.8, volume: 0.08, rampTo: 600 });
    },

    // Player picks RPS choice — lock in
    rpsLock() {
      playTone({ freq: 700, type: 'square', duration: 0.08, volume: 0.2 });
      playTone({ freq: 900, type: 'square', duration: 0.1, volume: 0.15, delay: 0.06 });
    },

    // RPS reveal — dramatic swoosh
    rpsReveal() {
      playNoise({ duration: 0.25, volume: 0.2, filterFreq: 2000 });
      playTone({ freq: 400, type: 'sawtooth', duration: 0.3, volume: 0.15, rampTo: 800 });
    },

    // Tie — buzzer / boing
    tie() {
      playTone({ freq: 300, type: 'sawtooth', duration: 0.25, volume: 0.2 });
      playTone({ freq: 250, type: 'sawtooth', duration: 0.3, volume: 0.15, delay: 0.15 });
      playTone({ freq: 200, type: 'square', duration: 0.35, volume: 0.1, delay: 0.3 });
    },

    // Victory fanfare — winner escapes
    victory() {
      const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        playTone({ freq, type: 'square', duration: 0.2, volume: 0.2, delay: i * 0.12 });
        playTone({ freq, type: 'sine', duration: 0.25, volume: 0.15, delay: i * 0.12 });
      });
      playNoise({ duration: 0.4, volume: 0.1, filterFreq: 4000, delay: 0.5 });
    },

    // Loser — sad descending tones (wah wah wahhh)
    loser() {
      playTone({ freq: 400, type: 'triangle', duration: 0.3, volume: 0.2 });
      playTone({ freq: 350, type: 'triangle', duration: 0.3, volume: 0.18, delay: 0.25 });
      playTone({ freq: 300, type: 'triangle', duration: 0.5, volume: 0.15, delay: 0.5 });
      playTone({ freq: 200, type: 'sawtooth', duration: 0.8, volume: 0.1, delay: 0.75, rampTo: 100 });
    },

    // New round starting
    newRound() {
      playTone({ freq: 440, type: 'sine', duration: 0.1, volume: 0.2 });
      playTone({ freq: 550, type: 'sine', duration: 0.1, volume: 0.2, delay: 0.12 });
      playTone({ freq: 660, type: 'sine', duration: 0.15, volume: 0.2, delay: 0.24 });
    },

    // Confetti / celebration burst
    celebrate() {
      for (let i = 0; i < 6; i++) {
        playTone({
          freq: 600 + Math.random() * 800,
          type: 'sine',
          duration: 0.1 + Math.random() * 0.1,
          volume: 0.08,
          delay: Math.random() * 0.5,
        });
      }
      playNoise({ duration: 0.3, volume: 0.08, filterFreq: 6000, delay: 0.1 });
    },

    // Copy link — subtle confirmation
    copy() {
      playTone({ freq: 1000, type: 'sine', duration: 0.08, volume: 0.12 });
      playTone({ freq: 1400, type: 'sine', duration: 0.1, volume: 0.1, delay: 0.06 });
    },

    // Ensure audio context is unlocked (call on first user interaction)
    unlock() {
      getCtx();
    },
  };
})();
