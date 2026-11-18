"use strict";

require("run-with-mocha");

const assert = require("assert");
const np = require("../../helpers/np");
const paramTester = require("../../helpers/paramTester");
const AudioContext = require("../../../src/impl/AudioContext");
const AudioParam = require("../../../src/impl/AudioParam");
const AudioNode = require("../../../src/impl/AudioNode");
const GainNode = require("../../../src/impl/GainNode")
const { AUDIO_RATE } = require("../../../src/constants/AudioParamRate");

const context = new AudioContext({ sampleRate: 8000, blockSize: 16 });

function closeTo(a, b, delta) {
  return Math.abs(a - b) <= delta;
}

describe("AudioParam", () => {
  //               +-------------------+
  //               | AudioNode (node1) |
  //               +-------------------+
  //                         |
  // +------------------+    |
  // | GainNode (node2) |    |
  // | gain (param)    <-----+
  // +------------------+
  let node1, node2, param;

  beforeEach(() => {
    node1 = new AudioNode(context, {}, { inputs: [], outputs: [ 1 ] });
    node2 = new GainNode(context);
    param = node2.getGain();
    node1.connect(param);
  });

  it("static value", () => {
    [ 0, 0.25, 0.5, 0.5 ].forEach((value, i) => {
      param.setValue(value);

      context.currentSampleFrame = i * 16;
      param.dspProcess();

      const expected = new Float32Array(16).fill(value);
      const actual = param.getSampleAccurateValues();

      assert(param.hasSampleAccurateValues() === false);
      assert.deepEqual(actual, expected);
    });
  });

  it("input and offset", () => {
    node1.enableOutputsIfNecessary();

    [ 0, 0.25, 0.5, 0.5 ].forEach((value, i) => {
      const noise = np.random_sample(16);

      node1.outputs[0].bus.getMutableData()[0].set(noise);

      param.setValue(value);

      context.currentSampleFrame = i * 16;
      param.dspProcess();

      const expected = new Float32Array(16).map((_, i) => value + noise[i]);
      const actual = param.getSampleAccurateValues();

      assert(param.hasSampleAccurateValues() === true);
      assert.deepEqual(actual, expected);
    });
  });

  it("events", () => {
    param.setValueAtTime(0, 0);
    param.linearRampToValueAtTime(1, 16/8000);

    param.setValue(1);

    context.currentSampleFrame = 0;
    param.dspProcess();

    const expected = new Float32Array(16).map((_, i) => i / 16);
    const actual = param.getSampleAccurateValues();

    assert(param.hasSampleAccurateValues() === true);
    assert.deepEqual(actual, expected);
  });

  it("events and input", () => {
    const noise = np.random_sample(16);

    node1.enableOutputsIfNecessary();
    node1.outputs[0].bus.getMutableData()[0].set(noise);

    param.setValueAtTime(0, 0);
    param.linearRampToValueAtTime(1, 16/8000);

    param.setValue(1);

    context.currentSampleFrame = 0;
    param.dspProcess();

    const expected = new Float32Array(16).map((_, i) => (i / 16) + noise[i]);
    const actual = param.getSampleAccurateValues();

    assert(param.hasSampleAccurateValues() === true);
    assert.deepEqual(actual, expected);
  });
});

