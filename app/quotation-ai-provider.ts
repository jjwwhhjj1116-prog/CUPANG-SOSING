import {QuotationAiError} from '@/app/quotation-ai';
import type {QuotationAiProvider,QuotationAiField,QuotationAiTarget} from '@/app/quotation-ai';

/** Constrain provider output before generation, while retaining the core's
 * independent exact-wire/type/manual-value validation afterwards. */
export function quotationAiProviderInput(input: Parameters<QuotationAiProvider['run']>[1]) {
  const request=JSON.parse(input.messages[1].content) as {task:string;fields:QuotationAiField[];targets?:QuotationAiTarget[]};
  const object=(properties:Record<string,unknown>,required:string[])=>({type:'object',properties,required,additionalProperties:false});
  const changes=(fields:QuotationAiField[])=>({type:'array',maxItems:fields.length,items:fields.length?{anyOf:fields.map(field=>object({
    fieldKey:{type:'string',enum:[field.id]},value:field.choices?{type:'string',enum:field.choices.map(choice=>choice.value)}:{type:'string',...(field.required?{minLength:1}:{}),maxLength:Math.min(field.maxLength??1000,1000)},
  },['fieldKey','value']))}:{type:'object',additionalProperties:false}});
  let schema:unknown;
  if(request.task==='ANALYZE_SCHEMA_ATTRIBUTES')schema=object({differentiatedFieldIds:{type:'array',maxItems:request.fields.length,items:{type:'string',enum:request.fields.map(field=>field.id)}}},['differentiatedFieldIds']);
  else if(['GET_COMMON_UNEXPOSED_ATTRIBUTES','GET_COMMON_OTHER_ATTRIBUTES'].includes(request.task))schema=object({changes:changes(request.fields)},['changes']);
  else if(/^GET_DIFFERENTIATED_ATTRIBUTES_BATCH_\d+$/.test(request.task)&&request.targets?.length)schema=object({options:{type:'array',minItems:request.targets.length,maxItems:request.targets.length,
    items:{anyOf:request.targets.map(target=>object({optionId:{type:'string',enum:[target.optionId]},changes:changes(request.fields.filter(field=>target.writableFieldIds.includes(field.id)))},['optionId','changes']))}}},['options']);
  else throw new QuotationAiError('AI_PROVIDER_INPUT','견적 AI의 작성 단계를 확인하지 못했습니다.');
  return {...input,messages:input.messages.map((message,index)=>index===0?{...message,content:message.content+' choices.label은 화면 문구입니다. value에는 choices.value의 정확한 문자열만 사용하세요. 근거가 없는 항목은 changes에서 생략하세요. 출력 예시의 안내 문구를 실제 값으로 넣지 마세요.'}:message),
    response_format:{type:'json_schema',json_schema:schema}};
}

/** Normalize the authenticated Workers AI envelope, not the model's JSON.
 * Current Workers AI returns both response and OpenAI-compatible choices.
 * The proposal parser still checks the complete inner JSON and exact keys. */
export function quotationAiProviderResponse(value: unknown): {response: string} {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new QuotationAiError('AI_PROVIDER_RESPONSE','견적 AI 제공자의 응답 형식을 확인하지 못했습니다.');
  const envelope=value as Record<string,unknown>;
  let response=typeof envelope.response==='string'?envelope.response:envelope.response&&typeof envelope.response==='object'&&!Array.isArray(envelope.response)?JSON.stringify(envelope.response):null;
  if(response===null||new TextEncoder().encode(response).length>64*1024)
    throw new QuotationAiError('AI_PROVIDER_RESPONSE','견적 AI 제공자의 본문을 확인하지 못했습니다.');
  if(envelope.tool_calls!==undefined&&(!Array.isArray(envelope.tool_calls)||envelope.tool_calls.length))
    throw new QuotationAiError('AI_PROVIDER_RESPONSE','견적 AI에 도구 실행 응답은 허용하지 않습니다.');
  if(envelope.choices!==undefined){
    const choices=envelope.choices as {message?:{role?:unknown;content?:unknown;tool_calls?:unknown};finish_reason?:unknown}[];
    if(!Array.isArray(choices)||choices.length!==1||choices[0]?.message?.role!=='assistant'||typeof choices[0].message.content!=='string'
      ||choices[0].finish_reason!=='stop'||choices[0].message.tool_calls!==undefined&&(!Array.isArray(choices[0].message.tool_calls)||choices[0].message.tool_calls.length))
      throw new QuotationAiError('AI_PROVIDER_RESPONSE','견적 AI의 단일 완료 본문이 일치하지 않습니다.');
    const content=choices[0].message.content;
    let matches=false;try{matches=typeof envelope.response==='string'?content===response:JSON.stringify(JSON.parse(content))===response;}catch{ /* Never extract a JSON substring from prose. */ }
    if(!matches)throw new QuotationAiError('AI_PROVIDER_RESPONSE','견적 AI의 완료 본문과 구조화 결과가 다릅니다.');
    response=content; // Retain original text for duplicate-key validation in the core.
  }
  return {response};
}
