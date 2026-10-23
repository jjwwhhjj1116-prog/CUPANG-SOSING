import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {sourceInboxReadHarness,inboxReadSnapshot} from '../tests/helpers/source-inbox-read.mjs';

// Read-only baseline from the task's starting commit. All records below are
// generated locally; neither version has network/browser/production access.
const baseline=process.argv[2]??'d12e866';
if(!/^[a-f0-9]{7,40}$/i.test(baseline))throw Error('Use a verified local commit SHA');
const files=['app/source-inbox.ts','db/source-inbox.ts','app/api/source-inbox/route.ts'];
const sources=Object.fromEntries(files.map(file=>[file,execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})]));
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const results=[];
for(const [label,count,shape] of [['typical-4',4,{}],['typical-6',6,{}],['typical-40',40,{}],['dense-6',6,{optionCount:200,imageCount:200,description:'합성 설명'.repeat(3000)}],['dense-40',40,{optionCount:200,imageCount:200,description:'합성 설명'.repeat(3000)}]]){
 const result={label,captures:count,bytesPerSnapshot:Buffer.byteLength(JSON.stringify(inboxReadSnapshot(1,shape)))};
 for(const [version,options] of [['before',{sources}],['after',{}]]){
  const h=sourceInboxReadHarness(options);try{
   for(let i=1;i<=count;i++)h.seed(i,inboxReadSnapshot(i,shape));
   await(await h.api.GET()).text();const wall=[],cpu=[];let responseBytes=0;
   for(let i=0;i<15;i++){
    h.stats.validations=0;const usage=process.cpuUsage(),start=performance.now(),response=await h.api.GET(),body=await response.text();
    if(response.status!==200)throw Error(body);wall.push(performance.now()-start);const used=process.cpuUsage(usage);cpu.push((used.user+used.system)/1000);responseBytes=Buffer.byteLength(body);
   }
   const medianCpu=median(cpu);
   result[version]={medianWallMs:+median(wall).toFixed(3),medianProcessCpuMs:medianCpu?+medianCpu.toFixed(3):null,validations:h.stats.validations,responseBytes};
  }finally{h.close();}
 }
 result.wallReductionPercent=+((1-result.after.medianWallMs/result.before.medianWallMs)*100).toFixed(1);results.push(result);
}
console.log(JSON.stringify({baseline,measurement:'Local Node process and in-memory SQLite; includes body consumption, excludes auth/network latency; not Cloudflare CPU measurements. null CPU means below the process clock resolution.',results},null,2));
