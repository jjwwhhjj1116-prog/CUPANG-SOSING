import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Join real parent/child handlers through their production onChoose prop.
// Only hook runners and inert provider fixtures are reused; no test bodies run.
async function declarationsFrom(relative, exported) {
  const url = new URL(relative, import.meta.url), source = fs.readFileSync(url, 'utf8');
  const ast = ts.createSourceFile(url.href, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const code = ast.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isFunctionDeclaration(node))
    .map(node => {
      let value = node.getFullText(ast);
      if (ts.isImportDeclaration(node)) {
        const name = node.moduleSpecifier.text;
        if (!name.startsWith('node:')) value = value.replace("'" + name + "'", JSON.stringify(name.startsWith('.') ? new URL(name, url).href : import.meta.resolve(name)));
      }
      return value;
    }).join('\n').replaceAll('import.meta.url', JSON.stringify(url.href)) + '\nexport {' + exported.join(',') + '};';
  return import('data:text/javascript,' + encodeURIComponent(code));
}
const { setup, schemaCompanies, nodes } = await declarationsFrom('./recommended-category-intake.test.mjs', ['setup', 'schemaCompanies', 'nodes']);
const { fixture, text } = await declarationsFrom('./category-recommendations-panel.test.mjs', ['fixture', 'text']);
const turn = () => new Promise(resolve => setImmediate(resolve));
function coupled(company, options) {
  const parent = setup(company, options), child = fixture(async () => parent.result);
  const props = () => nodes(parent.picker.render()).find(node => node.type?.name === 'CategoryRecommendationsPanel').props;
  child.set(props());
  return { parent, child, sync() { child.set(props()); }, close() { child.close(); parent.close(); } };
}

for (const company of schemaCompanies) test(`${company.code}: real parent lookup failure offers exact candidate retry without predicting again or changing existing work`, async () => {
  let retrying = false;
  const f = coupled(company, { resolve: ({ choice }) => { if (!retrying) throw Error('합성 일시적 카테고리 목록 조회 실패'); return choice; } });
  const { parent: p, child: c } = f;
  try {
    await p.h.intake(); // Isolated existing synthetic work, not a user product.
    const before = p.retained(), objects = JSON.stringify([...p.h.objects]), network = JSON.stringify(p.h.network);
    const sourceBefore = JSON.stringify(p.result), beforeProfiles = p.profileCount();
    await c.advance(600); assert.equal(c.requests.length, 1); assert.equal(c.requests[0].name, '合成保暖护耳帽');
    assert.equal(c.radios()[0].props.checked, false); assert.equal(p.resolutions.length, 0); assert.equal(p.profileCount(), beforeProfiles);
    c.select(p.recommendation.id); await c.settle(); f.sync();
    assert.equal(p.resolutions.length, 1); assert.equal(p.picker.selected.length, 0); assert.equal(p.schemaReads, 0);
    assert.equal(c.radios()[0].props.checked, true); assert.match(text(c.render()), /합성 일시적 카테고리 목록 조회 실패/);
    assert.equal(c.button('선택한 카테고리 다시 적용').props.disabled, false);
    assert.equal(nodes(p.picker.render()).find(node => node.type === 'button' && node.props.children === '선택 완료 · URL 입력').props.disabled, true);
    assert.equal(p.profileCount(), beforeProfiles); assert.equal(p.retained(), before); assert.equal(JSON.stringify([...p.h.objects]), objects);
    await c.advance(1200); assert.equal(p.resolutions.length, 1, 'a failed application is never retried automatically'); assert.equal(c.requests.length, 1);
    const retainedRetry=c.button('선택한 카테고리 다시 적용').props.onClick;
    retrying = true; c.click('선택한 카테고리 다시 적용'); await c.settle(); f.sync();
    assert.equal(p.resolutions.length, 2); assert.equal(c.requests.length, 1, 'retry verifies the selected candidate instead of predicting again');
    assert.ok(p.resolutions.every(call => call.item === p.recommendation && call.envelope === p.result && call.ownerId === 'owner'));
    assert.equal(p.picker.selected.length, 1); assert.equal(p.profileCount(), beforeProfiles + 1); assert.equal(p.schemaReads, 1); assert.equal(p.excelReads, 0);
    assert.equal(c.button('선택한 카테고리 다시 적용'), undefined);
    assert.equal(p.picker.selected[0].categoryId, p.recommendation.code); assert.equal(p.picker.selected[0].hubSchema.company.code, company.code);
    const retainedRadio=c.radios()[0].props.onChange;
    p.picker.setProps({profiles:[p.picker.selected[0]]});f.sync();
    retainedRetry();retainedRadio();await c.settle();await c.advance(1200);
    assert.equal(p.resolutions.length,2);assert.equal(p.profileCount(),beforeProfiles+1);assert.equal(p.picker.selected.length,1);
    assert.equal(c.requests.length,1,'parent profile refresh after completion cannot reactivate selection or prediction');
    assert.equal(p.retained(), before); assert.equal(JSON.stringify([...p.h.objects]), objects); assert.equal(JSON.stringify(p.h.network), network);
    assert.equal(JSON.stringify(p.result), sourceBefore); assert.equal(p.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n, 0);
  } finally { f.close(); }
});

