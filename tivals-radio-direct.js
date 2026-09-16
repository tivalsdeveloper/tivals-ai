/* Tivals AI direct radio streaming. Public broadcaster streams only; no audio is proxied or stored. */
(()=>{
const stations=[
{name:'Phalaphala FM',lang:'Tshivenda',stream:'https://playerservices.streamtheworld.com/api/livestream-redirect/PHALAPHALAAAC.aac?dist=tivalsai'},
{name:'Thobela FM',lang:'Sepedi',stream:'https://playerservices.streamtheworld.com/api/livestream-redirect/THOBELAAAC_SC?dist=tivalsai'},
{name:'Ukhozi FM',lang:'isiZulu',stream:'https://playerservices.streamtheworld.com/api/livestream-redirect/UKHOZIFMAAC_SC?dist=tivalsai'},
{name:'Lesedi FM',lang:'Sesotho',stream:'https://playerservices.streamtheworld.com/api/livestream-redirect/LESEDIAAC_SC?dist=tivalsai'},
{name:'KFM 94.5',lang:'English',stream:'https://playerservices.streamtheworld.com/api/livestream-redirect/KFM.mp3?dist=tivalsai'},
{name:'Jacaranda FM',lang:'English/Afrikaans',stream:'https://edge.iono.fm/xice/jacarandafm_live_medium.aac'},
{name:'Power 98.7',lang:'English',stream:'https://edge.iono.fm/xice/65_medium.aac'}
];
let audio=null,current=null;
function getAudio(){if(!audio){audio=new Audio();audio.preload='none';audio.crossOrigin='anonymous';audio.addEventListener('playing',()=>emit('playing'));audio.addEventListener('pause',()=>emit('paused'));audio.addEventListener('error',()=>emit('error'))}return audio}
function emit(status){window.dispatchEvent(new CustomEvent('tivals:radio-state',{detail:{status,station:current}}))}
async function play(name){const s=stations.find(x=>x.name.toLowerCase()===String(name||'').toLowerCase());if(!s)throw new Error('This station does not have a verified direct stream yet.');const a=getAudio();if(a.src!==s.stream){a.pause();a.src=s.stream;a.load()}current=s;await a.play();return s}
function stop(){const a=getAudio();a.pause();a.removeAttribute('src');a.load();current=null;emit('stopped')}
function pause(){getAudio().pause()}
function resume(){if(!current)throw new Error('Choose a radio station first.');return getAudio().play()}
function volume(v){getAudio().volume=Math.max(0,Math.min(1,Number(v)));return getAudio().volume}
window.TivalsRadio={stations,play,pause,resume,stop,volume,get current(){return current},get audio(){return getAudio()}};
})();