// First-boot system/Google app work can starve input delivery on the shared CI runner.
// Wait before installing or launching Research Bot; never retry a failing app test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const serialArgs = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const output = 'android-startup-results';
mkdirSync(output, { recursive: true });
const adb = (...args) => execFileSync('adb', [...serialArgs, ...args], { encoding: 'utf8', timeout: 15_000 });

function counters() {
  // dumpsys cpuinfo can return its unchanged boot-time snapshot for several minutes.
  const stat = adb('shell', 'cat', '/proc/stat');
  writeFileSync(`${output}/emulator-readiness-stat.txt`, stat);
  const values = stat
    .match(/^cpu\s+([\d\s]+)$/m)?.[1]
    .trim()
    .split(/\s+/)
    .map(Number);
  assert.ok(values?.length >= 8 && values.every(Number.isFinite), 'Android must expose current CPU counters');
  // Guest time is already included in user/nice; only sum the first eight fields.
  return { total: values.slice(0, 8).reduce((sum, value) => sum + value, 0), idle: values[3] };
}

// The Google APIs CI image is userdebug. Root is needed only to read its restricted
// kernel counters; restore normal adb before installing or launching the tested app.
assert.equal(adb('shell', 'getprop', 'ro.kernel.qemu').trim(), '1', 'Run this readiness check on an emulator');
console.log(adb('root').trim());
adb('wait-for-device');
try {
  const deadline = Date.now() + 180_000;
  let readySamples = 0;
  let previous = counters();
  while (Date.now() < deadline && readySamples < 3) {
    await new Promise(resolve => setTimeout(resolve, 5_000));
    const current = counters();
    const elapsed = current.total - previous.total;
    assert.ok(elapsed > 0, 'Android CPU counters must advance between readiness samples');
    const usage = (100 * (elapsed - (current.idle - previous.idle))) / elapsed;
    previous = current;
    readySamples = usage <= 70 ? readySamples + 1 : 0;
    console.log(`Emulator readiness: ${usage.toFixed(1)}% CPU, ${readySamples}/3 settled samples`);
  }
  assert.equal(readySamples, 3, 'Android first-boot CPU activity did not settle within 180 seconds');
} finally {
  console.log(adb('unroot').trim());
  adb('wait-for-device');
}
