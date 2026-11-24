"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm");
const { createSwarmBridge } = require("../common/swarm.cjs");
function fixture({ count = 0, disabled = false } = {}) {
  const events = [],
    editor = {
      isConnected: true,
      getAttribute: () => (disabled ? "true" : null),
      querySelector: () =>
        count ? { getAttribute: () => "slashCommand:swarm" } : null,
      querySelectorAll: (selector) =>
        Array.from(
          { length: selector.includes("slashCommand:swarm") ? count : 0 },
          () => ({
            getAttribute: () => "slashCommand:swarm",
          }),
        ),
      dispatchEvent: (e) => events.push(e),
    },
    root = { querySelector: () => editor },
    trigger = { closest: () => root };
  const bridge = createSwarmBridge();
  return { bridge, trigger, editor, events };
}
test("already-active Swarm is idempotent and never duplicates or submits a command", async () => {
  const f = fixture({ count: 1 });
  assert.equal(f.bridge.active(f.trigger), true);
  assert.equal(await f.bridge.set(f.trigger, true), true);
  assert.deepEqual(f.events, []);
});
test("already-disabled Swarm leaves an existing editor and draft untouched", async () => {
  const f = fixture();
  assert.equal(await f.bridge.set(f.trigger, false), true);
  assert.deepEqual(f.events, []);
});
test("missing or disabled native editors are rejected rather than fabricating a command", async () => {
  const f = fixture({ disabled: true });
  assert.equal(await f.bridge.set(f.trigger, true), false);
  assert.equal(await f.bridge.set({ closest: () => null }, true), false);
  assert.deepEqual(f.events, []);
});
test("destroying the bridge preserves native Swarm and refuses further mutations", async () => {
  const f = fixture({ count: 1 });
  f.bridge.destroy();
  assert.equal(f.bridge.active(f.trigger), true);
  assert.equal(await f.bridge.set(f.trigger, false), false);
  assert.deepEqual(f.events, []);
});
test("too many duplicate tokens fail safely without editing the prompt", async () => {
  const f = fixture({ count: 33 });
  assert.equal(await f.bridge.set(f.trigger, false), false);
  assert.deepEqual(f.events, []);
  assert.equal(f.bridge.busy, false);
});
test("the serialized bridge is self-contained for both native renderer platforms", () => {
  const factory = vm.runInNewContext("(" + createSwarmBridge.toString() + ")", {
    setTimeout,
  });
  const bridge = factory();
  assert.equal(bridge.active(null), false);
  bridge.destroy();
});
test("skill-backed Swarm pills (native_swarm/SKILL.md) are detected, deduplicated, and kept idempotent", async () => {
  const swarmPill = {
    getAttribute: (name) =>
      name === "data-testid"
        ? "skill-scope-item-pill"
        : name === "data-uri"
          ? "file:///C:/Users/PC/.gemini/antigravity/builtin/skills/native_swarm/SKILL.md"
          : null,
    textContent: "swarm",
  };
  const unrelatedSkillPill = {
    getAttribute: (name) =>
      name === "data-testid"
        ? "skill-scope-item-pill"
        : name === "data-uri"
          ? "file:///C:/Users/PC/.gemini/antigravity/builtin/skills/plan/SKILL.md"
          : null,
    textContent: "plan",
  };
  const events = [];
  const editor = {
    isConnected: true,
    getAttribute: () => null,
    querySelectorAll: (selector) => {
      if (selector.includes('data-uri$="/native_swarm/SKILL.md"'))
        return [swarmPill];
      if (selector === '[data-testid="skill-scope-item-pill"]')
        return [swarmPill, unrelatedSkillPill];
      return [];
    },
    dispatchEvent: (e) => events.push(e),
  };
  const trigger = { closest: () => ({ querySelector: () => editor }) };
  const bridge = createSwarmBridge();
  assert.equal(bridge.active(trigger, "swarm"), true);
  assert.equal(bridge.active(trigger, "boost"), false);
  assert.equal(bridge.active(trigger, "teamwork"), false);
  assert.equal(await bridge.set(trigger, true, "swarm"), true);
  assert.deepEqual(events, []);
});
test("skill-backed pills with custom directories match by trimmed label without false positives", () => {
  const customSwarmPill = {
    getAttribute: (name) =>
      name === "data-testid"
        ? "skill-scope-item-pill"
        : name === "data-uri"
          ? "file:///tmp/custom_dir/SKILL.md"
          : null,
    textContent: " /Swarm ",
  };
  const editor = {
    isConnected: true,
    getAttribute: () => null,
    querySelectorAll: (selector) =>
      selector === '[data-testid="skill-scope-item-pill"]'
        ? [customSwarmPill]
        : [],
  };
  const trigger = { closest: () => ({ querySelector: () => editor }) };
  const bridge = createSwarmBridge();
  assert.equal(bridge.active(trigger, "swarm"), true);
  assert.equal(bridge.active(trigger, "boost"), false);
});
test("delayed skill pill insertion (>30ms) and removal succeed cleanly", async () => {
  let pill = null;
  let focused = false;
  let collapsed = true;
  const fakeRange = {
    selectNodeContents() {},
    collapse() {
      collapsed = true;
    },
    selectNode() {
      collapsed = false;
    },
    compareBoundaryPoints: () => 0,
  };
  const prev = {
    document: global.document,
    window: global.window,
    Range: global.Range,
    ClipboardEvent: global.ClipboardEvent,
    DataTransfer: global.DataTransfer,
  };
  const selection = {
    rangeCount: 1,
    get isCollapsed() {
      return collapsed;
    },
    removeAllRanges() {},
    addRange() {},
    getRangeAt: () => fakeRange,
  };
  global.document = {
    createRange: () => fakeRange,
  };
  global.window = {
    getSelection: () => selection,
  };
  global.Range = { START_TO_START: 0, END_TO_END: 2 };
  global.DataTransfer = class {
    constructor() {
      this.data = {};
    }
    setData(k, v) {
      this.data[k] = v;
    }
  };
  global.ClipboardEvent = class {
    constructor(type, init) {
      this.type = type;
      this.clipboardData = init?.clipboardData;
    }
  };
  try {
    const decorator = { contains: () => true };
    const option = {
      innerText: "swarm\nRun a swarm",
      closest: () => null,
      click() {
        setTimeout(() => {
          pill = {
            getAttribute: (name) =>
              name === "data-testid"
                ? "skill-scope-item-pill"
                : name === "data-uri"
                  ? "file:///C:/Users/PC/.gemini/antigravity/builtin/skills/native_swarm/SKILL.md"
                  : null,
            textContent: "swarm",
            closest: (sel) =>
              sel.includes("data-lexical-decorator") ? decorator : null,
          };
        }, 70);
      },
    };
    const root = {
      querySelector: () => editor,
      querySelectorAll: (sel) =>
        sel.includes("[data-mention-menu]") ? [option] : [],
    };
    const editor = {
      isConnected: true,
      textContent: "",
      closest: () => root,
      getAttribute: () => null,
      focus() {
        focused = true;
      },
      contains: (node) => (pill ? node === decorator : false),
      querySelectorAll: (selector) => {
        if (!pill) return [];
        if (
          selector.includes('data-uri$="/native_swarm/SKILL.md"') ||
          selector === '[data-testid="skill-scope-item-pill"]'
        )
          return [pill];
        return [];
      },
      dispatchEvent(ev) {
        if (ev.type === "cut") pill = null;
      },
    };
    const trigger = { closest: () => root };
    const bridge = createSwarmBridge();
    assert.equal(await bridge.set(trigger, true, "swarm"), true);
    assert.equal(focused, true);
    assert.equal(bridge.active(trigger, "swarm"), true);
    assert.equal(await bridge.set(trigger, false, "swarm"), true);
    assert.equal(bridge.active(trigger, "swarm"), false);
  } finally {
    Object.assign(global, prev);
  }
});