test('settled failed candidates and captured retry handlers are discarded after profile/category ABA without predicting or saving automatically', async()=>{
  for(const scope of ['profile','category']){
    let retrying=false;
    const f=coupled(schemaCompanies[0],{resolve:({choice})=>{if(!retrying)throw Error('합성 일시 조회 실패');return choice;}}),{parent:p,child:c}=f;
    try{
      const before=p.retained();await c.advance(600);c.select(p.recommendation.id);await c.settle();f.sync();
      const retainedRetry=c.button('선택한 카테고리 다시 적용').props.onClick,retainedRadio=c.radios()[0].props.onChange;
      if(scope==='profile'){
        p.picker.setProps({profiles:[{id:'other-profile',name:'다른 양식',categoryId:'991235',categoryPath:['합성 분류'],revision:1,template:null,mappings:[]}]});f.sync();
        p.picker.setProps({profiles:[]});f.sync();
      }else{p.picker.setProps({selectedId:'other-profile'});f.sync();p.picker.setProps({selectedId:''});f.sync();}
      retrying=true;retainedRetry();retainedRadio();await c.settle();await c.advance(1200);
      assert.equal(c.button('선택한 카테고리 다시 적용'),undefined);assert.equal(c.radios().length,0);assert.match(text(c.render()),/설정이 변경되었습니다/);
      assert.equal(c.requests.length,1);assert.equal(p.resolutions.length,1);assert.equal(p.profileCount(),0);assert.equal(p.picker.selected.length,0);assert.equal(p.retained(),before);
      c.click('↻ 추천 새로고침');await c.settle();assert.equal(c.requests.length,2);assert.equal(c.radios()[0].props.checked,false);
      retainedRetry();retainedRadio();await c.settle();assert.equal(p.resolutions.length,1,'a refreshed identical envelope cannot revive the old handler');
      c.select(p.recommendation.id);await c.settle();f.sync();assert.equal(p.resolutions.length,2);assert.equal(p.picker.selected.length,1);assert.equal(p.profileCount(),1);assert.equal(p.retained(),before);
    }finally{f.close();}
  }
});

test('late lookup failure after owner/source/profile/category ABA or unmount is never promoted into a retry or saved selection', async () => {
  for (const scope of ['owner', 'source', 'profile', 'category', 'unmount']) {
    let rejectLookup;
    const f = coupled(schemaCompanies[0], { resolve: () => new Promise((_resolve, reject) => { rejectLookup = reject; }) });
    const { parent: p, child: c } = f;
    let closed = false;
    try {
      const before = p.retained(), objects = JSON.stringify([...p.h.objects]);
      await c.advance(600); c.select(p.recommendation.id); await c.settle(); assert.equal(p.resolutions.length, 1);
      const signal = p.resolutions[0].signal;
      if (scope === 'owner') {
        p.picker.setProps({ workspaceOwnerId: 'other' }); f.sync(); p.picker.setProps({ workspaceOwnerId: 'owner' }); f.sync();
      } else if (scope === 'source') {
        p.picker.setProps({ sourceTitle: '다른 합성 상품' }); f.sync(); p.picker.setProps({ sourceTitle: p.result.productName }); f.sync();
      } else if (scope === 'profile') {
        p.picker.setProps({ profiles: [{ id: 'other-profile', name: '다른 양식', categoryId: '991235', categoryPath: ['합성 분류'], revision: 1, template: null, mappings: [] }] }); f.sync();
        p.picker.setProps({ profiles: [] }); f.sync();
      } else if (scope === 'category') {
        p.picker.setProps({ selectedId: 'other-profile' }); f.sync(); p.picker.setProps({ selectedId: '' }); f.sync();
      } else { p.picker.close(); c.close(); closed = true; }
      assert.equal(signal.aborted, true, scope);
      rejectLookup(Error('늦게 도착한 이전 조회 실패')); await turn();
      if (!closed) {
        await c.settle(); f.sync(); assert.equal(c.button('선택한 카테고리 다시 적용'), undefined, scope);
        assert.doesNotMatch(text(c.render()), /늦게 도착한/); assert.doesNotMatch(p.picker.alerts().join(' '), /늦게 도착한/);
      }
      assert.equal(p.resolutions.length, 1); assert.equal(p.picker.selected.length, 0); assert.equal(p.schemaReads, 0); assert.equal(p.profileCount(), 0);
      assert.equal(p.retained(), before); assert.equal(JSON.stringify([...p.h.objects]), objects); assert.equal(c.requests.length, 1);
    } finally { if (closed) p.h.close(); else f.close(); }
  }
});

test('retained retry and radio handlers cannot apply an old recommendation after a query ABA, even if the new result has identical strings', async () => {
  let retrying = false;
  const f = coupled(schemaCompanies[1], { resolve: ({ choice }) => { if (!retrying) throw Error('합성 조회 실패'); return choice; } });
  const { parent: p, child: c } = f;
  try {
    const before = p.retained(); await c.advance(600); c.select(p.recommendation.id); await c.settle(); f.sync();
    const retainedRetry = c.button('선택한 카테고리 다시 적용').props.onClick, retainedRadio = c.radios()[0].props.onChange;
    c.type('다른 검색 상품'); c.type(p.result.productName); retrying = true;
    retainedRetry(); retainedRadio(); await c.settle();
    assert.equal(p.resolutions.length, 1); assert.equal(p.profileCount(), 0); assert.equal(p.picker.selected.length, 0); assert.equal(p.retained(), before);
    await c.advance(600); assert.equal(c.requests.length, 2); assert.equal(c.radios()[0].props.checked, false);
    retainedRetry(); retainedRadio(); await c.settle(); assert.equal(p.resolutions.length, 1, 'old generation stays obsolete after a new identical envelope arrives');
    c.select(p.recommendation.id); await c.settle(); f.sync();
    assert.equal(p.resolutions.length, 2); assert.equal(p.picker.selected.length, 1); assert.equal(p.profileCount(), 1);
    assert.equal(c.requests.length, 2); assert.equal(p.retained(), before); assert.equal(p.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n, 0);
  } finally { f.close(); }
});
