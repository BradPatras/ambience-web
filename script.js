let oscillator, isPlaying;

// Minor pentatonic scale centered around 60 Hz
const scale = {
	A1: 55.00,         // Root (was B1)
	CSharp2: 69.30,    // Minor third (was D#2/Eb2)
	D2: 73.42,         // Perfect fourth (was E2)
	E2: 82.41,         // Perfect fifth (was F#2/Gb2)
	GSharp2: 103.83    // Minor seventh (was A#2/Bb2)
};

const ac = new AudioContext(),
	frequency = 60,
	gain = 0.25;


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
	source.loop = true;
	return source;
};

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

document.getElementById('toggle-sound').addEventListener('click', function () {
	if (isPlaying) {
		if (oscillator) oscillator.stop();
		if (pinkNoise) pinkNoise.stop();
		isPlaying = false;
	} else {
		isPlaying = true;
		ac.resume();

		// Create gain node
		const gainNode = new GainNode(ac, { gain });

		// Create and start oscillator
		oscillator = new OscillatorNode(ac, {
			type: 'sine',
			frequency: scale.A1
		});
		oscillator.connect(gainNode);

		// Create and start pink noise
		const pinkNoiseGain = new GainNode(ac, { gain: 0.1 });

		pinkNoise = ac.createPinkNoise();
		pinkNoise.connect(pinkNoiseGain);
		pinkNoiseGain.connect(gainNode);

		// Connect gain node to destination
		gainNode.connect(ac.destination);

		oscillator.start();
		pinkNoise.start();
	}
});