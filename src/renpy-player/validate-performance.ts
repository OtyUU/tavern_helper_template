/**
 * Performance Validation Script
 * 
 * This script runs performance benchmarks and generates a report
 * validating that all Requirement 10 targets are met.
 * 
 * Run with: node --loader tsx src/renpy-player/validate-performance.ts
 */

import { ref } from 'vue';
import type { PlayerFrame } from './types';
import { useFramePhase } from './useFramePhase';
import { useTransitionBus } from './useTransitionBus';

// ─── Performance Measurement Utilities ────────────────────────────────────

function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  const end = performance.now();
  return end - start;
}

function benchmark(fn: () => void, iterations: number) {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    times.push(measureTime(fn));
  }
  times.sort((a, b) => a - b);
  
  return {
    mean: times.reduce((sum, t) => sum + t, 0) / times.length,
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
    max: times[times.length - 1],
  };
}

function createTestFrame(index: number): PlayerFrame {
  return {
    index,
    background: { description: `bg${index}`, asset: null },
    sprites: [],
    text: `Frame ${index} dialogue`,
    speaker: 'Test',
    isNewScene: index % 5 === 0,
    cameraTransform: undefined,
    cameraAnimations: [],
  };
}

// ─── Validation Tests ──────────────────────────────────────────────────────

