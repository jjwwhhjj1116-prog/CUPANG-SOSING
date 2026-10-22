/** Cloudflare model-specific chat contract; never extract JSON from reasoning. */
export const WORKERS_QWEN_MODEL='@cf/qwen/qwen3-30b-a3b-fp8';
export function parseWorkersQwenJson(payload:unknown):{value:unknown;usage?:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}}{
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>512*1024)throw Error('Invalid Qwen envelope');
 const response=payload as Record<string,unknown>;
 if(Object.hasOwn(response,'response')||response.object!==undefined&&response.object!=='chat.completion'
  ||response.model!==undefined&&response.model!==WORKERS_QWEN_MODEL&&response.model!=='qwen3-30b-a3b-fp8'
  ||!Array.isArray(response.choices)||response.choices.length!==1)throw Error('Invalid Qwen completion');
 const choice=response.choices[0];
 if(!choice||typeof choice!=='object'||Array.isArray(choice)||choice.index!==undefined&&choice.index!==0
  ||choice.finish_reason!==undefined&&choice.finish_reason!=='stop')throw Error('Incomplete Qwen completion');
 const message=choice.message;
 if(!message||typeof message!=='object'||Array.isArray(message)||message.role!=='assistant'||typeof message.content!=='string'
  ||!message.content.trim()||message.content.length>256*1024||message.tool_calls?.length||message.refusal)throw Error('Invalid Qwen content');
 // Only the documented assistant content is parsed. reasoning_content and
 // transport metadata are neither retained nor used to repair a bad result.
 const value=JSON.parse(message.content);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid Qwen JSON object');
 return {value,usage:response.usage as {prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}|undefined};
}
