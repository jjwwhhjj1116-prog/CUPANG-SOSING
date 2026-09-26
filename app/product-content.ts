export const CONTENT_BODY_LIMIT = 96 * 1024;
export const labelFields = {
  productName: '품명', model: '모델명', material: '재질', dimensions: '크기·중량',
  manufacturer: '제조사', importer: '수입·판매원', countryOfOrigin: '제조국',
  contact: 'A/S 책임자·연락처', certification: '인증·허가 사항', precautions: '취급·사용 주의사항',
  qualityAssurance: '품질보증기준', components: '제품 구성품', releaseDate: '출시년월', productType: '상품 유형',
  netContents: '내용량', usageStandard: '사용 기준', kcInformation: 'KC 인증정보', specifications: '상품별 세부 사양',
} as const;
export const assetRoles = { main: '대표 이미지', additional: '추가 이미지', detailTop: '상세 상단 이미지', detail: '상세 이미지', detailBottom: '상세 하단 이미지', size: '사이즈표', label: '한글 표시사항' } as const;
export type LabelField = keyof typeof labelFields;
export const CUSTOM_LABEL_LIMIT = 20;
export type CustomLabel = { id: string; name: string; value: string; visible: boolean };
export type LabelLayout = { order: LabelField[]; hidden: LabelField[] };
export function currentLabelLayout(layout?: LabelLayout): LabelLayout {
  const keys=Object.keys(labelFields) as LabelField[];
  return {order:[...new Set([...(layout?.order??[]).filter(key=>keys.includes(key)),...keys])],hidden:[...new Set((layout?.hidden??[]).filter(key=>keys.includes(key)))]};
}
export function moveLabelField(layout: LabelLayout, key: LabelField, offset: -1|1): LabelLayout {
  const next=currentLabelLayout(layout);const index=next.order.indexOf(key);const target=index+offset;
  if(index>=0&&target>=0&&target<next.order.length)[next.order[index],next.order[target]]=[next.order[target],next.order[index]];
  return next;
}
export function labelDocumentRows(content: ProductContent): [string,string,string][] {
  const layout=currentLabelLayout(content.labelLayout);
  return [...layout.order.filter(key=>!layout.hidden.includes(key)).map((key):[string,string,string]=>[key,labelFields[key],content.label[key]?.value??'']),
    ...(content.customLabels??[]).filter(item=>item.visible).map((item):[string,string,string]=>[item.id,item.name,item.value])];
}
export type AssetRole = keyof typeof assetRoles;
export type ContentField<T> = { value: T; provenance: 'unverified' | 'collected' | 'translated' | 'generated' | 'manual'; updatedAt: string | null };
/** A deliberately cleared saved value must not resurrect a workspace default. */
export function savedTextOrFallback(field: ContentField<string>, fallback = ''): string {
  return field.provenance === 'manual' ? field.value : field.value || fallback;
}
export type ProductContent = {
  schemaVersion: 1; productId: string; revision: number; updatedAt: string | null;
  seo: { title: ContentField<string>; keywords: ContentField<string[]>; description: ContentField<string> };
  label: Record<LabelField, ContentField<string>>;
  labelLayout?: LabelLayout;
  customLabels?: CustomLabel[];
  assets: Record<AssetRole, ContentField<string[]>>;
};
export type ContentPatch = {
  seo?: { title?: string; keywords?: string[]; description?: string };
  label?: Partial<Record<LabelField, string>>;
  labelLayout?: LabelLayout;
  customLabels?: CustomLabel[];
  assets?: Partial<Record<AssetRole, string[]>>;
};

const fresh = <T,>(value: T): ContentField<T> => ({ value, provenance: 'unverified', updatedAt: null });
export function emptyProductContent(productId: string): ProductContent {
  return {
    schemaVersion: 1, productId, revision: 0, updatedAt: null,
    seo: { title: fresh(''), keywords: fresh<string[]>([]), description: fresh('') },
    label: Object.fromEntries(Object.keys(labelFields).map(key => [key, fresh('')])) as ProductContent['label'],
    assets: Object.fromEntries(Object.keys(assetRoles).map(key => [key, fresh<string[]>([])])) as ProductContent['assets'],
  };
}

/** Add only newly introduced fields to old saved documents without changing revisions or facts. */
export function withCurrentLabelFields(content: ProductContent): ProductContent {
  const defaults = emptyProductContent(content.productId);
  return { ...content, label: { ...defaults.label, ...content.label }, assets: { ...defaults.assets, ...content.assets } };
}

/** Shared ordering for previews and quotation attachments; legacy documents have no banners. */
export function detailImageKeys(assets: Partial<Record<AssetRole, readonly string[]>>): string[] {
  return [...(assets.detailTop ?? []), ...(assets.detail ?? []), ...(assets.detailBottom ?? [])];
}
export function contentDetailImageKeys(content: ProductContent): string[] {
  return detailImageKeys(Object.fromEntries(Object.entries(content.assets).map(([key, field]) => [key, field.value])));
}

function object(value: unknown, allowed: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 객체가 필요합니다.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key))) throw new Error(`${name}에 지원하지 않는 항목이 있습니다.`);
  return record;
}
function plainText(value: unknown, max: number, name: string) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error(`${name}은 ${max}자 이내의 텍스트로 입력해주세요.`);
  // Store plain text only; any downstream HTML export must escape these values.
  return value.trim();
}

