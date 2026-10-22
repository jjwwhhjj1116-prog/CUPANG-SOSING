/** Cloudflare model-specific chat contract; never extract JSON from reasoning. */
export const WORKERS_QWEN_MODEL='@cf/qwen/qwen3-30b-a3b-fp8';
export type WorkersQwenDiagnostic={finish:'stop'|'length'|'other'|'missing';contentType:'string'|'null'|'other'|'missing';contentLength:number|null;model:'qwen'|'llama'|'other'|'missing'};
export type WorkersQwenFailure='ENVELOPE'|'RESPONSE_SIZE'|'COMPLETION_TYPE'|'MODEL'|'CHOICES'|'CHOICE'|'OUTPUT_TRUNCATED'|'FINISH_REASON'|'MESSAGE'|'CONTENT_SIZE'|'TOOL_OR_REFUSAL'|'REASONING_PREFIX'|'CODE_FENCE'|'JSON_SYNTAX'|'JSON_OBJECT';
function diagnostic(payload:unknown):WorkersQwenDiagnostic{
 const response=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Record<string,unknown>:null;
 const choice=Array.isArray(response?.choices)?response.choices[0]:null;
 const message=choice&&typeof choice==='object'&&!Array.isArray(choice)?choice.message:null;
 const content=message&&typeof message==='object'&&!Array.isArray(message)?message.content:undefined;
 const finish=choice&&typeof choice==='object'&&!Array.isArray(choice)?choice.finish_reason:undefined;
 return{finish:finish===undefined?'missing':finish==='stop'?'stop':finish==='length'?'length':'other',contentType:content===undefined?'missing':content===null?'null':typeof content==='string'?'string':'other',
  contentLength:typeof content==='string'?Math.min(content.length,512*1024+1):null,
  model:response?.model===undefined?'missing':response.model===WORKERS_QWEN_MODEL||response.model==='qwen3-30b-a3b-fp8'?'qwen':response.model==='@cf/meta/llama-3.3-70b-instruct-fp8-fast'?'llama':'other'};
}
/** Only bounded classifications are exposed. Never copy model output or reasoning into errors. */
export class WorkersQwenContractError extends Error{
 constructor(public reason:WorkersQwenFailure,public diagnostic:WorkersQwenDiagnostic){super(`Qwen contract ${reason}`);}
}
export function parseWorkersQwenJson(payload:unknown):{value:unknown;usage?:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}}{
 const fail=(reason:WorkersQwenFailure):never=>{throw new WorkersQwenContractError(reason,diagnostic(payload));};
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return fail('ENVELOPE');
 let serialized:string;try{serialized=JSON.stringify(payload);}catch{return fail('ENVELOPE');}
 if(serialized.length>512*1024)return fail('RESPONSE_SIZE');
 const response=payload as Record<string,unknown>;
 if(Object.hasOwn(response,'response')||response.object!==undefined&&response.object!=='chat.completion')return fail('COMPLETION_TYPE');
 if(response.model!==undefined&&response.model!==WORKERS_QWEN_MODEL&&response.model!=='qwen3-30b-a3b-fp8')return fail('MODEL');
 if(!Array.isArray(response.choices)||response.choices.length!==1)return fail('CHOICES');
 const choice=response.choices[0];
 if(!choice||typeof choice!=='object'||Array.isArray(choice)||choice.index!==undefined&&choice.index!==0
  )return fail('CHOICE');
 if(choice.finish_reason==='length')return fail('OUTPUT_TRUNCATED');
 if(choice.finish_reason!==undefined&&choice.finish_reason!=='stop')return fail('FINISH_REASON');
 const message=choice.message;
 if(!message||typeof message!=='object'||Array.isArray(message)||message.role!=='assistant'||typeof message.content!=='string'
  ||!message.content.trim())return fail('MESSAGE');
 if(message.content.length>256*1024)return fail('CONTENT_SIZE');
 if(message.tool_calls?.length||message.refusal)return fail('TOOL_OR_REFUSAL');
 // Only the documented assistant content is parsed. reasoning_content and
 // transport metadata are neither retained nor used to repair a bad result.
 // Qwen's official /no_think soft switch can emit a whitespace-only think
 // prefix. Accept exactly one empty prefix, never non-empty reasoning.
 // https://huggingface.co/Qwen/Qwen3-30B-A3B-FP8
 let content=message.content.trim();const emptyThinking=/^<think>[\t\n\r ]*<\/think>[\t\n\r ]*/u.exec(content);
 if(emptyThinking)content=content.slice(emptyThinking[0].length);
 if(content.startsWith('<think>')||content.startsWith('</think>'))return fail('REASONING_PREFIX');
 if(content.startsWith('```'))return fail('CODE_FENCE');
 let value:unknown;try{value=JSON.parse(content);}catch{return fail('JSON_SYNTAX');}
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('JSON_OBJECT');
 return {value,usage:response.usage as {prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}|undefined};
}
