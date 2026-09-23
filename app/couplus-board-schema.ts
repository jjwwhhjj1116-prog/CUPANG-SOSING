import type { QuotationField } from '@/app/quotation-schema';

// Couplus rendered saved quotation, 2026-09-23. These are UI choices, not verified Supplier Hub wire values.
const labels: [string,string,string[]?][] = [
 ['width','가로길이'],['length','세로길이'],['foldable','접이식 가능여부',['접이식가능']],
 ['magnetic','자석 부착가능 여부',['자석부착가능']],['doubleSided','양면사용 가능여부',['양면사용가능']],
 ['duration','사용시간'],['maxPlayers','최대사용인원'],['minimumAge','최소 연령'],
 ['stoneKind','바둑알 종류',['소석','정석','봉황','기성','명석','장석 1호','장석 2호','장석 3호','장석 3호 특']],
 ['genre','보드게임 장르',['가족','전략','추리','퍼즐','교육(학습)']],['language','사용언어'],
 ['theme','테마',['K-pop','꽃','동물','레인보우','만화','사랑','슈퍼히어로','스포츠','음악','영화','할로윈','파티','알파벳','식물','크리스마스','겨울','음식','휴가','국가','트로피칼','전통','앤티크','웨딩','해당없음','가계도','견적','공포','과학','괴물','국기','군대','기내의 아기','기독교','낚시','농구','눈송이','도시','동기 부여','두개골','미적','미학','밈','비디오 게임','산','소방관','스타','아기','애국','영감','웃는 얼굴','의료 및 건강','의사','전화','정글','정신 건강','종교','지도','책 같은','초자연적','축구','텔레비전 쇼','항해','헨타이 번호','리본','미용','나비','과일','곰','하트','티니핑','라인','네일 아트']],
 ['components','포함 구성 요소',['갓','나사','리모콘','반사판','배터리','본품','설명서','스탠드','어댑터','전구','전원 케이블','조광기','콘센트','해당없음','On-Off 스위치','USB포트','어플리케이터 브러시','주걱','추출 도구']],
 ['gtin','Global Trade Item Number'],['parentPart','Parent Manufacturer Part Number'],['part','Manufacturer Part Number'],
];
export const couplus77442Path=['완구/취미','보드게임','바둑/체스/윷놀이','바둑','바둑알+바둑판'];
const make=(id:string,label:string,section:QuotationField['section'],visibility:QuotationField['visibility']):QuotationField=>({id,label,section,visibility,type:'text',required:false,reviewRequired:true,maxLength:2000,help:'쿠플러스 저장 견적 화면에서 확인한 항목입니다. Supplier Hub 공식 입력 규격과 자동 기본값은 추가 대조가 필요합니다.'});
export const couplus77442Fields:QuotationField[]=[
 ...[['color','색상'],['quantity','수량']].map(([id,label])=>make(id,label,'product','exposed')),
 ...labels.map(([id,label,values])=>({...make(`board_${id}`,label,'product','hidden'),...(values?{type:'select' as const,choices:['해당사항없음',...values].map(value=>({value,label:value}))}:{})})),
 ...[['noticeNameModel','품명 및 모델명'],['noticePermission','인증/허가 사항'],['noticeCountryOfOrigin','제조국(원산지)'],['noticeManufacturerImporter','제조자(수입자)'],['noticeServiceContact','소비자상담 관련 전화번호']].map(([id,label])=>make(id,label,'legal','common')),
];
