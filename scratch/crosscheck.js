"use strict";

// Cross-validate DSP render against AudioParamUtils.computeValueAtTime
// sample-by-sample for many timeline shapes.
const AudioContext = require("../src/impl/AudioContext");
const AudioParam = require("../src/impl/AudioParam");
const AudioParamUtils = require("../src/utils/AudioParamUtils");
const { CONTROL_RATE } = require("../src/constants/AudioParamRate");

const sampleRate = 8000;
const blockSize = 16;

function render(param, context, seconds) {
  const total = Math.round(seconds * sampleRate);
  const out = new Float32Array(total);

  for (let i = 0; i < total / blockSize; i++) {
    context.currentSampleFrame = i * blockSize;
    param.dspProcess();
    out.set(param.getSampleAccurateValues(), i * blockSize);
  }

  return out;
}

let failures = 0;
function crossCheck(name, setup, seconds, userValue = 0) {
  const context = new AudioContext({ sampleRate, blockSize });
  const param = new AudioParam(context, { rate: CONTROL_RATE, defaultValue: 0 });
  param.setValue(userValue);
  setup(param);

  const out = render(param, context, seconds);
  const timeline = param.getTimeline();
  let maxErr = 0;
  let worst = null;

  for (let f = 0; f < out.length; f++) {
    const t = f / sampleRate;
    const expected = AudioParamUtils.computeValueAtTime(timeline, t, param._userValue);
    const err = Math.abs(out[f] - expected);
    if (err > maxErr) {
      maxErr = err;
      worst = { f, t, actual: out[f], expected };
    }
  }

  const ok = maxErr < 1e-3;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (maxErr=${maxErr.toExponential(2)}${worst && !ok ? ` at t=${worst.t} actual=${worst.actual} expected=${worst.expected}` : ""})`);
}

// 1. linear ramp then later setValue (the reported hold bug)
crossCheck("linear ramp -> gap -> setValue", (p) => {
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, 0.1);
  p.setValueAtTime(0.25, 0.5);
}, 0.6);

// 2. exponential ramp then later setValue
crossCheck("exp ramp -> gap -> setValue", (p) => {
  p.setValueAtTime(0.01, 0);
  p.exponentialRampToValueAtTime(1, 0.1);
  p.setValueAtTime(0.25, 0.5);
}, 0.6);

// 3. curve then later setValue
crossCheck("curve -> gap -> setValue", (p) => {
  p.setValueCurveAtTime(new Float32Array([0, 0.5, 1]), 0, 0.1);
  p.setValueAtTime(0.25, 0.5);
}, 0.6);

// 4. first event linear ramp from .value
crossCheck("first linear ramp from .value", (p) => {
  p.linearRampToValueAtTime(1, 1);
}, 1.05);

// 5. first event exponential ramp from .value=0.01
crossCheck("first exp ramp from .value", (p) => {
  p.exponentialRampToValueAtTime(1, 0.1);
}, 0.15, 0.01);

// 6. back-to-back ramps (no gap)
crossCheck("back-to-back ramps", (p) => {
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, 0.2);
  p.linearRampToValueAtTime(0.5, 0.4);
  p.linearRampToValueAtTime(0.9, 0.6);
}, 0.7);

// 7. setValue chain
crossCheck("setValue chain with gaps", (p) => {
  p.setValueAtTime(0.2, 0);
  p.setValueAtTime(0.4, 0.2);
  p.setValueAtTime(0.8, 0.5);
}, 0.6);

// 8. setTarget with gap after ramp
crossCheck("ramp -> gap -> setTarget", (p) => {
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, 0.1);
  p.setTargetAtTime(0.2, 0.4, 0.05);
}, 0.6);

// 9. W3C-style compound timeline
crossCheck("compound timeline", (p) => {
  const curve = new Float32Array(64).map((_, i) => Math.sin(Math.PI * i / 64));
  p.setValueAtTime(0.2, 0);
  p.setValueAtTime(0.3, 0.1);
  p.linearRampToValueAtTime(1, 0.2);
  p.setTargetAtTime(0.5, 0.25, 0.05);
  p.setValueAtTime(0.55, 0.4);
  p.exponentialRampToValueAtTime(0.05, 0.5);
  p.setValueCurveAtTime(curve, 0.55, 0.15);
}, 0.8);

// 10. curve -> gap -> ramp
crossCheck("curve -> gap -> ramp", (p) => {
  p.setValueCurveAtTime(new Float32Array([0.1, 0.9, 0.4]), 0, 0.1);
  p.linearRampToValueAtTime(1, 0.5);
}, 0.6);

// 11. first event is a setValue, then gap, then ramp
crossCheck("setValue -> gap -> ramp", (p) => {
  p.setValueAtTime(0.3, 0.05);
  p.linearRampToValueAtTime(0.9, 0.4);
}, 0.5);

// 12. events starting mid-quantum with non-aligned frames
crossCheck("unaligned event frames", (p) => {
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, 0.037);
  p.setValueAtTime(0.2, 0.091);
}, 0.12);

console.log(failures === 0 ? "\nALL CROSS-CHECKS PASS" : `\n${failures} CROSS-CHECK FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
