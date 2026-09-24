import { PAYMENT_HOSTS } from "./sources";

// Scriptul pus pe site-uri: <script defer src="https://mydashboard.ro/t.js" data-site="..."></script>
// Fara dependinte, cateva KB. Ce face:
//  - trimite fiecare pagina vazuta (vizita noua dupa 30 min de pauza sau cand omul vine din alta sursa)
//  - pastreaza ID-ul vizitatorului (localStorage + cookie first-party _md_vid, citibil si de server la checkout)
//  - prinde comenzile trimise spre Google Analytics prin dataLayer / gtag (WooCommerce, Shopify, GTM)
//  - adauga client_reference_id la linkurile de plata Stripe (buy.stripe.com), ca plata sa fie legata de vizita
//  - expune window.mdTrack("nume", { value, currency, order }) pentru evenimente proprii
export function trackerScript(endpoint: string) {
  return `(function(){
"use strict";
var S=document.currentScript,site=S&&S.getAttribute("data-site");if(!site||window.__mdTrack)return;window.__mdTrack=1;
var API=${JSON.stringify(endpoint)},PAY=${JSON.stringify(PAYMENT_HOSTS)},IDLE=18e5;
function g(k){try{return localStorage.getItem(k)}catch(e){return null}}
function p(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function rid(){var a=new Uint8Array(16);(window.crypto||window.msCrypto).getRandomValues(a);return Array.prototype.map.call(a,function(b){return("0"+b.toString(16)).slice(-2)}).join("")}
function host(u){try{return new URL(u).hostname.replace(/^www\\./,"")}catch(e){return""}}
function isPay(h){for(var i=0;i<PAY.length;i++)if(h===PAY[i]||h.slice(-PAY[i].length-1)==="."+PAY[i])return true;return false}
var ck=document.cookie.match(/(?:^|; )_md_vid=([a-f0-9]{32})/),vid=g("_md_vid")||(ck&&ck[1]);if(!vid)vid=rid();p("_md_vid",vid);
try{document.cookie="_md_vid="+vid+"; path=/; max-age=31536000; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"")}catch(e){}
var sid=g("_md_sid"),last=+g("_md_last")||0,now=Date.now();
var q=new URLSearchParams(location.search),rh=host(document.referrer),me=location.hostname.replace(/^www\\./,"");
var fromCampaign=q.get("utm_source")||q.get("gclid")||q.get("fbclid")||q.get("ttclid")||q.get("gbraid")||q.get("wbraid");
var fromOutside=rh&&rh!==me&&!isPay(rh);
var fresh=!sid||now-last>IDLE||fromCampaign||fromOutside;
if(fresh)sid=rid();p("_md_sid",sid);p("_md_last",String(now));
function send(d){d.site=site;d.vid=vid;d.sid=sid;d.url=location.href;var b=JSON.stringify(d);p("_md_last",String(Date.now()));
if(navigator.sendBeacon&&navigator.sendBeacon(API,b))return;try{fetch(API,{method:"POST",body:b,keepalive:true,mode:"no-cors"})}catch(e){}}
send({t:"pageview",ns:fresh?1:0,ref:fresh&&!isPay(rh)?document.referrer:"",sw:screen.width});
var seen={};
function track(name,o){o=o||{};var id=o.order||o.transaction_id;if(id){if(seen[id])return;seen[id]=1}
send({t:name==="purchase"?"purchase":"event",name:String(name).slice(0,80),value:+o.value||0,currency:o.currency||"",order:id?String(id).slice(0,120):""})}
window.mdTrack=track;window.mdTrack.vid=vid;
function chk(o){if(!o)return;var e;
if(o.event==="purchase"){e=o.ecommerce||{};track("purchase",{value:e.value,currency:e.currency,order:e.transaction_id});return}
if(o[0]==="event"&&o[1]==="purchase"){e=o[2]||{};track("purchase",{value:e.value,currency:e.currency,order:e.transaction_id})}}
var n=0;function scan(){var dl=window.dataLayer;if(!dl||!dl.length)return;for(;n<dl.length;n++){try{chk(dl[n])}catch(e){}}}
scan();setInterval(scan,1000);
function tag(a){try{if(!a||!a.href||host(a.href)!=="buy.stripe.com")return;var u=new URL(a.href);if(!u.searchParams.get("client_reference_id")){u.searchParams.set("client_reference_id",vid);a.href=u.toString()}}catch(e){}}
function tagAll(){var l=document.querySelectorAll('a[href*="buy.stripe.com"]');for(var i=0;i<l.length;i++)tag(l[i])}
document.addEventListener("mousedown",function(e){tag(e.target&&e.target.closest&&e.target.closest("a"))},true);
document.addEventListener("touchstart",function(e){tag(e.target&&e.target.closest&&e.target.closest("a"))},{capture:true,passive:true});
if(document.readyState!=="loading")tagAll();else document.addEventListener("DOMContentLoaded",tagAll);
var lastUrl=location.href;function nav(){if(location.href===lastUrl)return;lastUrl=location.href;send({t:"pageview",ns:0,ref:""})}
var hp=history.pushState;history.pushState=function(){var r=hp.apply(this,arguments);setTimeout(nav,0);return r};
window.addEventListener("popstate",nav);
})();`;
}
