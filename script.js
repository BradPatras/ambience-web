let oscillator, isPlaying;
// LFO (low-frequency oscillator) used to modulate pitch
let lfoOsc = null;
let lfoGain = null;

// The `scale` object maps human-readable note names to their frequencies
// (in Hz). Using named properties makes it easy to pick a pitch for the
// oscillator without memorizing numeric values. These frequencies are
// standard pitch values (equal-tempered tuning).
const scale = {
	// Lowered root for a deep bass feel. A1 is ~55 Hz.
	A1: 34.00,
	// Other scale degrees used for musical intervals.
	CSharp2: 69.30,
	D2: 73.42,
	E2: 82.41,
	GSharp2: 103.83
};

// Create a single AudioContext used for all nodes. Most browsers require
// that this is created/resumed in response to user interaction (we call
// ac.resume() when the button is clicked).
const ac = new AudioContext();

// Default UI parameters. `frequency` is a fallback reference; the
// oscillator below uses the `scale` values. `gain` controls the master
// volume for the combined oscillator + noise mix.
const frequency = 60;
const gain = 0.25;

// Top-level master gain node. We'll create it lazily so the slider can
// adjust it before or after playback begins.
let masterGainNode = null;

// Get new control sliders
const lfoRateSlider = document.getElementById('lfo-rate');
const lfoDepthSlider = document.getElementById('lfo-depth');
const pinkNoiseGainSlider = document.getElementById('pink-noise-gain');

// Expose pinkNoiseGain so the slider can update it even before playback
let pinkNoiseGainNode = null;

// Attach listeners (update in real-time if nodes exist)
if (lfoRateSlider) {
	lfoRateSlider.value = 0.2;
	lfoRateSlider.addEventListener('input', (e) => {
		const v = parseFloat(e.target.value);
		if (lfoOsc) lfoOsc.frequency.setValueAtTime(v, ac.currentTime);
	});
}

if (lfoDepthSlider) {
	lfoDepthSlider.value = 0.1;
	lfoDepthSlider.addEventListener('input', (e) => {
		const v = parseFloat(e.target.value);
		if (lfoGain) lfoGain.gain.setValueAtTime(v, ac.currentTime);
	});
}

if (pinkNoiseGainSlider) {
	pinkNoiseGainSlider.value = 0.1;
	pinkNoiseGainSlider.addEventListener('input', (e) => {
		const v = parseFloat(e.target.value);
		if (pinkNoiseGainNode) pinkNoiseGainNode.gain.setValueAtTime(v, ac.currentTime);
	});
}


// createWhiteNoise(durationSeconds)
// Helper that creates a looping AudioBufferSourceNode containing white
// noise. We use a buffer because ScriptProcessorNode is deprecated and
// AudioWorklet is heavier to introduce for a simple buffer-based noise.
// The returned source is not started; caller should call start() and
// connect it to the audio graph.
AudioContext.prototype.createWhiteNoise = function (durationSeconds = 1) {
	const sampleRate = this.sampleRate;
	const frameCount = sampleRate * durationSeconds;
	const buffer = this.createBuffer(1, frameCount, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < frameCount; i++) {
		data[i] = Math.random() * 2 - 1;
	}
	const source = this.createBufferSource();
	source.buffer = buffer;
	source.loop = true; // loop the buffer for continuous noise
	return source;
};

// createPinkNoise(durationSeconds)
// Generates a pink noise buffer using the Voss-McCartney-like filtering
// algorithm (implemented as a series of recursive filters). Returning an
// AudioBufferSourceNode allows the buffer to loop just like the white noise.
AudioContext.prototype.createPinkNoise = function (durationSeconds = 5) {
	const sampleRate = this.sampleRate;
	const frameCount = sampleRate * durationSeconds;
	const buffer = this.createBuffer(1, frameCount, sampleRate);
	const data = buffer.getChannelData(0);
	let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
	for (let i = 0; i < frameCount; i++) {
		const white = Math.random() * 2 - 1;
		b0 = 0.99886 * b0 + white * 0.0555179;
		b1 = 0.99332 * b1 + white * 0.0750759;
		b2 = 0.96900 * b2 + white * 0.1538520;
		b3 = 0.86650 * b3 + white * 0.3104856;
		b4 = 0.55000 * b4 + white * 0.5329522;
		b5 = -0.7616 * b5 - white * 0.0168980;
		data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
		b6 = white * 0.115926;
	}
	const source = this.createBufferSource();
	source.buffer = buffer;
	source.loop = true;
	return source;
};


