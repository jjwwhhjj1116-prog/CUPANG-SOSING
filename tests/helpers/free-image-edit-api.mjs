import fs from 'node:fs';
import ts from 'typescript';
import { createHash } from 'node:crypto';

const url = new URL('../free-image-quotation-linkage.test.mjs', import.meta.url), source = fs.readFileSync(url, 'utf8'),
  ast = ts.createSourceFile('free-image-quotation-linkage.test.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), declarations = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text, resolved = name.startsWith('.') ? new URL(name, url).href : import.meta.resolve(name);
    declarations.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  } else if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) declarations.push(statement.getText(ast));
  else break;
}
const { fixture, png } = await import('data:text/javascript,' + encodeURIComponent(declarations.join('\n') + '\nexport { fixture, png };'));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function freeImageEditFixture(company) {
  const f = await fixture({ company, withMain: true });
  const now = new Date().toISOString(), email = company.code === 'A01526306' ? 'jwhj1116@kakao.com' : 'unari8484@gmail.com';
  f.h.sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner', email, 'fixture-not-a-password', company.code === 'A01526306' ? 'admin' : 'member', 'approved', company.code, company.name, now, now, null);
  const doc = () => ({ format: 'free-image-edit-v1', width: 3, height: 2, sourceLanguage: 'zh', regions: [
    { id: 'text-1', text: '原 文\n', translated: ' 직접 수정\n문구 ', box: { x: 0, y: 0, width: 3, height: 2 }, confidence: 80, selected: true,
      issue: null, translationProvenance: 'manual', background: '#ffffff', foreground: '#010203', fontSize: 1, fontFamily: 'mono', bold: true, italic: false, textAlign: 'center', lineHeight: 1.2 },
    { id: 'brush-1', text: '', translated: '', box: { x: 0, y: 0, width: 2, height: 2 }, confidence: 0, selected: true,
      issue: null, translationProvenance: 'empty', background: '#abcdef', foreground: '#000000', fontSize: 1, erase: true, brush: { size: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } },
  ] });
  const applyEdit = (source, editDocument, bytes = png(90), extras = {}) => {
    const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(source)); form.set('file', new File([bytes], 'edited.png', { type: 'image/png' }));
    if (editDocument !== undefined) { form.set('editDocument', JSON.stringify(editDocument)); if (editDocument.crop) form.set('crop', JSON.stringify(editDocument.crop)); }
    for (const [key, value] of Object.entries(extras)) form.set(key, value);
    return f.h.load('app/api/products/[id]/image-text/route.ts').POST(new Request('https://app.test' + f.base + '/image-text', { method: 'POST', body: form }), { params: Promise.resolve({ id: f.id }) });
  };
  const recoverEdit = (source, editDocument, bytes = png(90)) => f.post({ action: 'recover', source, outputSha256: sha(bytes), outputBytes: bytes.length,
    ...(editDocument ? { editDocument, ...(editDocument.crop ? { crop: editDocument.crop } : {}) } : {}) });
  const reopen = (key, changes = {}) => {
    const target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.before.resolved.schema.fields, 'additionalImages');
    const query = new URLSearchParams({ sourceKey: key, role: 'additional', target: 'quotation', profileId: f.profile.id, optionId: f.selected, fieldKey: target.primary, slotIndex: '1', editor: 'saved', ...changes });
    return f.h.load('app/api/products/[id]/image-text/route.ts').GET(new Request('https://app.test' + f.base + '/image-text?' + query), { params: Promise.resolve({ id: f.id }) });
  };
  return { ...f, doc, applyEdit, recoverEdit, reopen, png };
}
