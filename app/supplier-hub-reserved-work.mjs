/** One worker event handles one never-requested group. Continue only after a
 * positively verified reply, preserving the same immutable document request.
 * A timeout, failed read, unknown ACK or abort never triggers another call. */
export async function runReservedSegments({expected,send,fresh,signal,onProgress=()=>{},maxSegments=12}){
 if(!expected||!Number.isSafeInteger(maxSegments)||maxSegments<1||maxSegments>12)throw Error('원래 문서의 파일 저장 범위를 확인해주세요.');
 let sequence=-1,groups=0;
 for(let index=0;index<maxSegments;index++){
  if(signal.aborted)throw Error('파일 저장 확인을 취소했습니다. 같은 문서의 결과를 조회해주세요.');
  const result=await send();
  if(signal.aborted)throw Error('파일 저장 확인을 취소했습니다. 같은 문서의 결과를 조회해주세요.');
  if(!result||result.requestId!==expected.requestId||result.docId!==expected.docId||result.packetDigest!==expected.packetDigest||result.preparedBodySha256!==expected.preparedBodySha256
   ||!Number.isSafeInteger(result.draftProof?.checkpointSequence)||result.draftProof.checkpointSequence<=sequence)throw Error('원래 문서보다 오래되거나 다른 파일 저장 응답입니다. 요청을 반복하지 않았습니다.');
  sequence=result.draftProof.checkpointSequence;
  if(result.error||result.state!=='update-requested')return result;
  if(result.recovered!==true)throw Error('파일 저장 응답이 미확정입니다. 요청을 반복하지 말고 같은 문서의 결과를 조회해주세요.');
  groups++;onProgress(groups);await fresh();
 }
 throw Error('파일 저장 확인 범위를 초과했습니다. 같은 문서의 저장 기록을 조회해주세요.');
}
