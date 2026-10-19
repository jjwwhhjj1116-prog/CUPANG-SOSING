const HIT_TTL=15*60*1000;
const EMPTY_TTL=2*60*1000;
const FIELDS=['productId','itemId','vendorItemId','salesLast28d','pvLast28Day'];

function scopeKey(scope) {
  if(typeof scope==='string'&&scope.trim())return 'string:'+scope;
  if(scope&&Number.isInteger(scope.tabId)&&scope.tabId>=0&&Number.isInteger(scope.windowId)&&scope.windowId>=0) {
    return `tab:${scope.tabId}:window:${scope.windowId}`;
  }
  throw new TypeError('A Wing tab/window cache scope is required.');
}
function queryKey(query) {
  if(typeof query!=='string'||!query.trim())throw new TypeError('A nonempty catalog query is required.');
  return query.trim();
}
function productId(value) {
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>0?String(value):null;
  return typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value)?value:null;
}
function cleanRows(rows) {
  if(!Array.isArray(rows))throw new TypeError('Catalog rows must be an array.');
  return rows.slice(0,200).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>{
    const clean={};
    for(const field of FIELDS)clean[field]=(typeof row[field]==='string'||typeof row[field]==='number')?row[field]:null;
    return clean;
  });
}
const snapshot=(entry,rows=entry.rows)=>({rows:rows.map(row=>({...row})),asOf:entry.asOf});

// Holds aggregate catalog fields only. The caller invalidates on session or tab
// changes and must not repopulate this cache with a request from an old session.
export function createCatalogCache({now=Date.now,maxEntries=300}={}) {
  if(typeof now!=='function'||!Number.isSafeInteger(maxEntries)||maxEntries<1)throw new TypeError('Invalid catalog cache configuration.');
  const entries=new Map();
  let sequence=0;
  const touch=(key,entry)=>{entries.delete(key);entries.set(key,entry);};
  const fresh=(key,entry,time)=>{
    if(time>=entry.expiresAt){entries.delete(key);return false;}
    return true;
  };
  return {
    get(scope,query) {
      const key=JSON.stringify([scopeKey(scope),queryKey(query)]),entry=entries.get(key);
      if(!entry||!fresh(key,entry,now()))return null;
      touch(key,entry);
      return snapshot(entry);
    },
    put(scope,query,rows,asOf) {
      const scopeId=scopeKey(scope),key=JSON.stringify([scopeId,queryKey(query)]),time=now();
      const timestamp=asOf===undefined?new Date(time).toISOString():asOf;
      if(typeof timestamp!=='string'||!Number.isFinite(Date.parse(timestamp)))throw new TypeError('A valid catalog observation timestamp is required.');
      const observedAt=Date.parse(timestamp),clean=cleanRows(rows);
      // Reusing an old snapshot must not renew its freshness window.
      const expiresAt=Math.min(time,observedAt)+(clean.length?HIT_TTL:EMPTY_TTL);
      if(expiresAt<=time)return false;
      const previous=entries.get(key);
      if(previous&&fresh(key,previous,time)&&previous.observedAt>observedAt)return false;
      const entry={scopeId,rows:clean,asOf:timestamp,observedAt,expiresAt,sequence:++sequence,
        productIds:new Set(clean.map(row=>productId(row.productId)).filter(Boolean))};
      touch(key,entry);
      for(const [oldKey,oldEntry] of entries)fresh(oldKey,oldEntry,time);
      while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
      return true;
    },
    getProduct(scope,pid) {
      const scopeId=scopeKey(scope),id=productId(pid),time=now();
      if(!id)return null;
      let selected=null,selectedKey;
      for(const [key,entry] of entries) {
        if(!fresh(key,entry,time)||entry.scopeId!==scopeId||!entry.productIds.has(id))continue;
        if(!selected||entry.observedAt>selected.observedAt||(entry.observedAt===selected.observedAt&&entry.sequence>selected.sequence)) {
          selected=entry;selectedKey=key;
        }
      }
      if(!selected)return null;
      touch(selectedKey,selected);
      // Keep all variants from one observation so callers can detect ambiguity.
      return snapshot(selected,selected.rows.filter(row=>productId(row.productId)===id));
    },
    invalidate() {entries.clear();sequence=0;}
  };
}
