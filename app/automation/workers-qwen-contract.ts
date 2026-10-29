/** Cloudflare model-specific chat contract; never extract JSON from reasoning. */
export const WORKERS_QWEN_MODEL='@cf/qwen/qwen3-30b-a3b-fp8';
export type WorkersQwenDiagnostic={finish:'stop'|'length'|'other'|'missing';contentType:'string'|'null'|'other'|'missing';contentLength:number|null;model:'qwen'|'llama'|'other'|'missing';objectKind:'chat'|'text'|'other'|'missing';responseKind:'missing'|'undefined'|'null'|'string'|'object'|'array'|'other'};
export type WorkersQwenFailure='ENVELOPE'|'RESPONSE_SIZE'|'COMPLETION_TYPE'|'MODEL'|'CHOICES'|'CHOICE'|'OUTPUT_TRUNCATED'|'FINISH_REASON'|'MESSAGE'|'CONTENT_SIZE'|'TOOL_OR_REFUSAL'|'REASONING_PREFIX'|'CODE_FENCE'|'JSON_SYNTAX'|'JSON_OBJECT'|'SUPPLEMENTAL_RESPONSE'|'RESPONSE_MISMATCH';
function diagnostic(payload:unknown):WorkersQwenDiagnostic{
 const response=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Record<string,unknown>:null;
 const choice=Array.isArray(response?.choices)?response.choices[0]:null;
 const message=choice&&typeof choice==='object'&&!Array.isArray(choice)?choice.message:null;
 const content=message&&typeof message==='object'&&!Array.isArray(message)?message.content:undefined;
 const finish=choice&&typeof choice==='object'&&!Array.isArray(choice)?choice.finish_reason:undefined;
 return{finish:finish===undefined?'missing':finish==='stop'?'stop':finish==='length'?'length':'other',contentType:content===undefined?'missing':content===null?'null':typeof content==='string'?'string':'other',
  contentLength:typeof content==='string'?Math.min(content.length,512*1024+1):null,
  model:response?.model===undefined?'missing':response.model===WORKERS_QWEN_MODEL||response.model==='qwen3-30b-a3b-fp8'?'qwen':response.model==='@cf/meta/llama-3.3-70b-instruct-fp8-fast'?'llama':'other',
  objectKind:response?.object===undefined?'missing':response.object==='chat.completion'?'chat':response.object==='text_completion'?'text':'other',
  responseKind:!response||!Object.hasOwn(response,'response')?'missing':response.response===undefined?'undefined':response.response===null?'null':Array.isArray(response.response)?'array':typeof response.response==='object'?'object':typeof response.response==='string'?'string':'other'};
}
/** Cross-realm plain JSON objects are valid; classes, accessors, symbols and
 * non-JSON values are not. Sort object keys only; array order stays material. */
function plainObject(value:unknown):value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===null||Object.getPrototypeOf(prototype)===null;}
function canonicalJson(value:unknown,depth=0):string|null{
 if(depth>64)return null;
 if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value)){const rows=[];for(let i=0;i<value.length;i++){const descriptor=Object.getOwnPropertyDescriptor(value,String(i));if(!descriptor||!Object.hasOwn(descriptor,'value'))return null;const row=canonicalJson(descriptor.value,depth+1);if(row===null)return null;rows.push(row);}return '['+rows.join(',')+']';}
 if(!plainObject(value))return null;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);if(keys.some(key=>typeof key!=='string'))return null;
 const rows=[];for(const key of (keys as string[]).sort()){const descriptor=descriptors[key];if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return null;const row=canonicalJson(descriptor.value,depth+1);if(row===null)return null;rows.push(JSON.stringify(key)+':'+row);}return '{'+rows.join(',')+'}';
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
 if(response.object!==undefined&&response.object!=='chat.completion'||Object.hasOwn(response,'response')&&!Object.hasOwn(response,'choices'))return fail('COMPLETION_TYPE');
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
 // Model docs/types define choices as authoritative. JSON Mode also documents
 // a parsed response object. A dual envelope may duplicate the same JSON, but
 // it cannot replace, repair or contradict choices. Undefined is not content.
 // https://developers.cloudflare.com/workers-ai/features/json-mode/
 // https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/
 if(response.response!==undefined){
  const supplemental=plainObject(response.response)?canonicalJson(response.response):null;
  if(supplemental===null)return fail('SUPPLEMENTAL_RESPONSE');
  if(supplemental!==canonicalJson(value))return fail('RESPONSE_MISMATCH');
 }
 return {value,usage:response.usage as {prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}|undefined};
}

/** The standard translation path also accepts the documented JSON Mode
 * parsed response object. Historical recovery keeps its stricter chat-only
 * authority above; neither adapter mines reasoning or repairs model text. */
export function parseWorkersQwenTranslationJson(payload:unknown):ReturnType<typeof parseWorkersQwenJson>{
 if(payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.hasOwn(payload,'choices'))return parseWorkersQwenJson(payload);
 const fail=(reason:WorkersQwenFailure):never=>{throw new WorkersQwenContractError(reason,diagnostic(payload));};
 if(!plainObject(payload))return fail('ENVELOPE');
 const encoded=canonicalJson(payload);if(encoded===null)return fail('ENVELOPE');if(encoded.length>512*1024)return fail('RESPONSE_SIZE');
 if(Object.keys(payload).some(key=>!['response','usage','model'].includes(key)))return fail('ENVELOPE');
 if(payload.model!==undefined&&payload.model!==WORKERS_QWEN_MODEL&&payload.model!=='qwen3-30b-a3b-fp8')return fail('MODEL');
 if(payload.error!==undefined||payload.errors!==undefined||payload.tool_calls!==undefined||payload.refusal!==undefined||payload.reasoning!==undefined||payload.reasoning_content!==undefined)return fail('TOOL_OR_REFUSAL');
 if(!plainObject(payload.response)||canonicalJson(payload.response)===null)return fail('JSON_OBJECT');
 return{value:payload.response,usage:payload.usage as {prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}|undefined};
}
