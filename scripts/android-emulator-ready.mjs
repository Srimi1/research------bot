// First-boot system/Google app work can starve input delivery on the shared CI runner.
// Wait before installing or launching Research Bot; never retry a failing app test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const serialArgs = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const output = 'android-startup-results';
mkdirSync(output, { recursive: true });
const deadline = Date.now() + 180_000;
let readySamples = 0;

while (Date.now() < deadline) {
  const cpuInfo = execFileSync('adb', [...serialArgs, 'shell', 'dumpsys', 'cpuinfo'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  writeFileSync(`${output}/emulator-readiness-cpuinfo.txt`, cpuInfo);
  const usage = Number(cpuInfo.match(/^\s*([\d.]+)% TOTAL:/m)?.[1]);
  assert.ok(Number.isFinite(usage), 'Android must report total CPU usage before runtime tests');
  readySamples = usage <= 70 ? readySamples + 1 : 0;
  console.log(`Emulator readiness: ${usage}% CPU, ${readySamples}/3 settled samples`);
  if (readySamples === 3) process.exit(0);
  await new Promise(resolve => setTimeout(resolve, 5_000));
}

throw new Error('Android first-boot CPU activity did not settle within 180 seconds; app tests were not started');
