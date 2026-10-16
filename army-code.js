/** Public format, no key: TC1.base64url(zlib(JSON)).crc32.
 * CRC32 catches copy damage only. The backend validates every received army.
 */
export const MAX_CODE_LENGTH=8192, MAX_PAYLOAD_BYTES=32768;
function dataVersion(value){
  if(value==null)return null;
  if(typeof value!=='string'||value.length>80||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))throw new Error('데이터 버전 형식을 확인하세요.');
  return value;
}
const stats=value=>({might:0,intelligence:0,defence:0,speed:0,...value});
export function normalizeArmy(army){
  if(!army||!Array.isArray(army.heroes)||army.heroes.length!==3)throw new Error('부대는 무장3명을 포함해야 합니다.');
  return {name:'부대',formation_id:201,supply:100,...army,heroes:army.heroes.map(h=>({
    level:50,troops:10000,breakthrough:0,promotion:null,allocation_mode:'manual',equipment_item_id:null,horse_item_id:null,advanced_arms_id:null,arms_skill_ids:[],warbook_slots:[],total_stats:null,...h,
    allocation:stats(h.allocation),equipment:stats(h.equipment),horse:stats(h.horse),
    innate:{level:10,grade:0,...h.innate},learned:(h.learned||[]).map(s=>({level:10,grade:0,breakthrough:null,...s})),
    total_stats:h.total_stats==null?null:{...h.total_stats}
  }))};
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return ((crc^0xffffffff)>>>0).toString(16).padStart(8,'0');}
function base64url(bytes){let value='';for(const b of bytes)value+=String.fromCharCode(b);return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64url(value){
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('잘못된 코드 형식입니다.');
  const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
  if(base64url(bytes)!==value)throw new Error('잘못된 코드 형식입니다.');return bytes;
}
async function transform(bytes,decompress){
  const C=decompress?globalThis.DecompressionStream:globalThis.CompressionStream;
  if(!C)throw new Error('이 브라우저는 공유 코드 압축을 지원하지 않습니다. 최신 브라우저를 사용하세요.');
  const reader=new Blob([bytes]).stream().pipeThrough(new C('deflate')).getReader();
  const chunks=[];let length=0;const limit=decompress?MAX_PAYLOAD_BYTES:MAX_CODE_LENGTH;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new Error('편성 코드 크기 한도를 초과했습니다.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const out=new Uint8Array(length);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
export async function encodeArmyCode(army,season,{data_version=null}={}){
  if(![1,2,3].includes(season))throw new Error('한국 시즌1·2·3을 선택하세요.');
  const payload={v:1,region:'KR',season,army:normalizeArmy(army)};
  const version=dataVersion(data_version);if(version!==null)payload.data_version=version;
  const raw=new TextEncoder().encode(JSON.stringify(canonical(payload)));
  if(raw.length>MAX_PAYLOAD_BYTES)throw new Error('편성 데이터가 너무 큽니다.');
  const packed=await transform(raw,false),code=`TC1.${base64url(packed)}.${crc32(packed)}`;
  if(code.length>MAX_CODE_LENGTH)throw new Error('편성 코드가 너무 깁니다.');return code;
}
export async function decodeArmyCode(code){
  try{
    if(typeof code!=='string'||code.trim().length>MAX_CODE_LENGTH)throw new Error();
    const parts=code.trim().split('.');if(parts.length!==3||parts[0]!=='TC1'||!/^[0-9a-f]{8}$/.test(parts[2]))throw new Error();
    const packed=unbase64url(parts[1]);if(crc32(packed)!==parts[2])throw new Error();
    const raw=await transform(packed,true),payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    if((payload.v??1)!==1||(payload.region??'KR')!=='KR'||![1,2,3].includes(payload.season))throw new Error();
    return {season:payload.season,data_version:dataVersion(payload.data_version),army:normalizeArmy(payload.army)};
  }catch{throw new Error('공유 코드의 형식·내용을 확인하세요. 손상됐거나 지원하지 않는 코드입니다.');}
}
