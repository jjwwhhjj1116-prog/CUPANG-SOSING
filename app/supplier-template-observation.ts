// Read-only browser observation on 2026-09-24. A matching leaf label is not proof of Excel compatibility.
export function supplierTemplateObservation(categoryId: string) {
  if (categoryId === '81467') return {
    observedAt: '2026-09-28',
    registrationPath: ['스포츠/레져', '헬스/요가', '요가/필라테스용품', '요가매트'],
    downloadPath: ['스포츠/레저용품', '헬스/요가', '요가/필라테스', '요가매트'],
    url: 'https://supplier.coupang.com/qvt/registration',
    excelVerified: false,
    downloadCategoryId: null,
  } as const;
  if (categoryId !== '80719') return null;
  return {
    observedAt: '2026-09-28',
    registrationPath: ['주방용품', '주방수납/정리', '주방수납바구니/바스켓'],
    downloadPath: ['주방용품', '주방수납/잡화', '건조대/진열대/정리대', '주방수납바구니/바스켓'],
    url: 'https://supplier.coupang.com/qvt/registration',
    excelVerified: true,
    downloadCategoryId: '6269',
  } as const;
}
