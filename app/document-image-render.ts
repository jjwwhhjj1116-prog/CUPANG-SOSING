import { MAX_DOCUMENT_HEIGHT, wrapDocumentText, type DocumentImagePlan } from '@/app/document-image';

export async function renderDocument(plan: DocumentImagePlan): Promise<{ blob: Blob; width: number; height: number }> {
  await document.fonts.load('24px "Malgun Gothic"', '한글 표시사항 사이즈표'); await document.fonts.ready;
  const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
  if (!context) throw new Error('이 브라우저에서 문서 이미지를 만들 수 없습니다.');
  const font = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const padding = 40; const lineHeight = 34; const cellPadding = 16;
  context.font = `24px ${font}`;
  const measure = (value: string) => context.measureText(value).width;
  const rows = plan.rows.map(row => row.map((cell, column) => wrapDocumentText(cell, plan.columnWidths[column] - 2 * cellPadding, measure)));
  const heights = rows.map(row => Math.max(64, Math.max(...row.map(cell => cell.length)) * lineHeight + 2 * cellPadding));
  context.font = `20px ${font}`;
  const subtitle = wrapDocumentText(plan.subtitle, plan.width - padding * 2, measure);
  const footer = wrapDocumentText(plan.footer, plan.width - padding * 2, measure);
  const startY = padding + 56 + subtitle.length * 30 + 26;
  const height = startY + 58 + heights.reduce((sum, value) => sum + value, 0) + 34 + footer.length * 30 + padding;
  if (height > MAX_DOCUMENT_HEIGHT) throw new Error(`내용이 길어 이미지 높이가 ${MAX_DOCUMENT_HEIGHT.toLocaleString('ko-KR')}px를 초과합니다. 저장한 설명 또는 포함 옵션 수를 줄여주세요. 내용은 잘라내지 않았습니다.`);
  canvas.width = plan.width; canvas.height = height;
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.textBaseline = 'top';
  context.fillStyle = '#111827'; context.font = `bold 34px ${font}`; context.fillText(plan.title, padding, padding);
  context.font = `20px ${font}`; context.fillStyle = '#475569'; subtitle.forEach((text, index) => context.fillText(text, padding, padding + 56 + index * 30));
  let y = startY;
  const tableRow = (cells: string[][], rowHeight: number, header: boolean, index = 0) => {
    let x = padding; context.font = `${header ? 'bold ' : ''}24px ${font}`;
    cells.forEach((lines, column) => {
      const width = plan.columnWidths[column]; context.fillStyle = header ? '#e8eef6' : index % 2 ? '#f8fafc' : '#ffffff'; context.fillRect(x, y, width, rowHeight);
      context.strokeStyle = '#cbd5e1'; context.lineWidth = 1; context.strokeRect(x, y, width, rowHeight); context.fillStyle = '#172033';
      lines.forEach((text, line) => context.fillText(text, x + cellPadding, y + cellPadding + line * lineHeight)); x += width;
    }); y += rowHeight;
  };
  tableRow(plan.headers.map(text => [text]), 58, true);
  rows.forEach((cells, index) => tableRow(cells, heights[index], false, index));
  context.font = `20px ${font}`; context.fillStyle = '#64748b'; footer.forEach((text, index) => context.fillText(text, padding, y + 34 + index * 30));
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 인코딩에 실패했습니다.')), 'image/png'));
  if (blob.size > 10 * 1024 * 1024) throw new Error('만든 PNG가 10MB를 초과합니다. 내용을 줄여주세요.');
  return { blob, width: canvas.width, height: canvas.height };
}