describe("hold segment", () => {
  let param;

  beforeEach(() => {
    param = new AudioParam(context, { rate: AUDIO_RATE, defaultValue: 0 });
  });

  function render(param, blocks) {
    const result = new Float32Array(blocks * 16);

    for (let i = 0; i < blocks; i++) {
      context.currentSampleFrame = i * 16;
      param.dspProcess();
      result.set(param.getSampleAccurateValues(), i * 16);
    }

    return result;
  }

  it("holds the end value of a linear ramp until the next event", () => {
    // ramp 0 -> 1 over [0, 0.1s), then hold 1 until setValueAtTime(0.25, 0.3s)
    param.setValueAtTime(0, 0);
    param.linearRampToValueAtTime(1, 0.1);
    param.setValueAtTime(0.25, 0.3);

    const out = render(param, 200);
    const at = (t) => out[Math.round(t * 8000)];

    assert(closeTo(at(0.05), 0.5, 1e-3));
    assert(closeTo(at(0.1), 1.0, 1e-3));
    assert(closeTo(at(0.2), 1.0, 1e-3));
    assert(closeTo(at(0.299), 1.0, 1e-3));
    assert(closeTo(at(0.3), 0.25, 1e-3));
    assert(closeTo(at(0.35), 0.25, 1e-3));
  });

  it("holds the end value of an exponential ramp until the next event", () => {
    param.setValueAtTime(0.01, 0);
    param.exponentialRampToValueAtTime(1, 0.1);
    param.setValueAtTime(0.25, 0.3);

    const out = render(param, 200);
    const at = (t) => out[Math.round(t * 8000)];

    assert(closeTo(at(0.1), 1.0, 1e-2));
    assert(closeTo(at(0.2), 1.0, 1e-3));
    assert(closeTo(at(0.299), 1.0, 1e-3));
    assert(closeTo(at(0.3), 0.25, 1e-3));
  });

  it("holds the last curve value until the next event", () => {
    const curve = new Float32Array([ 0, 0.5, 1 ]);

    param.setValueCurveAtTime(curve, 0, 0.1);
    param.setValueAtTime(0.25, 0.3);

    const out = render(param, 200);
    const at = (t) => out[Math.round(t * 8000)];

    assert(closeTo(at(0.1), 1.0, 1e-2));
    assert(closeTo(at(0.2), 1.0, 1e-3));
    assert(closeTo(at(0.299), 1.0, 1e-3));
    assert(closeTo(at(0.3), 0.25, 1e-3));
  });

  it("a first-event linear ramp starts from the current .value", () => {
    param.setValue(0);
    param.linearRampToValueAtTime(1, 0.1);

    const out = render(param, 60);
    const at = (t) => out[Math.round(t * 8000)];

    assert(closeTo(at(0), 0, 1e-3));
    assert(closeTo(at(0.025), 0.25, 1e-2));
    assert(closeTo(at(0.05), 0.5, 1e-2));
    assert(closeTo(at(0.075), 0.75, 1e-2));
    assert(closeTo(at(0.1), 1.0, 1e-2));
  });

  it("a first-event exponential ramp starts from the current .value", () => {
    param.setValue(0.01);
    param.exponentialRampToValueAtTime(1, 0.1);

    const out = render(param, 60);
    const at = (t) => out[Math.round(t * 8000)];

    assert(closeTo(at(0), 0.01, 1e-3));
    assert(closeTo(at(0.1), 1.0, 1e-2));
  });

  it("keeps getEvents() shape unchanged", () => {
    param.setValue(0);
    param.linearRampToValueAtTime(1, 0.1);

    const events = param.getEvents();

    assert(events.length === 1);
    assert(events[0].type === "linearRampToValueAtTime");
    assert(events[0].time === 0.1);
    assert.deepEqual(events[0].args, [ 1, 0.1 ]);
  });
});

