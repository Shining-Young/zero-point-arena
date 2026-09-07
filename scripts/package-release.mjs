import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';

const archive=path.resolve('release','zero-point-0.2.0-win-x64.zip');
const bytes=await readFile(archive);const digest=createHash('sha256').update(bytes).digest('hex');
await writeFile(`${archive}.sha256`,`${digest}  ${path.basename(archive)}\n`,'utf8');
console.log(JSON.stringify({archive,bytes:bytes.length,sha256:digest}));
