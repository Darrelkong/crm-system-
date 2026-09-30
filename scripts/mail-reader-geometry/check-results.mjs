/** Re-evaluate captured real browser geometry; never substitutes for a browser run. */
import { readFileSync } from 'node:fs';
import { assertGeometry } from './geometry.mjs';
const [file,mode='baseline']=process.argv.slice(2);
if(!file||!['baseline','fixed'].includes(mode)) throw new Error('Usage: node check-results.mjs geometry.json [baseline|fixed]');
const records=JSON.parse(readFileSync(file,'utf8'));
if(records.length!==12) throw new Error('Expected six fixtures at both viewports');
const results=records.map(record=>({fixture:record.fixture.name,width:record.top.viewport.width,...assertGeometry(record,mode)}));
const passed=results.reduce((n,r)=>n+r.passed,0), failed=results.reduce((n,r)=>n+r.failed,0);
console.log(JSON.stringify({mode,cases:results.length,passed,failed,failures:results.flatMap(r=>r.checks.filter(c=>!c.pass).map(c=>({fixture:r.fixture,width:r.width,check:c.name})))},null,2));
if(failed) process.exitCode=1;
