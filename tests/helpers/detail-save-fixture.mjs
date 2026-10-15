import fs from 'node:fs';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { quotationWorkbook } from './quotation-workbook.mjs';
import { json } from './image-download-ui.mjs';

// Reuse the complete real API/SQLite setup without registering the Step678
// backend tests in a second suite.
const sourceUrl = new URL('../detail-save-api.test.mjs', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile('detail-save-api.test.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text, resolved = name.startsWith('.') ? new URL(name, sourceUrl).href : import.meta.resolve(name);
    parts.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  } else if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) parts.push(statement.getText(ast));
  else break;
}
const { fixture } = await import('data:text/javascript,' + encodeURIComponent(parts.join('\n') + '\nexport { fixture };'));

export async function detailSaveFixture(company, { exactAlt = true, excluded = true } = {}) {
  const f = await fixture(company, { wire: exactAlt, excluded });
  try {
    if (exactAlt) {
      const profiles = f.api.load('db/category-profiles.ts'), profileId = f.view.categoryContext.profileId;
      const previous = await profiles.getCategoryProfile('owner', profileId), live = structuredClone(previous.hubSchema), raw = JSON.parse(live.schemaString);
      raw.properties.imagePage.properties.details.properties.altText = { type: 'string', title: '대체 텍스트' };
      live.schemaString = JSON.stringify(raw);
      const fields = f.api.load('app/quotation-schema.ts').getQuotationSchema(previous.categoryId, previous.categoryPath, live).fields.map(field => field.id);
      const workbook = quotationWorkbook(fields), sha256 = createHash('sha256').update(workbook).digest('hex');
      const storageKey = f.api.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx');
      f.api.objects.set(storageKey, new Uint8Array(workbook));
      const next = await profiles.updateCategoryProfile('owner', profileId, previous.revision, { ...previous, hubSchema: live,
        template: { ...previous.template, sha256, storageKey, headers: fields }, mappings: fields.map((field, column) => ({ field, column, required: false })) });
      const row = f.api.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job'), context = JSON.parse(row.payload);
      context.category = next; f.api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context), 'job');
    }
    f.refresh = async () => { f.view = await json(await f.api.route(f.qurl)); return f.view; };
    await f.refresh();
    // The older fixture's prepare closure intentionally captured its own view.
    // These tests edit real SEO/options before preview, so use the refreshed
    // returned fixture view as the sole preparation basis.
    f.prepare = () => f.runtime.helper.prepareDetailComposite({ productId: f.product.id, optionId: f.optionId,
      profileId: f.view.categoryContext.profileId, view: f.view }, new AbortController().signal, f.request);
    return f;
  } catch (error) { f.api.close(); throw error; }
}

export const detailSaveState = f => JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload);
