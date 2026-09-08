import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';

const packageJson=JSON.parse(await readFile(path.resolve('package.json'),'utf8'));
if(typeof packageJson.version!=='string'||!/^\d+\.\d+\.\d+$/.test(packageJson.version))throw new Error('Invalid package version');
const archive=path.resolve('release',`zero-point-${packageJson.version}-win-x64.zip`);
const bytes=await readFile(archive);const digest=createHash('sha256').update(bytes).digest('hex');
await writeFile(`${archive}.sha256`,`${digest}  ${path.basename(archive)}\n`,'utf8');
console.log(JSON.stringify({archive,bytes:bytes.length,sha256:digest}));
