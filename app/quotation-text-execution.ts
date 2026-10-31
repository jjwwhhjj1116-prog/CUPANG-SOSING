import {translationConfiguration,type TranslationSecrets} from '@/app/automation/translation';
import {WORKERS_QWEN_MODEL,parseWorkersQwenJson} from '@/app/automation/workers-qwen-contract';

export const LEGACY_QUOTATION_TEXT_MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export type QuotationTextExecution={version:1;model:typeof WORKERS_QWEN_MODEL;protocol:'qwen-chat-json-v1';maxOutputTokens:number;
 textMaxOutputTokens:number;enableGate:'legacy-quotation-free-only-v1';budget:'shared-utc-40-v1'};
export type QuotationTextEnvironment=TranslationSecrets&{SOURCEFLOW_QUOTATION_AI_PROVIDER?:string;SOURCEFLOW_QUOTATION_AI_FREE_ONLY?:string};
const exact=(value:unknown,keys:string):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
export function validQuotationTextExecution(value:unknown):value is QuotationTextExecution{
 return exact(value,'budget,enableGate,maxOutputTokens,model,protocol,textMaxOutputTokens,version')&&value.version===1&&value.model===WORKERS_QWEN_MODEL
  &&value.protocol==='qwen-chat-json-v1'&&value.enableGate==='legacy-quotation-free-only-v1'&&value.budget==='shared-utc-40-v1'
  &&Number.isSafeInteger(value.textMaxOutputTokens)&&Number(value.textMaxOutputTokens)>=256&&Number(value.textMaxOutputTokens)<=8000
  &&value.maxOutputTokens===Math.min(Number(value.textMaxOutputTokens),4096);
}
/** Keep the historical enable flag and UTC shared-call cap. This flag does not
 * prove a Cloudflare billing plan or guarantee that provider usage is free. */
export function quotationTextConfiguration(settings:QuotationTextEnvironment){
 const enabled=settings.SOURCEFLOW_QUOTATION_AI_PROVIDER==='workers-ai'&&settings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY==='true'&&typeof settings.AI?.run==='function';
 const text=translationConfiguration(settings),workers=settings.SOURCEFLOW_TEXT_PROVIDER==='workers-ai';
 const qwen=workers&&text.model===WORKERS_QWEN_MODEL;
 const executionPolicy:QuotationTextExecution|null=qwen&&text.configured&&text.maxOutputTokens!==null?{version:1,model:WORKERS_QWEN_MODEL,protocol:'qwen-chat-json-v1',
  maxOutputTokens:Math.min(text.maxOutputTokens,4096),textMaxOutputTokens:text.maxOutputTokens,enableGate:'legacy-quotation-free-only-v1',budget:'shared-utc-40-v1'}:null;
 return {configured:enabled&&(!workers||text.configured),model:qwen?WORKERS_QWEN_MODEL:LEGACY_QUOTATION_TEXT_MODEL,executionPolicy};
}
export function quotationTextModel(policy?:QuotationTextExecution|null){
 if(policy!==undefined&&policy!==null&&!validQuotationTextExecution(policy))throw Error('Invalid quotation text execution policy');
 return policy?.model??LEGACY_QUOTATION_TEXT_MODEL;
}
export function sameQuotationTextExecution(left:QuotationTextExecution|null|undefined,right:QuotationTextExecution|null|undefined){
 return JSON.stringify(left??null)===JSON.stringify(right??null);
}
export function quotationTextProviderInput(input:Record<string,unknown>,policy?:QuotationTextExecution|null):Record<string,unknown>{
 quotationTextModel(policy);if(!policy)return input;
 // Use the already deployed Qwen chat/JSON contract. Runtime field validation
 // remains authoritative; reasoning is never output and no model fallback runs.
 const plain={...input};delete plain.response_format;
 const messages=input.messages as {role:string;content:string}[];
 return {...plain,messages:messages.map(message=>message.role==='user'?{...message,content:message.content+'\n/no_think'}:message),max_tokens:policy.maxOutputTokens,stream:false};
}
export function quotationTextProviderResponse(payload:unknown,policy:QuotationTextExecution):{response:string}{
 quotationTextModel(policy);parseWorkersQwenJson(payload);
 const raw=payload as {choices:{message:{content:string}}[]};
 // Preserve the original JSON text for the core duplicate-key validator.
 const response=raw.choices[0].message.content.trim().replace(/^<think>[\t\n\r ]*<\/think>[\t\n\r ]*/u,'');
 return {response};
}
