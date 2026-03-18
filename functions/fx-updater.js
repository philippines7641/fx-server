// fx-updater.js
// Node.js + Firebase Hosting용 FX 자동 갱신 스크립트
// 블로그 가젯 JS와 100% 호환

import fetch from "node-fetch";
import fs from "fs";
import cron from "node-cron";

// ==== 설정 ====
const PUBLIC_PATH = "../public/fx_phil7641.json"; // Firebase hosting public 폴더
const EMA_ALPHA = 0.45;                          // 기본 EMA 반영율
const API_TIMEOUT = 4000;                        // ms
const API_LIST = [
    {name:"CURR", url:"https://api.currencyapi.com/v3/latest?apikey=YOUR_CURR_API_KEY&base_currency=USD", parser: d => {
        const r={}; for(const k in d.data) r[k]=d.data[k].value; return r;
    }, weight:1.2},
    {name:"FREAK", url:"https://api.currencyfreaks.com/v2.0/rates/latest?apikey=YOUR_FREAK_API_KEY", parser:d=>d.rates, weight:2},
    {name:"INVEST", url:"https://api.investing.com/api/latest?apikey=YOUR_INVESTING_API_KEY", parser:d=>d.rates, weight:2.2},
    {name:"YAHOO", url:"https://finance.yahoo.com/api/latest?apikey=YOUR_YAHOO_API_KEY", parser:d=>d.rates, weight:2.2},
    {name:"EXCH", url:"https://api.exchangerate.host/latest?apikey=YOUR_EXCH_API_KEY", parser:d=>d.rates, weight:2.2},
    {name:"HOST", url:"https://api.exchangerate.host/latest?base=USD&symbols=PHP,KRW,EUR,JPY,CNY,GBP,AUD,SGD", parser:d=>d.rates, weight:1},
    {name:"OPEN", url:"https://open.er-api.com/v6/latest/USD", parser:d=>d.rates, weight:1},
    {name:"HOSTA", url:"https://api.exchangerate-api.com/v4/latest/USD", parser:d=>d.rates, weight:1},
    {name:"FRANK", url:"https://api.frankfurter.app/latest?from=USD&to=PHP,KRW,EUR,JPY,CNY,GBP,AUD,SGD", parser:d=>d.rates, weight:1}
];
const CURRENCY_KEYS = ["PHP","KRW","EUR","JPY","CNY","GBP","AUD","SGD"];

// EMA 상태 저장
let emaRates = {};
let apiScore = {};
let apiSpeed = {};

// ==== 유틸 함수 ====
function removeOutlierPair(pairs){
    if(pairs.length<=2) return pairs;
    pairs.sort((a,b)=>a.value-b.value);
    return pairs.slice(1,-1);
}

function timeout(ms){ return new Promise(res=>setTimeout(res,ms)); }

async function fetchAPI(api){
    const controller = new AbortController();
    const id = setTimeout(()=>controller.abort(), API_TIMEOUT);
    const start = performance.now();
    try{
        const res = await fetch(api.url, {signal: controller.signal});
        const data = await res.json();
        clearTimeout(id);
        const end = performance.now();
        apiSpeed[api.name] = end-start;
        apiScore[api.name] = (apiScore[api.name]||0)+api.weight;
        return api.parser(data);
    }catch(e){
        apiScore[api.name] = (apiScore[api.name]||0)-2;
        return null;
    }
}

// ==== 빌드 및 EMA 적용 ====
function buildRates(apiDataList){
    const result = {};
    for(const key of CURRENCY_KEYS){
        const pairs = [];
        for(const a of apiDataList){
            if(a.data && a.data[key]!=null) pairs.push({name:a.name,value:a.data[key]});
        }
        if(!pairs.length) continue;
        const filtered = removeOutlierPair(pairs);
        const median = filtered[Math.floor(filtered.length/2)].value;
        let sum=0, wsum=0;
        for(const p of filtered){
            let w=(1/(apiSpeed[p.name]||500))*((apiScore[p.name]||1)+5);
            w*=1; // baseWeight 없음, 이미 weight 적용
            w/=1+Math.abs(p.value-median);
            sum+=p.value*w;
            wsum+=w;
        }
        result[key] = sum/wsum;
    }
    return result;
}

function applyEMA(rates){
    for(const k in rates){
        const prev = emaRates[k] || rates[k];
        const trend = prev ? (rates[k]-prev)/prev : 0;
        let alpha = EMA_ALPHA;
        if(trend>0.0005) alpha*=0.8;
        if(trend<-0.0005) alpha*=1.2;
        emaRates[k] = prev*(1-alpha) + rates[k]*alpha;
    }
    return emaRates;
}

// ==== 메인 갱신 함수 ====
async function updateFXJSON(){
    const promises = API_LIST.map(api=>fetchAPI(api).then(data=>({name:api.name,data})));
    const results = await Promise.all(promises);
    const valid = results.filter(r=>r.data!=null);
    if(!valid.length) return;
    const built = buildRates(valid);
    const finalRates = applyEMA(built);
    fs.writeFileSync(PUBLIC_PATH, JSON.stringify(finalRates));
    console.log(new Date().toISOString(), "FX JSON updated:", finalRates);
}

// ==== 스케줄링 ====
console.log("FX Updater Started...");
updateFXJSON(); // 즉시 실행
cron.schedule("*/10 * * * *", async ()=>{ // 10분마다 실행
    await updateFXJSON();
});