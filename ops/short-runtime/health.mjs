import {readFile} from 'node:fs/promises';
import {healthProblems} from '../../server/short-runtime/runtime.mjs';
try{const problems=healthProblems(JSON.parse(await readFile(process.argv[2],'utf8')),{maxAgeMs:Number(process.argv[3]??120000)});console.log(JSON.stringify({healthy:!problems.length,problems}));if(problems.length)process.exitCode=1;}
catch{console.error('Short runtime health unavailable');process.exitCode=1;}
