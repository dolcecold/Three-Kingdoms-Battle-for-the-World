/** Only editor data and battle reports use HTTP. Army codes work locally. */
import {encodeArmyCode,decodeArmyCode} from './army-code.js';
export class ApiError extends Error {
  constructor(status, data, retryAfter = 0) {
    super(data?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.code = data?.error?.code || 'HTTP_ERROR';
    this.requestId = data?.request_id || null;
    this.retryAfter = retryAfter;
  }
}

export class BattleApi {
  constructor(baseUrl, {fetchImpl = globalThis.fetch, timeoutMs = 90000} = {}) {
    const url = new URL(baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw new Error('경로 없는 HTTP(S) API 주소가 필요합니다.');
    this.baseUrl = url.origin;
    // fetch를 메서드로 호출하면 브라우저가 'Illegal invocation'을 던집니다.
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.timeoutMs = timeoutMs;
  }
  async request(path, {method = 'GET', body, signal} = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(() => controller.abort(new Error('요청 시간 초과')), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method, signal:controller.signal, credentials:'omit',
        ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})
      });
      let data;
      try { data = await response.json(); }
      catch { throw new ApiError(response.status, {error:{message:'API 주소와 연결 상태를 확인하세요.'}}); }
      if (!response.ok) throw new ApiError(response.status, data, Number(response.headers.get('Retry-After')) || 0);
      return data;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  editor(season, options) { return this.request(`/api/v2/editor?season=${encodeURIComponent(season)}`, options); }
  battle(leftCode, rightCode, options) {
    return this.request('/api/v2/battles', {...options, method:'POST', body:{left_code:leftCode, right_code:rightCode}});
  }
  async battleFromArmies(left, right, season, {data_version=null,...options}={}) {
    const [leftCode,rightCode] = await Promise.all([encodeArmyCode(left,season,{data_version}),encodeArmyCode(right,season,{data_version})]);
    const report = await this.battle(leftCode, rightCode, options);
    return {leftCode,rightCode,report};
  }
}
export {encodeArmyCode,decodeArmyCode};
