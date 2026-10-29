/** Material claims need original product evidence; a category or generated
 * product name cannot establish them. Context-only cotton matching avoids
 * interpreting ordinary Korean words such as '표면' as a cotton claim. */
const materials:readonly{name:string;output:RegExp;evidence:RegExp}[]=[
 {name:'실리콘',output:/실리콘|silicone/iu,evidence:/硅胶|silicone|실리콘/iu},
 {name:'스테인리스',output:/스테인리스|stainless/iu,evidence:/不锈钢|stainless|스테인리스/iu},
 {name:'폴리에스테르',output:/폴리에스테르|polyester/iu,evidence:/聚酯|涤纶|polyester|폴리에스테르/iu},
 {name:'나일론',output:/나일론|nylon/iu,evidence:/尼龙|nylon|나일론/iu},
 {name:'천연가죽',output:/천연가죽|genuine\s+leather/iu,evidence:/真皮|genuine\s+leather|천연가죽/iu},
 {name:'인조가죽',output:/인조가죽|synthetic\s+leather/iu,evidence:/人造革|仿皮|合成革|synthetic\s+leather|인조가죽/iu},
 {name:'면',output:/순면|면\s*(?:소재|원단|혼방)|cotton|코튼/iu,evidence:/纯棉|棉(?:布|纱|纤维|质|花|混纺)|cotton|코튼|순면|(?:^|[\s:：,%])棉(?:$|[\s,\/])|(?:^|[\s:：,])면(?:$|[\s,]|혼방|소재|원단)/imu},
 {name:'스펀지',output:/스펀지|sponge/iu,evidence:/海绵|海綿|泡棉|sponge|스펀지/iu},
 {name:'양모',output:/양모|wool|울\s*(?:소재|원단|혼방)/iu,evidence:/羊毛|wool|양모|(?:^|[\s:：,])울(?:$|[\s,]|혼방|소재|원단)/imu},
 {name:'폴리우레탄',output:/폴리우레탄|polyurethane|(?:^|[^a-z])PU(?:$|[^a-z])/iu,evidence:/聚氨酯|polyurethane|폴리우레탄|(?:^|[^a-z])PU(?:$|[^a-z])/iu},
 {name:'스판덱스',output:/스판덱스|엘라스테인|spandex|elastane/iu,evidence:/氨纶|spandex|elastane|스판덱스|엘라스테인/iu},
 {name:'플라스틱',output:/플라스틱|plastic/iu,evidence:/塑料|plastic|플라스틱/iu},
];
export function unsupportedProductMaterial(output:string,source:string,materialField=false):string|null{
 let recognized=false;
 for(const material of materials){
  const claimed=material.output.test(output)||materialField&&material.name==='면'&&/(?:^|[\s,\/·(])면(?:$|[\s,\/·)])/u.test(output);
  if(claimed)recognized=true;
  if(claimed&&!material.evidence.test(source))return material.name;
 }
 if(materialField&&!recognized&&!source.includes(output.trim()))return output.trim();
 return null;
}
