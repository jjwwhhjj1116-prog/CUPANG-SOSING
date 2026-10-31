// Evidence from the isolated app content script, never a page-supplied flag.
export const CONFIGURED_CONSENT_FORMAT='yoofam-configured-registration-authorization-v1';
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const kinds={productPage:'price-data',imagePage:'label-contact'};
export function configuredConsentProofValid(proof,{identity,identityDigest,packetDigest,requestId,docId,challenge}){
  if(!object(challenge)||!Array.isArray(challenge.items)||!exact(proof,['format','kind','intentId','startedAt','expiresAt','checkedAt','ownerId','company','actor','connectionId','connectionRevision','identityDigest','packetDigest','requestId','docId','challengeId','stage','policies'])
    ||proof.format!==CONFIGURED_CONSENT_FORMAT||proof.kind!=='configured-policy'||!uuid(proof.intentId)||!uuid(proof.connectionId)
    ||!Number.isSafeInteger(proof.startedAt)||proof.startedAt<=0||proof.expiresAt!==proof.startedAt+900000
    ||!Number.isSafeInteger(proof.checkedAt)||proof.checkedAt<proof.startedAt||proof.checkedAt>=proof.expiresAt
    ||proof.checkedAt<challenge.issuedAt||proof.checkedAt>challenge.expiresAt
    ||proof.ownerId!==identity.ownerId||!same(proof.company,identity.company)||proof.identityDigest!==identityDigest||proof.packetDigest!==packetDigest
    ||proof.requestId!==requestId||!same(proof.docId,docId)||proof.challengeId!==challenge.id||proof.stage!==challenge.stage
    ||!Number.isSafeInteger(proof.connectionRevision)||proof.connectionRevision<1
    ||!exact(proof.actor,['email','role','credentialVersion'])||typeof proof.actor.email!=='string'||!proof.actor.email||proof.actor.email.length>254
    ||!['admin','member'].includes(proof.actor.role)||proof.actor.credentialVersion!==null&&(!Number.isSafeInteger(proof.actor.credentialVersion)||proof.actor.credentialVersion<0)
    ||!Array.isArray(proof.policies)||Object.keys(proof.policies).length!==proof.policies.length)return false;
  const expected=kinds[challenge.stage]?[kinds[challenge.stage]]:challenge.stage==='logisticsPage'&&challenge.items.length===0?['price-data','label-contact']:[];
  return expected.length>0&&proof.policies.length===expected.length&&proof.policies.every((policy,index)=>exact(policy,['kind','revision','termsSha256'])
    &&policy.kind===expected[index]&&Number.isSafeInteger(policy.revision)&&policy.revision>=1&&hash(policy.termsSha256));
}
export function configuredFinalMatchesStages(proof,stages){
  return Array.isArray(stages)&&stages.length===2&&stages.every((entry,index)=>{
    const prior=entry.consentProof;
    return prior?.kind==='configured-policy'&&prior.intentId===proof.intentId&&prior.connectionId===proof.connectionId&&prior.connectionRevision===proof.connectionRevision
      &&prior.startedAt===proof.startedAt&&prior.expiresAt===proof.expiresAt&&same(prior.actor,proof.actor)&&same(prior.policies,[proof.policies[index]]);
  });
}