// Toggle button handler
// The button toggles playback of a sine oscillator and a pink noise source.
// We assemble a small audio graph:
//   oscillator -> gainNode -> destination
//   pinkNoise  -> pinkNoiseGain -> gainNode
// This lets us control the noise level independently (pinkNoiseGain) while
// adjusting the master mix with `gainNode`.
document.getElementById('toggle-sound').addEventListener('click', function () {
	if (isPlaying) {
		// Stop running sources. Note: stopping a BufferSource prevents
		// it from being reusable; to restart, create a new source.
		if (oscillator) oscillator.stop();
		// stop and disconnect LFO
		if (lfoOsc) {
			try { lfoOsc.stop(); } catch (e) { }
			lfoOsc.disconnect();
			lfoOsc = null;
		}
		if (lfoGain) {
			lfoGain.disconnect();
			lfoGain = null;
		}
		if (pinkNoise) pinkNoise.stop();
		isPlaying = false;
	} else {
		// Start/resume audio in response to user interaction
		isPlaying = true;
		ac.resume();

		// Master gain for the combined mix. Create lazily so UI can
		// manipulate the node even before audio starts.
		masterGainNode = masterGainNode || new GainNode(ac, { gain });
		const gainNode = masterGainNode;

		// Oscillator: a simple sine wave at the chosen scale degree
		oscillator = new OscillatorNode(ac, {
			type: 'sine',
			frequency: scale.A1
		});
		// OLD: pitch-modulation LFO (kept commented for comparison)
		/*
		// Create a gentle LFO to modulate pitch +/- a few Hz
		const lfoRate = 0.2; // Hz (slow rise/fall)
		const lfoDepth = 7; // Hz (depth of pitch modulation)
		lfoOsc = new OscillatorNode(ac, { type: 'sine', frequency: lfoRate });
		lfoGain = new GainNode(ac, { gain: lfoDepth });
		// Connect LFO -> LFO Gain -> oscillator.frequency
		lfoOsc.connect(lfoGain);
		lfoGain.connect(oscillator.frequency);
		lfoOsc.start();
		*/

		// Create a gentle LFO to modulate master gain (volume) up/down
		// instead of pitch. We use a small depth (0.05 - 0.15) so the
		// gain never goes negative. The LFO output (in range -1..1)
		// multiplied by depth is added to the master gain AudioParam.
		// Read initial LFO settings from sliders (if present) so the
		// UI matches the runtime behavior.
		const lfoRate = lfoRateSlider ? parseFloat(lfoRateSlider.value) : 0.2; // Hz
		const lfoDepth = lfoDepthSlider ? parseFloat(lfoDepthSlider.value) : 0.1; // gain units
		lfoOsc = new OscillatorNode(ac, { type: 'sine', frequency: lfoRate });
		lfoGain = new GainNode(ac, { gain: lfoDepth });
		// Connect LFO -> LFO Gain -> masterGainNode.gain (audio-rate modulation)
		lfoOsc.connect(lfoGain);
		// ensure masterGainNode exists and has a sensible base value
		masterGainNode = masterGainNode || new GainNode(ac, { gain });
		// connect the modulator to the AudioParam
		lfoGain.connect(masterGainNode.gain);
		lfoOsc.start();
		// Connect oscillator to master gain
		oscillator.connect(gainNode);

		// Pink noise is typically less harsh than white noise at the
		// same level. Route pink noise through its own gain node and
		// connect directly to the destination so it is NOT affected by
		// the master LFO modulation applied to `masterGainNode`.
		// Create (or reuse) pinkNoiseGainNode and initialize from slider
		pinkNoiseGainNode = pinkNoiseGainNode || new GainNode(ac, { gain: 0.1 });
		if (pinkNoiseGainSlider) {
			pinkNoiseGainNode.gain.setValueAtTime(parseFloat(pinkNoiseGainSlider.value), ac.currentTime);
		}
		pinkNoise = ac.createPinkNoise();
		pinkNoise.connect(pinkNoiseGainNode);
		// Connect pink noise directly to output (bypassing masterGainNode)
		pinkNoiseGainNode.connect(ac.destination);

		// Master gain to output
		gainNode.connect(ac.destination);

		// Start audio sources. BufferSourceNodes must be started; the
		// oscillator also requires start().
		oscillator.start();
		pinkNoise.start();
	}
});