"use strict";

// Reproduction for AudioParam timeline bugs.
// Run: node scratch/repro.js
const AudioContext = require("../src/impl/AudioContext");
const GainNode = require("../src/impl/GainNode");
const AudioParamUtils = require("../src/utils/AudioParamUtils");

const sampleRate = 8000;
const blockSize = 16;

function render(param, context, seconds) {
  const total = Math.round(seconds * sampleRate);
  const out = new Float32Array(total);
  const blocks = total / blockSize;

  for (let i = 0; i < blocks; i++) {
    context.currentSampleFrame = i * blockSize;
    param.dspProcess();
    out.set(param.getSampleAccurateValues(), i * blockSize);
  }

  return out;
}

function at(out, t) {
  return out[Math.round(t * sampleRate)];
}

let failures = 0;
function check(name, actual, expected, eps = 1e-3) {
  const ok = Math.abs(actual - expected) <= eps;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: actual=${actual} expected=${expected}`);
}

// ---- Case 1: linear ramp then a later setValueAtTime; hold must keep 1 ----
{
  const context = new AudioContext({ sampleRate, blockSize });
  const gain = new GainNode(context);
  const param = gain.getGain();

  param.setValueAtTime(0, 0);
  param.linearRampToValueAtTime(1, 0.1);
  param.setValueAtTime(0.25, 0.5);

  const out = render(param, context, 0.6);

  check("linear hold @0.05 (ramp middle)", at(out, 0.05), 0.5);
  check("linear hold @0.1 (ramp end)", at(out, 0.1), 1.0);
  check("linear hold @0.3 (hold segment, DSP)", at(out, 0.3), 1.0);
  check("linear hold @0.499 (just before event)", at(out, 0.499), 1.0);
  check("linear hold @0.5 (next event)", at(out, 0.5), 0.25);
  check("linear hold @0.55 (after event)", at(out, 0.55), 0.25);

  const timeline = param.getTimeline();
  check("linear hold @0.3 (repo evaluator)", AudioParamUtils.computeValueAtTime(timeline, 0.3, param._userValue), 1.0);
}

// ---- Case 2: exponential ramp then setValueAtTime; hold must keep endValue ----
{
  const context = new AudioContext({ sampleRate, blockSize });
  const gain = new GainNode(context);
  const param = gain.getGain();

  param.setValueAtTime(0.01, 0);
  param.exponentialRampToValueAtTime(1, 0.1);
  param.setValueAtTime(0.25, 0.5);

  const out = render(param, context, 0.6);

  check("exp hold @0.1 (ramp end)", at(out, 0.1), 1.0, 0.02);
  check("exp hold @0.3 (hold segment, DSP)", at(out, 0.3), 1.0);
  check("exp hold @0.499", at(out, 0.499), 1.0);
  check("exp hold @0.5 (next event)", at(out, 0.5), 0.25);
}

// ---- Case 3: setValueCurve then setValueAtTime; hold must keep curve end ----
{
  const context = new AudioContext({ sampleRate, blockSize });
  const gain = new GainNode(context);
  const param = gain.getGain();
  const curve = new Float32Array([0, 0.5, 1]);

  param.setValueCurveAtTime(curve, 0, 0.1);
  param.setValueAtTime(0.25, 0.5);

  const out = render(param, context, 0.6);

  check("curve hold @0.1 (curve end)", at(out, 0.1), 1.0, 0.02);
  check("curve hold @0.3 (hold segment, DSP)", at(out, 0.3), 1.0);
  check("curve hold @0.499", at(out, 0.499), 1.0);
  check("curve hold @0.5 (next event)", at(out, 0.5), 0.25);
}

// ---- Case 4: first event is a ramp; must start from current .value ----
{
  const context = new AudioContext({ sampleRate, blockSize });
  const gain = new GainNode(context);
  const param = gain.getGain();

  param.setValue(0);
  param.linearRampToValueAtTime(1, 1);

  const out = render(param, context, 1.05);

  check("first-ramp @0 (start from .value=0)", at(out, 0), 0.0);
  check("first-ramp @0.25", at(out, 0.25), 0.25, 0.02);
  check("first-ramp @0.5", at(out, 0.5), 0.5, 0.02);
  check("first-ramp @0.75", at(out, 0.75), 0.75, 0.02);
  check("first-ramp @1 (end)", at(out, 1.0), 1.0, 0.02);
}

// ---- Case 5: first event is an exponential ramp; start from .value ----
{
  const context = new AudioContext({ sampleRate, blockSize });
  const gain = new GainNode(context);
  const param = gain.getGain();

  param.setValue(0.01);
  param.exponentialRampToValueAtTime(1, 0.1);

  const out = render(param, context, 0.15);

  check("first-exp @0 (start from .value=0.01)", at(out, 0), 0.01, 0.005);
  check("first-exp @0.1 (end)", at(out, 0.1), 1.0, 0.02);
}

// ---- Case 6: getEvents() shape unchanged ----
{
  const context = new AudioContext({ sampleRate, blockSize });
  const gain = new GainNode(context);
  const param = gain.getGain();

  param.linearRampToValueAtTime(1, 1);

  const events = param.getEvents();
  const ok = events.length === 1 &&
    events[0].type === "linearRampToValueAtTime" &&
    events[0].time === 1 &&
    Array.isArray(events[0].args) && events[0].args.length === 2;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  getEvents shape: ${JSON.stringify(events)}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