export function validateContentInput(input: unknown, ownedKeys: readonly string[], ownerId: string): { expectedRevision: number; patch: ContentPatch } {
  const body = object(input, ['expectedRevision', 'patch'], '콘텐츠 요청');
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) throw new Error('저장 버전을 다시 불러와주세요.');
  const raw = object(body.patch, ['seo', 'label', 'assets', 'labelLayout', 'customLabels'], '편집 내용');
  const patch: ContentPatch = {};
  if('customLabels' in raw){
    if(!Array.isArray(raw.customLabels)||raw.customLabels.length>CUSTOM_LABEL_LIMIT)throw new Error(`추가 표시사항은 최대 ${CUSTOM_LABEL_LIMIT}개입니다.`);
    const ids=new Set<string>();
    patch.customLabels=raw.customLabels.map(value=>{
      const row=object(value,['id','name','value','visible'],'추가 표시사항');
      if(typeof row.id!=='string'||!/^custom-[A-Za-z0-9_-]{1,80}$/.test(row.id)||ids.has(row.id))throw new Error('추가 표시사항 ID가 잘못되었거나 중복되었습니다.');
      ids.add(row.id);const name=plainText(row.name,80,'항목명');
      if(!name)throw new Error('추가 표시사항 항목명을 입력해주세요.');
      if(typeof row.visible!=='boolean')throw new Error('추가 표시사항 표시 여부를 확인해주세요.');
      return{id:row.id,name,value:plainText(row.value,2000,'추가 표시사항 내용'),visible:row.visible};
    });
  }
  if ('labelLayout' in raw) {
    const layout=object(raw.labelLayout,['order','hidden'],'표시사항 배치');
    const read=(name:'order'|'hidden'):LabelField[]=>{
      const values=layout[name];
      if(!Array.isArray(values)||values.length>Object.keys(labelFields).length||new Set(values).size!==values.length||values.some(key=>typeof key!=='string'||!Object.hasOwn(labelFields,key)))throw new Error('표시사항 배치 항목이 잘못되었거나 중복되었습니다.');
      return [...values] as LabelField[];
    };
    patch.labelLayout=currentLabelLayout({order:read('order'),hidden:read('hidden')});
  }
  if ('seo' in raw) {
    const seo = object(raw.seo, ['title', 'keywords', 'description'], 'SEO');
    patch.seo = {};
    if ('title' in seo) patch.seo.title = plainText(seo.title, 500, '상품명');
    if ('description' in seo) patch.seo.description = plainText(seo.description, 20000, '상품 설명');
    if ('keywords' in seo) {
      if (!Array.isArray(seo.keywords) || seo.keywords.length > 50) throw new Error('검색어는 최대 50개입니다.');
      patch.seo.keywords = [...new Set(seo.keywords.map(value => plainText(value, 100, '검색어')).filter(Boolean))];
    }
  }
  if ('label' in raw) {
    const label = object(raw.label, Object.keys(labelFields), '표시사항');
    patch.label = {};
    for (const key of Object.keys(label) as LabelField[]) patch.label[key] = plainText(label[key], 2000, labelFields[key]);
  }
  if ('assets' in raw) {
    const assets = object(raw.assets, Object.keys(assetRoles), '이미지 역할');
    patch.assets = {};
    for (const key of Object.keys(assets) as AssetRole[]) {
      const values = assets[key];
      if (!Array.isArray(values) || values.length > (['main', 'detailTop', 'detailBottom'].includes(key) ? 1 : 30)) throw new Error(`${assetRoles[key]} 개수를 확인해주세요.`);
      patch.assets[key] = values.map(value => {
        if (typeof value !== 'string' || value.length > 512 || !value.startsWith(`${ownerId}/`) || !ownedKeys.includes(value)) throw new Error('이 상품에 업로드한 본인 소유 이미지만 지정할 수 있습니다.');
        return value;
      });
    }
  }
  if (!Object.hasOwn(patch,'customLabels')&&!Object.values(patch).some(value => Object.keys(value).length)) throw new Error('저장할 편집 내용이 없습니다.');
  return { expectedRevision: body.expectedRevision as number, patch };
}

export function applyContentPatch(current: ProductContent, patch: ContentPatch, now: string): ProductContent {
  current = withCurrentLabelFields(current);
  const next = structuredClone(current);
  if(patch.labelLayout)next.labelLayout=structuredClone(patch.labelLayout);
  if(patch.customLabels!==undefined)next.customLabels=structuredClone(patch.customLabels);
  function edited<T>(previous: ContentField<T>, value: T): ContentField<T> {
    return JSON.stringify(previous.value) === JSON.stringify(value) ? previous : { value, provenance: 'manual', updatedAt: now };
  }
  if (patch.seo) {
    if (patch.seo.title !== undefined) next.seo.title = edited(current.seo.title, patch.seo.title);
    if (patch.seo.description !== undefined) next.seo.description = edited(current.seo.description, patch.seo.description);
    if (patch.seo.keywords !== undefined) next.seo.keywords = edited(current.seo.keywords, patch.seo.keywords);
  }
  for (const key of Object.keys(patch.label ?? {}) as LabelField[]) next.label[key] = edited(current.label[key], patch.label![key]!);
  for (const key of Object.keys(patch.assets ?? {}) as AssetRole[]) next.assets[key] = edited(current.assets[key], patch.assets![key]!);
  const keys = Object.values(next.assets).flatMap(field => field.value);
  if (keys.length > 50 || new Set(keys).size !== keys.length) throw new Error('이미지는 최대 50개이며 한 파일에는 한 역할만 지정할 수 있습니다.');
  next.revision = current.revision + 1;
  next.updatedAt = now;
  return next;
}

export function productImageKeys(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(key => typeof key !== 'string')) throw new Error('상품 이미지 목록을 읽을 수 없습니다.');
  return parsed as string[];
}