describe("event processing", () => {
  describe("setValueAtTime", () => {
    //0                16              32              48              64              80              96
    //|0123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|
    //|................|...............|...............|...............|...............|...............|
    const expectedValues = paramTester.toValues(`
      |                |               |               |       ************************|               |
      |                |               |               |               |               |               |
      |                |               |               |               |               |               |
      |                |               |               |               |               |               |
      |                |       ********************************        |               ****************|
      |                |               |               |               |               |               |
      |                |               |               |               |               |               |
      |                |               |               |               |               |               |
      |************************        |               |               |               |               |
    `); //                     ^                               ^                 ^
    //                         |                               |                 |
    //                         |                               |                 +-----+
    //                         |                               |                       |
    //                         |                               |                       setValueAtTime(0.5, 74/8000)
    //                         |                               setValueAtTime(1.0, 56/8000)
    //                         setValueAtTime(0.5, 24/8000)
    paramTester.makeTests(context, expectedValues, (param) => {
      param.setValue(0);
      param.setValueAtTime(0.5, 24/8000);
      param.setValueAtTime(1.0, 56/8000);
    }, (param) => {
      param.setValueAtTime(0.5, 74/8000);
    });
  });

  describe("linearRampToValueAtTime", () => {
    //0                16              32              48              64              80              96
    //|0123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|
    //|................|...............|...............|...............|...............|...............|
    const expectedValues = paramTester.toValues(`
      |                |               |               |     ****      |               |               |
      |                |               |               | ****    **    |               |               |
      |                |               |             ****          **  |               |               |
      |                |               |         ****  |             **|               |               |
      |                |               |      ***      |               ***             |  *************|
      |                |               | *****         |               |  **           |**             |
      |                |              ***              |               |    **         *               |
      |                |          **** |               |               |      **       |               |
      |***************************     |               |               |        *******|               |
    `); //                     ^                               ^                 ^        ^
    //                         |                               |                 |        |
    //                         |                               |                 |     +--+
    //                         |                               |                 |     |
    //                         |                               |                 |     linearRampToValueAtTime(0.5, 84/8000)
    //                         |                               |                 linearRampToValueAtTime(0, 74/8000)
    //                         |                               linearRampToValueAtTime(1, 56/8000)
    //                         param.setValueAtTime(0, 24/8000)
    paramTester.makeTests(context, expectedValues, (param) => {
      param.setValue(0);
      param.setValueAtTime(0, 24/8000);
      param.linearRampToValueAtTime(1, 56/8000);
      param.linearRampToValueAtTime(0, 74/8000);
    }, (param) => {
      param.linearRampToValueAtTime(0.5, 84/8000);
    });
  });

  describe("exponentialRampToValueAtTime", () => {
    //0                16              32              48              64              80              96
    //|0123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|
    //|................|...............|...............|...............|...............|...............|
    const expectedValues = paramTester.toValues(`
      |                |               |               |       *       |               |               |
      |                |               |               |      *        |               |               |
      |                |               |               |     *  *      |               |               |
      |                |               |               |   **    *     |               |               |
      |                |               |               | **       *    |               |   ************|
      |                |               |              ***          *   |               |  *            |
      |                |               |          **** |            ** |               | *             |
      |                |               |  ********     |              ****             **              |
      |***********************************             |               |  *************|               |
    `); //                 ^                                   ^                  ^         ^
    //                     |                                   |                  |         |
    //                     |                                   |                  |    +----+
    //                     |                                   |                  |    |
    //                     |                                   |                  |    exponentialRampToValueAtTime(0.5, 84/8000)
    //                     |                                   |                  exponentialRampToValueAtTime(0.01, 74/8000)
    //                     setValueAtTime(0.01, 20/8000)       exponentialRampToValueAtTime(1, 56/8000)
    paramTester.makeTests(context, expectedValues, (param) => {
      param.setValue(1e-6);
      param.setValueAtTime(0.01, 20/8000);
      param.exponentialRampToValueAtTime(1, 56/8000);
      param.exponentialRampToValueAtTime(0.01, 74/8000);
    }, (param) => {
      param.exponentialRampToValueAtTime(0.5, 84/8000);
    });
  });

  describe("setTargetAtTime", () => {
    //0                16              32              48              64              80              96
    //|0123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|
    //|................|...............|...............|...............|...............|...............|
    const expectedValues = paramTester.toValues(`
      |                |               |              **********       |               |               |
      |                |               |     ********* |        **     |               |               |
      |                |               | ****          |          **   |               |        *******|
      |                |              ***              |            ** |               |   *****       |
      |                |            ** |               |              ***              ****            |
      |                |          **   |               |               | ****          |               |
      |                |         *     |               |               |     ******    |               |
      |                |        *      |               |               |           ****|               |
      |*************************       |               |               |               |               |
    `); //                     ^                               ^                 ^
    //                         |                               |                 |
    //                         |                               |                 +-----+
    //                         |                               |                       |
    //                         |                               |                       setTargetAtTime(1, 74/8000, 16/8000)
    //                         |                               setTargetAtTime(0, 56/8000, 12/8000)
    //                         setTargetAtTime(1, 24/8000, 8/8000)
    paramTester.makeTests(context, expectedValues, (param) => {
      param.setValue(0);
      param.setTargetAtTime(1, 24/8000, 8/8000);
      param.setTargetAtTime(0, 56/8000, 12/8000);
    }, (param) => {
      param.setTargetAtTime(1, 74/8000, 16/8000);
    });
  });

  describe("setValueCurveAtTime", () => {
    //0                16              32              48              64              80              96
    //|0123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|123456789abcdef|
    //|................|...............|...............|...............|...............|...............|
    const expectedValues = paramTester.toValues(`
      |                |               |               |      *************************|             **|
      |                |               |               |    **         |               |            *  |
      |                |               |   ****        | ***           |               |     **    *   |
      |                |               | **    *****   **              |               |    *  ** *    |
      |                |****          ***           ***|               |               |   *     *     |
      |              ***    ****    ** |               |               |               *  *            |
      |            **  |        ****   |               |               |               |**             |
      |          **    |               |               |               |               |               |
      |**********      |               |               |               |               |               |
    `); //     ^==============================================^                  ^==================^
    //         |                                                                 |
    //         |                                                                 +-----+
    //         |                                                                       |
    //         setValueCurveAtTime(curve, 8/8000, 48/8000)                             setValueCurveAtTime(curve, 74/8000, 20/8000)
    const curve = new Float32Array([ 0, 0.5, 0.25, 0.75, 0.5, 1 ]);

    paramTester.makeTests(context, expectedValues, (param) => {
      param.setValue(0);
      param.setValueCurveAtTime(curve, 8/8000, 48/8000);
    }, (param) => {
      param.setValueCurveAtTime(curve, 74/8000, 20/8000);
    });
  });
});