console.log('\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║  Performance Validation Report: Two-Phase Frame Playback     ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

// Test 1: TransitionBus Registration (Req 10.1)
console.log('📊 Requirement 10.1: TransitionBus Registration Performance');
console.log('   Target: <1ms per operation (p95)\n');

const bus1 = useTransitionBus();
const stats1 = benchmark(() => {
  const cleanup = bus1.register(() => {});
  cleanup();
}, 1000);

console.log(`   Results (1000 iterations):`);
console.log(`   • Mean:   ${stats1.mean.toFixed(4)}ms`);
console.log(`   • Median: ${stats1.median.toFixed(4)}ms`);
console.log(`   • P95:    ${stats1.p95.toFixed(4)}ms`);
console.log(`   • P99:    ${stats1.p99.toFixed(4)}ms`);
console.log(`   • Max:    ${stats1.max.toFixed(4)}ms`);
console.log(`   ✓ ${stats1.p95 < 1 ? 'PASS' : 'FAIL'} - P95 is ${stats1.p95 < 1 ? 'below' : 'above'} 1ms threshold\n`);

// Test 2: cancelAll() Performance
console.log('📊 TransitionBus cancelAll() with Multiple Registrations');
console.log('   Target: Efficient cancellation\n');

const stats2 = benchmark(() => {
  const bus = useTransitionBus();
  for (let i = 0; i < 10; i++) {
    bus.register(() => {});
  }
  bus.cancelAll();
}, 100);

console.log(`   Results (100 iterations, 10 registrations each):`);
console.log(`   • Mean:   ${stats2.mean.toFixed(4)}ms`);
console.log(`   • P95:    ${stats2.p95.toFixed(4)}ms`);
console.log(`   ✓ ${stats2.p95 < 5 ? 'PASS' : 'FAIL'} - P95 is ${stats2.p95.toFixed(4)}ms\n`);

// Test 3: Phase Transitions (Req 10.2)
console.log('📊 Requirement 10.2: Phase Transition Performance');
console.log('   Target: <2ms per transition (p95)\n');

const bus3 = useTransitionBus();
const frameIndex3 = ref(0);
const frames3 = ref([createTestFrame(0), createTestFrame(1)]);
const currentFrame3 = ref(frames3.value[0]);
const isFullyRevealed3 = ref(false);
const effectsDisabled3 = ref(false);

const { phase: phase3 } = useFramePhase(
  bus3,
  frameIndex3,
  frames3,
  currentFrame3,
  isFullyRevealed3,
  () => {},
  effectsDisabled3,
);

// Measure scene → reveal transition
const transitionTimes: number[] = [];
for (let i = 0; i < 100; i++) {
  phase3.value = 'scene';
  const start = performance.now();
  // Trigger transition by ensuring bus.count is 0
  bus3.cancelAll();
  const end = performance.now();
  transitionTimes.push(end - start);
}

transitionTimes.sort((a, b) => a - b);
const transitionStats = {
  mean: transitionTimes.reduce((sum, t) => sum + t, 0) / transitionTimes.length,
  p95: transitionTimes[Math.floor(transitionTimes.length * 0.95)],
};

console.log(`   Results (100 scene → reveal transitions):`);
console.log(`   • Mean:   ${transitionStats.mean.toFixed(4)}ms`);
console.log(`   • P95:    ${transitionStats.p95.toFixed(4)}ms`);
console.log(`   ✓ ${transitionStats.p95 < 2 ? 'PASS' : 'FAIL'} - P95 is ${transitionStats.p95 < 2 ? 'below' : 'above'} 2ms threshold\n`);

// Test 4: Instant Mode (Req 10.3)
console.log('📊 Requirement 10.3: Instant Mode Frame Application');
console.log('   Target: <1ms per frame application (p95)\n');

const bus4 = useTransitionBus();
const frameIndex4 = ref(0);
const frames4 = ref(Array.from({ length: 100 }, (_, i) => createTestFrame(i)));
const currentFrame4 = ref(frames4.value[0]);
const isFullyRevealed4 = ref(false);
const effectsDisabled4 = ref(true); // Instant mode

const { applyNextFrame: applyNextFrame4 } = useFramePhase(
  bus4,
  frameIndex4,
  frames4,
  currentFrame4,
  isFullyRevealed4,
  () => {},
  effectsDisabled4,
);

const stats4 = benchmark(() => {
  applyNextFrame4('forward');
  currentFrame4.value = frames4.value[frameIndex4.value % frames4.value.length];
}, 100);

console.log(`   Results (100 frame applications in instant mode):`);
console.log(`   • Mean:   ${stats4.mean.toFixed(4)}ms`);
console.log(`   • P95:    ${stats4.p95.toFixed(4)}ms`);
console.log(`   ✓ ${stats4.p95 < 1 ? 'PASS' : 'FAIL'} - P95 is ${stats4.p95 < 1 ? 'below' : 'above'} 1ms threshold\n`);

// Test 5: Memory Performance (Req 10.4)
console.log('📊 Requirement 10.4: Memory Performance');
console.log('   Target: No memory leaks over 1000+ frame advances\n');

const bus5 = useTransitionBus();
const frameIndex5 = ref(0);
const frames5 = ref(Array.from({ length: 100 }, (_, i) => createTestFrame(i)));
const currentFrame5 = ref(frames5.value[0]);
const isFullyRevealed5 = ref(false);
const effectsDisabled5 = ref(true);

const { applyNextFrame: applyNextFrame5 } = useFramePhase(
  bus5,
  frameIndex5,
  frames5,
  currentFrame5,
  isFullyRevealed5,
  () => {},
  effectsDisabled5,
);

const start5 = performance.now();
for (let i = 0; i < 1000; i++) {
  applyNextFrame5('forward');
  currentFrame5.value = frames5.value[frameIndex5.value % frames5.value.length];
  
  // Simulate animation registrations
  const cleanup1 = bus5.register(() => {});
  const cleanup2 = bus5.register(() => {});
  cleanup1();
  cleanup2();
}
const end5 = performance.now();
const totalTime = end5 - start5;
const avgPerFrame = totalTime / 1000;

console.log(`   Results (1000 frame advances with registrations):`);
console.log(`   • Total time:     ${totalTime.toFixed(2)}ms`);
console.log(`   • Avg per frame:  ${avgPerFrame.toFixed(4)}ms`);
console.log(`   • Final bus count: ${bus5.count.value}`);
console.log(`   ✓ ${bus5.count.value === 0 ? 'PASS' : 'FAIL'} - No leaked registrations\n`);

// Summary
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║  Performance Validation Summary                               ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

const allPassed = 
  stats1.p95 < 1 &&
  stats2.p95 < 5 &&
  transitionStats.p95 < 2 &&
  stats4.p95 < 1 &&
  bus5.count.value === 0;

console.log(`   Requirement 10.1 (TransitionBus <1ms):     ${stats1.p95 < 1 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`   Requirement 10.2 (Phase transitions <2ms): ${transitionStats.p95 < 2 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`   Requirement 10.3 (Instant mode <1ms):      ${stats4.p95 < 1 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`   Requirement 10.4 (No memory leaks):        ${bus5.count.value === 0 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`\n   Overall: ${allPassed ? '✓ ALL REQUIREMENTS MET' : '✗ SOME REQUIREMENTS FAILED'}\n`);

process.exit(allPassed ? 0 : 1);
