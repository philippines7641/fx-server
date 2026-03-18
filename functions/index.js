import fetch from "node-fetch"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

/* API KEY */

const APIKEY_CURR="cur_live_0UPD7xZbrt2Rszt9YCC7qKfZyOm2W05qYzDJvWff"
const APIKEY_FREAK="9d46c9dd5a55455f8e84b2480212d419"

/* PATH */

const __filename=fileURLToPath(import.meta.url)
const __dirname=path.dirname(__filename)
const PUBLIC_PATH=path.join(__dirname,"../public/fx_phil7641.json")

/* SETTINGS */

const API_TIMEOUT=4000
const MAX_SPIKE=0.005

/* STABLE API */

const API_STABLE=[

{
name:"HOST",
url:"https://api.exchangerate.host/latest?base=USD&symbols=PHP,KRW,EUR,JPY,CNY,GBP,AUD,SGD",
parser:d=>d.rates,
weight:1.6
},

{
name:"OPEN",
url:"https://open.er-api.com/v6/latest/USD",
parser:d=>d.rates,
weight:1.2
},

{
name:"FRANK",
url:"https://api.frankfurter.app/latest?from=USD&to=PHP,KRW,EUR,JPY,CNY,GBP,AUD,SGD",
parser:d=>d.rates,
weight:1.6
}

]

/* LIMITED API */

const API_LIMITED=[

{
name:"CURR",
url:`https://api.currencyapi.com/v3/latest?apikey=${APIKEY_CURR}&base_currency=USD`,
parser:d=>{
const r={}
for(const k in d.data){r[k]=d.data[k].value}
return r
},
weight:2
},

{
name:"FREAK",
url:`https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${APIKEY_FREAK}`,
parser:d=>d.rates,
weight:1.8
},

{
name:"EXAPI",
url:"https://api.exchangerate-api.com/v4/latest/USD",
parser:d=>d.rates,
weight:1.2
}

]

/* RANDOM ROTATION */

function pickLimited(){

const shuffled=[...API_LIMITED].sort(()=>0.5-Math.random())
return shuffled.slice(0,2)

}

const API_LIST=[...API_STABLE,...pickLimited()]

/* CURRENCY */

const CURRENCY_KEYS=[
"PHP","KRW","EUR","JPY","CNY","GBP","AUD","SGD"
]

let emaRates={}
let apiScore={}
let apiSpeed={}

/* OUTLIER */

function removeOutlierPair(pairs){

if(pairs.length<=2) return pairs

pairs.sort((a,b)=>a.value-b.value)
return pairs.slice(1,-1)

}

/* FETCH */

async function fetchAPI(api){

const start=Date.now()

try{

const controller=new AbortController()
const timeout=setTimeout(()=>controller.abort(),API_TIMEOUT)

const res=await fetch(api.url,{signal:controller.signal})
clearTimeout(timeout)

const data=await res.json()
const end=Date.now()

apiSpeed[api.name]=end-start
apiScore[api.name]=(apiScore[api.name]||0)+api.weight

return api.parser(data)

}catch(e){

apiScore[api.name]=(apiScore[api.name]||0)-2
return null

}

}

/* BUILD RATES */

function buildRates(apiDataList){

const result={}

for(const key of CURRENCY_KEYS){

const pairs=[]

for(const a of apiDataList){

if(a.data && a.data[key]!=null){

pairs.push({
name:a.name,
value:Number(a.data[key])
})

}

}

if(!pairs.length) continue

const filtered=removeOutlierPair(pairs)
const median=filtered[Math.floor(filtered.length/2)].value

let sum=0
let wsum=0

for(const p of filtered){

const deviation=Math.abs(p.value-median)

apiScore[p.name]=(apiScore[p.name]||0)+1
apiScore[p.name]-=deviation*5

let w=(1/(apiSpeed[p.name]||500))*(apiScore[p.name]+5)

w/=1+deviation

sum+=p.value*w
wsum+=w

}

result[key]=sum/wsum

}

return result

}

/* CROSS RATE */

function crossRateAdjust(r){

if(r.EUR && r.PHP){

const eurphp=r.PHP/r.EUR

if(eurphp>0){
r.PHP=(r.PHP+eurphp*r.EUR)/2
}

}

return r

}

/* VOLATILITY EMA */

function applyEMA(rates){

for(const k in rates){

const prev=emaRates[k]||rates[k]
const change=Math.abs(rates[k]-prev)/prev

let alpha=0.35

if(change>0.002) alpha=0.75
else if(change>0.001) alpha=0.6
else if(change>0.0005) alpha=0.5

emaRates[k]=prev*(1-alpha)+rates[k]*alpha

}

return emaRates

}

/* SPIKE GUARD */

function spikeGuard(rates){

for(const k in rates){

const prev=emaRates[k]

if(!prev) continue

const diff=(rates[k]-prev)/prev

if(Math.abs(diff)>MAX_SPIKE){

rates[k]=prev*(1+Math.sign(diff)*MAX_SPIKE)

}

}

return rates

}

/* UPDATE JSON */

async function updateFXJSON(){

const promises=API_LIST.map(api=>
fetchAPI(api).then(data=>({name:api.name,data}))
)

const results=await Promise.all(promises)
const valid=results.filter(r=>r.data!=null)

if(!valid.length) return

const built=buildRates(valid)
const adjusted=crossRateAdjust(built)
const ema=applyEMA(adjusted)
const finalRates=spikeGuard(ema)

fs.mkdirSync(path.dirname(PUBLIC_PATH),{recursive:true})

const output={
timestamp:new Date().toISOString(),
base:"USD",
rates:finalRates
}

fs.writeFileSync(
PUBLIC_PATH,
JSON.stringify(output,null,2)
)

console.log(
new Date().toISOString(),
"FX JSON updated",
finalRates
)

}

/* RUN */

updateFXJSON()
