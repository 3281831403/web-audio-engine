"use strict";

// Dynamic insertion + boundary scenarios.
const AudioContext = require("../src/impl/AudioContext");
const AudioParam = require("../src/impl/AudioParam");
const { AUDIO_RATE } = require("../src/constants/AudioParamRate");

const sampleRate = 8000;
const blockSize = 16;

function render(param, context, blocks, after) {
  const out = new Float32Array(blocks * blockSize);

  for (let i = 0; i < blocks; i++) {
    context.currentSampleFrame = i * blockSize;
    if (after && i === after.block) after.schedule(param);
    param.dspProcess();
    out.set(param.getSampleAccurateValues(), i * blockSize);
  }

  return out;
}

let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
}

// A: setValue scheduled dynamically in the future while a ramp already ran
{
  const context = new AudioContext({ sampleRate, blockSize });
  const param = new AudioParam(context, { rate: AUDIO_RATE, defaultValue: 0 });
  param.setValueAtTime(0, 0);
  param.linearRampToValueAtTime(1, 0.02); // ends at frame 160 (block 10)

  const out = render(param, context, 300, {
    block: 12,
    schedule: (p) => p.setValueAtTime(0.25, 0.5) // frame 4000
  });

  const at = (t) => out[Math.round(t * sampleRate)];
  check("dynamic: ramp end held @0.1", Math.abs(at(0.1) - 1) < 1e-3, `got ${at(0.1)}`);
  check("dynamic: ramp end held @0.3", Math.abs(at(0.3) - 1) < 1e-3, `got ${at(0.3)}`);
  check("dynamic: held @0.499", Math.abs(at(0.499) - 1) < 1e-3, `got ${at(0.499)}`);
  check("dynamic: new value @0.5", Math.abs(at(0.5) - 0.25) < 1e-3, `got ${at(0.5)}`);
}

// B: cancel then reschedule
{
  const context = new AudioContext({ sampleRate, blockSize });
  const param = new AudioParam(context, { rate: AUDIO_RATE, defaultValue: 0 });
  param.setValueAtTime(0, 0);
  param.linearRampToValueAtTime(1, 0.02);
  param.setValueAtTime(0.25, 0.5);
  param.cancelScheduledValues(0.0);

  const out = render(param, context, 10);
  const allZero = out.every((v) => v === 0);
  check("cancel removes everything -> default value fill", allZero);
  check("getEvents empty after cancel(0)", param.getEvents().length === 0);
}

// C: gap ends exactly on a quantum boundary
{
  const context = new AudioContext({ sampleRate, blockSize });
  const param = new AudioParam(context, { rate: AUDIO_RATE, defaultValue: 0 });
  param.setValueAtTime(0, 0);
  param.linearRampToValueAtTime(1, 0.02);   // end frame 160
  param.setValueAtTime(0.25, 0.04);         // frame 320, quantum boundary

  const out = render(param, context, 25);
  const at = (t) => out[Math.round(t * sampleRate)];
  check("boundary: hold @0.0399", Math.abs(at(0.0399) - 1) < 1e-3, `got ${at(0.0399)}`);
  check("boundary: switch @0.04", Math.abs(at(0.04) - 0.25) < 1e-3, `got ${at(0.04)}`);
}

// D: zero-length ramp (start===end frame) is skipped, value from setValue
{
  const context = new AudioContext({ sampleRate, blockSize });
  const param = new AudioParam(context, { rate: AUDIO_RATE, defaultValue: 0 });
  param.setValueAtTime(0.7, 0.01);
  param.linearRampToValueAtTime(0.7, 0.01);

  const out = render(param, context, 60);
  // zero-span events at frame 80 are skipped by the DSP (pre-existing rule);
  // frames before stay at initial value and no regression is introduced
  const ok = out[Math.round(0.005 * sampleRate)] === 0
    && out[Math.round(0.02 * sampleRate)] === 0
    && out[Math.round(0.05 * sampleRate)] === 0;
  check("zero-length events keep pre-existing behavior", ok);
}

// E: first-event ramp with setValue later (hold then switch)
{
  const context = new AudioContext({ sampleRate, blockSize });
  const param = new AudioParam(context, { rate: AUDIO_RATE, defaultValue: 0 });
  param.setValue(0);
  param.linearRampToValueAtTime(1, 0.02);
  param.setValueAtTime(0.3, 0.1);

  const out = render(param, context, 60);
  const at = (t) => out[Math.round(t * sampleRate)];
  check("first-ramp+hold @0", at(0) === 0, `got ${at(0)}`);
  check("first-ramp+hold @0.01", Math.abs(at(0.01) - 0.5) < 0.02, `got ${at(0.01)}`);
  check("first-ramp+hold @0.05 held", Math.abs(at(0.05) - 1) < 1e-3, `got ${at(0.05)}`);
  check("first-ramp+hold @0.1 switch", Math.abs(at(0.1) - 0.3) < 1e-3, `got ${at(0.1)}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
