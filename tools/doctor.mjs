import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PY } from './lib/common.mjs';
import { chromePath } from '../render/common.mjs';

let failed = false;
function check(name, fn) {
  try { const detail = fn(); console.log(`OK   ${name}: ${detail}`); }
  catch (e) { failed = true; console.log(`FAIL ${name}: ${e.message}`); }
}
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr.trim());
  return r.stdout.trim();
};
check('Node', () => process.version);
check('Chrome', () => { const p = chromePath(); if (!fs.existsSync(p)) throw new Error('set CHROME_PATH'); return p; });
check('ffmpeg', () => run('ffmpeg', ['-version']).split('\n')[0]);
check('ffprobe', () => run('ffprobe', ['-version']).split('\n')[0]);
check('H.264 encoder', () => { if (!run('ffmpeg', ['-hide_banner', '-encoders']).includes('libx264')) throw new Error('ffmpeg needs libx264'); return 'libx264'; });
check('contact sheet filter', () => { if (!run('ffmpeg', ['-hide_banner', '-filters']).includes('drawtext')) throw new Error('ffmpeg needs drawtext'); return 'drawtext'; });
check('Python + audio/image packages', () => run(PY, ['-c', 'import sys,numpy,scipy,PIL; print(sys.version.split()[0])']));
if (process.argv.includes('--tts')) check('Piper (optional)', () => run(PY, ['-c', 'import piper,onnxruntime; print("available")']));
console.log(`Platform: ${process.platform}/${process.arch}. Validated on macOS; other systems may need adaptation.`);
process.exitCode = failed ? 1 : 0;
