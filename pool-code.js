/* 보유 풀 백업 코드: TP1.base64url(deflate(JSON)).crc32
 * 서버 저장소 없이 다른 기기로 옮기기 위한 형식입니다. 암호화하지 않으므로 공개해도 되는 정보만 담습니다. */
import {crc32} from './army-code.js';

const PREFIX='TP1',MAX_CODE_LENGTH=400000;
const b64url=bytes=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const unb64url=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-v.length%4)%4)),c=>c.charCodeAt(0));
async function pipe(bytes,decompress){
  const C=decompress?globalThis.DecompressionStream:globalThis.CompressionStream;
  if(!C)throw new Error('이 브라우저는 백업 코드 압축을 지원하지 않습니다. 최신 브라우저를 사용하세요.');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new C('deflate'))).arrayBuffer());
}

export async function encodePoolCode(payload){
  const bytes=await pipe(new TextEncoder().encode(JSON.stringify({kind:'cheonha-pool-backup',v:1,...payload})),false);
  return `${PREFIX}.${b64url(bytes)}.${crc32(bytes)}`;
}

export async function decodePoolCode(code){
  const text=String(code||'').trim().replace(/\s+/g,'');
  if(!text)throw new Error('백업 코드를 붙여넣으세요.');
  if(text.length>MAX_CODE_LENGTH)throw new Error('백업 코드가 너무 깁니다.');
  const [prefix,body,sum]=text.split('.');
  if(prefix!==PREFIX||!body||!sum)throw new Error('TP1.으로 시작하는 보유 풀 백업 코드가 아닙니다.');
  let bytes;try{bytes=unb64url(body);}catch{throw new Error('백업 코드 문자가 손상됐습니다.');}
  if(crc32(bytes)!==sum)throw new Error('백업 코드 일부가 빠졌거나 바뀌었습니다. 처음부터 끝까지 다시 복사하세요.');
  let data;try{data=JSON.parse(new TextDecoder().decode(await pipe(bytes,true)));}catch{throw new Error('백업 코드를 풀 수 없습니다.');}
  if(data?.kind!=='cheonha-pool-backup'||data.v!==1)throw new Error('지원하지 않는 백업 코드 형식입니다.');
  return data;
}
