import { imageSizeGuidance } from '@/app/image-size-guidance';

export function ImageSizeNotice({ size, role }: { size: { width: number; height: number } | null | undefined; role: string }) {
  if (size === undefined) return <small style={{ color: '#64748b' }}>이미지를 불러오면 크기를 표시합니다.</small>;
  if (size === null) return <small style={{ color: '#a34410' }}>이미지를 불러오지 못했습니다. 저장 파일 또는 연결 상태를 확인해주세요.</small>;
  const messages = imageSizeGuidance(role, size.width, size.height);
  return <div style={{ fontSize: 12, color: messages.length ? '#a34410' : '#64748b' }}>
    <span>브라우저 기준 {size.width.toLocaleString('ko-KR')}×{size.height.toLocaleString('ko-KR')}px</span>
    {messages.map(message => <p key={message} style={{ margin: '4px 0 0' }}>{message}</p>)}
  </div>;
}
